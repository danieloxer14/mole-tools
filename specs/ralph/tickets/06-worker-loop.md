# 06 — Worker loop: agent execution + checklist tracking

## What to build

The continuous `mole-tools ralph run <name>` loop. It owns locks and Ralph
state, runs one fresh workspace-agent iteration through `ctx.llm` at a time,
validates checklist mutations, restores failed attempts, and consumes the
persisted iteration cap.

## Blocked by

- **00** — capability-aware LLM port and fake/provider seam
- **04** — lock, snapshot, state, and persisted provider support
- **05** — Ralph init flow and semantic agent-request pattern

## Status

completed (reviewed 2026-07-13)

## Acceptance criteria

- [ ] Validate name, task/state artifacts, persisted provider/model, and the provider's `agentic-workspace` capability before acquiring work.
- [ ] `--maxIterations` may only raise and persist the cap; a completed loop exits successfully without an agent call.
- [ ] Acquire/reclaim the PID-backed lock; set active `in_progress` implementing state and a run UUID before the first iteration.
- [ ] Per iteration, reread and snapshot the task file, select its first unchecked task, and call `ctx.llm.runAgent` with the persisted provider/model, workspace cwd, auto-approval, implementation prompt in append mode, and task/selected-item request.
- [ ] Ralph feature code has no subprocess call or Pi-specific option. Pi output remains hidden from normal UI while the lifecycle spinner/log is visible.
- [ ] A successful operation must check exactly the selected item. Increment iteration, clear `lastError`, and continue.
- [ ] Any provider failure, unchanged/wrong/multiple checkbox changes, or invalid Markdown restores the snapshot, increments iteration, records diagnostics, and retries normally.
- [ ] Cap exhaustion pauses with `max_iterations_reached`, releases lock, and prints the higher-cap resume command.
- [ ] No remaining unchecked tasks returns control to the final reflection flow.

## Test approach

**Test file/area:** `src/features/ralph/run.test.ts`

Use scripted `FakeLlm` agent outcomes and a fake UI/context to test the whole
loop. Adapter tests—not Ralph tests—verify Pi subprocess flags and cancellation.

**Validate with:** `bun test src/features/ralph/run.test.ts`

## Implementation notes

- The agent operation result must expose collected output and diagnostics; Ralph
  uses only those semantic results.
- Iteration counting includes both success and failure attempts.
- Keep the lock/state cleanup reusable by ticket 07.

## Out of scope

- Periodic/final reflection and Ctrl+C handling (ticket 07).
