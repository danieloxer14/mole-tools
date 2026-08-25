# ADR 0005: ReviewAgent port and provider adapters

- **Status:** Accepted
- **Date:** 2026-08-16
- **Scope:** `mole-tools review`

## Context

`Llm` is a one-shot text-generation port. Interactive review needs a different
contract: a turn has a working directory, a prompt file, optional tool access,
optional cancellation, and a resumable provider session. The review server also
needs ordered text and tool events while a provider process is running. Coupling
review code to either `omp` or `claude` would make those provider details part of
the feature instead of an adapter boundary.

Review has two permission profiles:

- Chat and comment drafting inspect the detached review worktree. They must not
  edit the worktree.
- Layer generation writes one validated JSON document, but only into a review
  output directory outside the worktree. It must never write code under review.

## Decision

Introduce `ReviewAgent` as a port separate from `Llm`:

```ts
export type AgentEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; delta: string }
  | { kind: "tool"; name: string; phase: "start" | "end" }
  | { kind: "turn_end" }
  | { kind: "error"; message: string }
  | {
      kind: "diagnostic";
      code: "unknown_event";
      message: string;
      eventType: string | null;
      raw: unknown;
    };

export interface AgentTurn {
  sessionId?: string;
  cwd: string;
  systemPromptFile: string;
  message: string;
  writeDir?: string;
  signal?: AbortSignal;
}

export interface ReviewAgent {
  preflight(): Promise<void>;
  run(turn: AgentTurn): AsyncIterable<AgentEvent>;
}
```

`cwd` is the worktree the agent is allowed to inspect. `systemPromptFile` is an
absolute file supplied by mole-tools. `writeDir`, when present, is the only
write target granted to a layer run; chat and comment turns omit it. `signal`
propagates Stop/cancel to the provider process.

Adapters normalize provider NDJSON into this event stream. Successful turns
emit one `session` event before text, then zero or more text/tool/diagnostic
events, and finish with `turn_end`. A supplied session id is resumed verbatim.
Unknown provider events become non-fatal diagnostics; malformed known events and
provider failures become typed errors. The shared executor uses `Bun.spawn`,
yields one stdout line at a time, and kills the child when the abort signal is
cancelled.

### Provider adapters

| Adapter | Default binary | Provider invocation | Session handling | Read-only tools |
|---|---|---|---|---|
| `OmpAgentAdapter` | `omp` | `-p --mode json --cwd <cwd> --append-system-prompt <file> --tools <allowlist> [--model <model>] [-r <session>] [--add-dir <writeDir>] -- <message>` | Captures the provider `session` event. Resume uses `-r <session>`. | `read,grep,glob`; a layer run adds `write` and its output directory. |
| `ClaudeAgentAdapter` | `claude` | `-p --output-format stream-json --include-partial-messages --verbose --session-id <uuid> --append-system-prompt <prompt text> --allowedTools Read Grep Glob [--add-dir <writeDir>] --add-dir <cwd> -- <message>` | Mints a UUID for a new turn, emits it after Claude's `system/init`, and reuses it with `--session-id` on resume. | `Read,Grep,Glob`; `writeDir` is added as a bounded directory for layer output, while the adapter's allowed tool list remains read-only. |

The Claude adapter reads `systemPromptFile` and passes its contents because the
Claude CLI accepts prompt text for `--append-system-prompt`. The OMP adapter
passes the file path. Both adapters accept an injected executor for deterministic
contract tests and call the configured binary for `preflight`.

The optional top-level `review` config selects the adapter (`omp` or `claude`),
its binary, an OMP model, the layer timeout, and the large-file threshold. It
is not a `models` route and does not change `RoutingPurpose`:

```jsonc
{
  "review": {
    "agent": "omp",
    "binary": "omp",
    "model": "review-model",
    "layerTimeoutSeconds": 600,
    "largeFileLineThreshold": 800
  }
}
```

## Session lifecycle

1. **Preflight.** `ReviewAgent` exposes `preflight()` for provider checks;
   layer generation calls it before running. A binary failure is surfaced in
   the review UI rather than mutating the worktree.
2. **First chat turn.** The server creates a prompt containing MR metadata, the
   current layer guide, and the changed-file list. It starts `run` without a
   session id. The first `session` event is persisted as `chatSessionId`.
3. **Resumed chat turns.** The server passes that id back to `run`. Later prompt
   files contain only the new message, newly selected line tags, and the open
   file; the provider session retains the earlier review context.
4. **Transcript persistence.** Each user and assistant turn is appended to
   `chat.ndjson`, including tags and the session id. Partial assistant text is
   retained if a turn errors or is cancelled.
5. **Cancellation.** `POST /api/chat/cancel` aborts the active signal. The
   executor kills the child, the stream closes with a terminal `done` event, and
   the next chat turn may start normally.
6. **Comment drafts.** A draft generated from the diff or chat starts a fresh
   agent session. Its session id is deliberately not stored and the draft does
   not advance the exploratory chat transcript.
7. **CLI lifetime.** The Bun review server exists only while the CLI process is
   paused. Stopping the server does not delete the persisted state, transcript,
   output, cached repository, or detached worktree. A later invocation resumes
   from disk.

Layer generation uses the same port with `writeDir` set to
`~/.config/mole-tools/reviews/<host>/<project>/<mr>/layers/`. Its output is
validated against `LayerDocSchema`; a missing or malformed output gets one
retry, then a soft `failed` state. The code under review remains outside that
write directory.

## Security and failure boundaries

- The server binds to `127.0.0.1` and passes the detached worktree path as
  `cwd`; it is not a remote agent service.
- Chat and comment adapters receive only read tools. Prompt policy also tells
  the agent to refuse edits. A review session is expected to leave
  `git status --porcelain` empty in the worktree.
- Every provider stream is normalized. Unknown event shapes are diagnostics,
  not reasons to crash the server. Agent failures, timeouts, and cancellation
  become UI-visible errors while the diff remains usable.
- The review feature chooses a provider through `ReviewAgent`; existing commit
  and merge-request `Llm` routing remains unchanged.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Reuse `Llm` for review chat | It has no sessions, tools, working-directory boundary, or provider event stream. |
| Put `omp` and `claude` command parsing in routes | Provider NDJSON and permissions would leak into HTTP/UI code and make adapters non-swappable. |
| Persist a provider session for comment drafting | A comment is an isolated generation request; reusing chat state could leak unrelated turns and change chat continuity. |
| Grant write access to the worktree | Review must not mutate the code being reviewed. Layer output belongs in a separate directory. |

## Consequences

- Review feature code depends on one provider-neutral port and can use either
  configured adapter without code changes.
- Session ids, transcripts, prompt files, and layer output are durable per MR,
  so browser/CLI restarts do not erase review progress.
- Adapter event mappings must be maintained when provider NDJSON changes; the
  shared diagnostics path makes drift visible without taking down an active
  review.
- A layer provider that cannot write to its supplied output directory fails
  validation and exposes Retry rather than changing files in the worktree.
