# 05 — `ralph init` command

## What to build

The `mole-tools ralph init <name> <source> --model <model>` command. It validates
arguments, loads the init prompt, preflights the configured Ralph provider's
workspace-agent capability, generates and validates a task file through the
injected LLM port, and atomically persists task and state artifacts.

## Blocked by

- **00** — requires capability-aware `ctx.llm`, provider routing, and `FakeLlm`
- **03** — needs `parseTaskFile`
- **04** — needs provider-aware state persistence and collision safety

## Status

completed (reviewed 2026-07-13)

## Acceptance criteria

- [ ] CLI accepts `<name>`, `<source>`, required `--model`, `--maxIterations` (default 20, min 1), and `--reflectEvery` (default 5, may be 0).
- [ ] Before external work, resolve the configured `ralph` provider and reject one without `agentic-workspace` (for example, Ollama) with `UnsupportedCapabilityError`.
- [ ] On valid input, call `ctx.llm.runAgent` with purpose `ralph`, workspace `cwd`, semantic auto-approval, the selected model, init prompt in replace mode, and a generation request describing the source.
- [ ] Ralph feature code contains no Pi command, CLI flag, subprocess call, or concrete adapter import.
- [ ] A local source is resolved relative to cwd; URLs and inline briefs are classified in the generation request.
- [ ] Valid output with unchecked tasks creates `.ralph/<name>.md` and `.ralph/<name>.state.json`; state includes configured provider, selected model, CLI values, `status: "ready"`, and `iteration: 0`.
- [ ] Provider failure, empty output, or invalid Markdown exits nonzero without either artifact.
- [ ] Existing artifacts fail before invoking the provider; no force option exists.
- [ ] Print both created paths on success.

## Test approach

**Test file/area:** `src/features/ralph/init.test.ts`

Use `fakeContext({ llm: new FakeLlm(...) })`. Assert semantic agent requests and
artifact results; do not mock `Bun.spawn` here. Pi command construction belongs
in ticket 00's adapter tests.

**Validate with:** `bun test src/features/ralph/init.test.ts`

## Implementation notes

- Load `ralph-init-system` via the prompt loader, then pass its text—not a
  provider-specific prompt-file path—to the LLM port.
- The required model is an explicit Ralph loop choice, not global Ollama config.
- Persist the provider selected at init so resumed runs are not changed by a
  later global-config edit.

## Out of scope

- Worker loop and reflection sessions.
- PiAdapter implementation; that is ticket 00.
