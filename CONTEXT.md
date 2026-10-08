# mole-tools Context

This glossary captures domain language for the single `mole-tools` bounded context.

## Terms

### Feature
A user-facing tool represented by a `Feature` object in `src/core/feature.ts` and registered in `src/core/registry.ts`. A feature has a command name, one-line description, zod argument schema, and a `run(ctx, args)` flow.

### Registered command
A CLI command exposed to users. Most registered commands come directly from the feature registry. The `help` command is intentionally special-cased because it must run without config loading or Ink.

### Help feature
The discoverability function that lists available tools and explains how to call each one. It is registry-backed so newly registered features appear automatically.

### Commit auto mode
A strictly non-interactive commit invocation enabled by `mole-tools commit --auto`. It accepts the generated, format-valid message and creates the local commit without showing the message selection. It deliberately never pushes; staged-change validation, Jira lookup, diff collection, generation, and failure handling remain unchanged. A future commit-flow decision that cannot be safely automated fails rather than prompting or silently choosing a default.

### LLM model route
A feature-owned provider/model selection in global configuration, for example `models.commit: { provider: "ollama", name: "qwen3" }`; `models.mergeRequest` has the same `{ provider, name }` shape. Provider connection details are stored separately under `providers`, and the two routes select their provider and model independently.

### User-supplied generation context
Optional, invocation-scoped, non-blank free text supplied through the `--context` CLI option to guide an LLM-generated commit message or merge-request title and description. Its internal whitespace is preserved; it has no tool-level length limit and is not persisted. Prompt builders render it immediately after the feature prompt as a clearly labelled guiding-instruction section, before Jira, commit, and diff evidence. For a merge-request invocation that commits staged changes, the same context guides the internal commit generation as well as merge-request generation.

### Feature help metadata
Optional command-level documentation colocated on a feature. It may include invocation syntax, examples, and notes. It does not replace generated data from the feature's name, description, or zod args.

### Zod argument metadata
Descriptions and examples attached to individual zod argument schemas with `.describe(...)` and `.meta({ examples: [...] })`. This is the canonical place for option-level help text.

### Interactive review (`mole-tools review`)
The feature that reviews one GitLab merge request in a local web UI with
`Code` and `Overview` review views. Invoke it as
`mole-tools review <mr-url> [--mode code|plan] [--no-open] [--refresh]`.
`--mode` defaults to `code` and selects only the layer prompt; `plan` frames
the same diff/chat/comment flow around requirements and acceptance criteria.
`--no-open` suppresses browser launch. `--refresh` re-fetches the MR head and
rebuilds the detached worktree before serving.
Review UI is styled with Tailwind v4 + vendored shadcn base-luma components (`src/features/review/ui/components/ui`) and Lucide icons.

### Review URL and run token
The URL printed by `mole-tools review` points to
`http://127.0.0.1:<ephemeral-port>/?t=<random-token>`. Token is minted for one
CLI run and is never persisted. Every `/api/*` request must carry token as
`?t=<token>` or `X-Mole-Token`; missing or wrong token gets `401`. Server is
loopback-only and exists only while CLI process runs.

### Update check
Each `mole-tools review` launch starts a non-blocking lookup of GitHub's
`releases/latest` endpoint and compares its tag with the bundled `package.json`
version. Token-protected `GET /api/version` exposes `{ current, latest,
updateAvailable }`. The **General** tab shows the installed `v<version>` at
bottom-left. Only a valid, strictly newer latest version adds an **Update
X.Y.Z available** header button, which opens the Update modal with the install
command and copy button. A failed check never blocks launch or reports an error.

### Review worktree
A detached worktree checked out at MR head for safe inspection. Review first
uses current directory when its `origin` matches MR; otherwise it reuses or
creates cache clone under `~/.config/mole-tools/repos/` and worktree under
`~/.config/mole-tools/worktrees/<host>/<project>/mr-<iid>/`. Chat and comment
agents have read-only tools, including Bash for read-only inspection commands.
Layer output is written outside worktree. CLI exit stops server but leaves
worktree and review state on disk; cleanup is deliberate through
`worktree-prune`, not automatic.

### ReviewAgent
Provider-neutral port for review turns. It exposes `preflight()` and a
streaming `run({ sessionId?, cwd, systemPromptFile, message, writeDir?,
signal? })`. Adapters normalize `omp` or `claude` NDJSON into session, text,
tool, error, turn-end, and diagnostic events. `Llm` remains one-shot and
continues to serve commit and merge-request generation. Each run obtains its
agent from the effective selection for its prompt version or chat binding;
review agents are not cached as one shared instance across runs.

### Review session
Provider conversation uses active chat `sessionId` in per-chat review state,
with `chats` and `activeChatId` identifying each conversation.
First chat turn seeds MR metadata, layer guide, changed-file list, and a
snapshot of current host review discussions (bounded untrusted data); later
turns resume that chat's session with message, new context tags, and open
file only.
User/assistant entries append to `chats/<chatId>.ndjson`. Legacy
`chatSessionId` and `chat.ndjson` are read-only migration inputs for pre-multi-chat
v1 state; `chat.ndjson` is adopted once into `chats/legacy.ndjson`. Chats bind
agent/model at creation, and existing chats keep that binding when settings
change. Comment creation opens empty local drafts. **From chat** runs one
fresh read-only agent session over a temporary conversation file containing
the draft anchor and chat transcript; its generated result is appended to the
draft body. Drafts remain local until their own Send.

### Review layer
Generated guide entry with `title`, `tldr`, and `files[]`, plus
persisted id/done/stale state. Guide auto-runs once when pending, caches when
ready, and can be Regenerated or Retried. A layer curates files from the full
changed-file tree; global and per-layer viewed-file coverage are separate.

### Positioned discussion
A local comment draft anchored to one diff side and inclusive line range.
New-side anchors use `new_line`; deleted-side anchors use `old_line`. Ranges
cannot cross sides and must resolve against current diff refs before explicit
Send posts one GitLab discussion. Existing discussions remain read-only.

### General discussion
An unpositioned merge-request discussion shown at the bottom of the Overview
view, with an Explain action that opens a chat asking the agent to explain it.

### Description tag
A chat tag `{ kind: "description", startLine?, endLine?, quote }` for the MR
description, never a file path. `startLine` and `endLine` appear together as an
inclusive source-line range; without them, the tag means the whole description.
The quote carries the tagged text.

Review comment bodies support GitHub-flavoured Markdown in local previews and
published positioned/general discussion cards; rendered output is sanitized,
while collapsed discussion summaries stay plain text.

### Review sync
Explicit re-synchronization after a head-SHA change. Refresh checks current
head and reports staleness without mutating state. Sync recreates detached
worktree at new head, recomputes merge base/diff/refs, marks layers stale,
preserves chat/drafts, and stamps drafts whose anchors no longer resolve.

### Skill
A manually invoked, versioned prompt snippet authored in Settings and
referenced as `/<name>` in chat. The Skills tab pins **New skill** above its
scrolling list; name validation appears inline in a cancellable dialog. Type
`/` at the start of a message or after whitespace to open the picker above the
slash. **No matches** includes a plus button to open Settings on Skills. The
server expands tokens to active version text; transcript renders tags and use
updates most-recently-used order.

### Review feature flag
A single registered review flag enables the one-pager feature. Registry lives
in `src/shared/feature-flags.ts`; its value lives in
`~/.config/mole-tools/features.json` and is managed in Settings > Features
through `GET/POST /api/features`. The one-pager prompt slots appear in Settings
> Prompts only while the flag is enabled; all standard review prompts remain
available independently. Review importance scoring is always available and
does not depend on or appear in the feature flag registry.

### One pager
An agent-written, reviewer-facing one-page Markdown summary of a merge
request, stored per MR at
`~/.config/mole-tools/reviews/<host>/<project>/mr-<iid>/one-pager/document/one-pager.md`.
The **One pager** feature adds an Overview tab for creating and regenerating
the summary. The host captures Markdown returned by every agent, validates it,
and atomically persists it. Generation does not rely on agent-created output
files; Claude and Codex writes stay inside the disposable run directory and,
when evidence exists, are scoped to a sibling output subdirectory.
Codex one-pager generation and chat scoped-write turns deliberately pass
`--ignore-user-config --strict-config`, so user `config.toml` settings,
including provider and default model, are not loaded. The prompt version can
select Codex agent/model/effort, but not provider; users relying on a
non-default provider or other user-config settings must ensure scoped turns can
run without user config.
Generation input is bounded to 64 KiB of serialized metadata/diff and a 96 KiB
combined system prompt plus message. When diff/file content is omitted, the host
stores the complete parsed diff as JSON Lines at
`runs/<run-id>/evidence/complete-diff.ndjson`; only its path and read instructions
enter the prompt. Agents receive explicit read-only access to the evidence
directory, inspect omitted files/changes in chunks, and treat all sidecar content
as untrusted data. The sidecar is separate from any scoped output directory and
is removed with the disposable run. Truncated MR-description text remains
unavailable; agents must not infer it.


### One pager chat
A chat kind bound to the `review-one-pager-chat` prompt slot. It answers
questions about the one pager. Claude and Codex may edit only the one pager
document in place; OMP stays read-only because it lacks enforced directory-scoped
writes. Supported-provider edits trigger a debounced document reload.

**Importance review progress** appears as one shared bar directly beneath the
Layers/Files tabs when scoring is ready. Its base weights for levels 1–5 are
1, 2, 3, 5, and 8 points (19 total). Each absent level donates its weight to
the nearest represented higher level, or to the nearest represented lower level
when no higher level is represented. Viewed scored changed lines earn their
represented level's full allocated share proportionally; context and unscored
lines don't count. Viewing all scored lines in any nonempty scored diff reaches
19/19. The target remains fixed at 13/19 (68% rounded), regardless of which
levels are present. The tooltip states the target percentage and explains that
more important files fill the bar faster. Fill and accessibility value use the
19-point scale and saturate at 100%. A marker shows the target; fill blends
through importance colours toward level 5 and stays level 5 at the target. A
subtle flame animates once reached, static with reduced motion.

### Plain stdout help
Deterministic text printed directly to stdout, without mounting Ink and without loading config. Used for `mole-tools help` and `mole-tools help <command>`.
