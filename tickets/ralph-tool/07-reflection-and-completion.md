# 07 — Reflection, completion gate, and interruption

## What to build

Periodic and mandatory final Ralph reviews through the persisted workspace-agent
provider, plus graceful cancellation and lock cleanup across agent operations.

## Blocked by

- **00** — semantic agent cancellation and provider capability seam
- **06** — worker-loop lock/state lifecycle

## Status

completed (reviewed 2026-07-13)

## Acceptance criteria

- [ ] At every nonzero reflection cadence, snapshot the task, set reflecting phase, and call `ctx.llm.runAgent` using the persisted provider/model, workspace cwd, auto-approval, and reflection prompt in append mode.
- [ ] Reflection may uncheck/add tasks; valid remaining work returns state to `in_progress`/`implementing` and records `lastReflectionAt`.
- [ ] When workers finish all tasks, run final reflection after setting `status=completed`; reopened work immediately returns to `in_progress`, otherwise finalize completed state and timestamp.
- [ ] Final review runs even with `reflectEvery=0`.
- [ ] Provider failure or invalid reflection Markdown restores the snapshot, pauses with `reflection_failed`, retains diagnostics, releases the lock, and exits nonzero.
- [ ] Ctrl+C aborts the active LLM agent request through its cancellation signal, awaits operation settlement, preserves already-written task changes, pauses state as `interrupted`, and releases the lock.
- [ ] Signal listeners are cleaned up on every normal/failure/interruption path.
- [ ] Ralph feature code does not use Pi process IDs, signals, CLI flags, or a concrete adapter. PiAdapter owns child-process cancellation.

## Test approach

**Test file/area:** `src/features/ralph/reflection.test.ts` and `src/features/ralph/interrupt.test.ts`

Use `FakeLlm` scripted agent outcomes and an abortable fake operation. Verify
Ralph state/task behavior and semantic cancellation; test actual Pi signal
forwarding only in the Pi adapter suite.

**Validate with:** `bun test src/features/ralph/reflection.test.ts src/features/ralph/interrupt.test.ts`

## Implementation notes

- Reuse the worker loop's persisted provider/model; do not reread global
  provider configuration for an existing loop.
- Reflection uses the LLM port's append-prompt mode, just as implementation
  does. The adapter maps that mode to provider syntax.

## Out of scope

- Background/detached execution.
- Concrete Claude/Codex adapters.
