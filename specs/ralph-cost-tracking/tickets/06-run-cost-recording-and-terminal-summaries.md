# 06 — Worker/reflection cost recording and terminal summaries for all run paths

## What to build

Every worker attempt (even failed ones), periodic reflection, and final reflection result from `ralph run` is captured as a ledger record after its agent call settles. On every terminal path of the runner — normal completion, max-iteration pause, reflection failure, worker validation failure terminating the command, Ctrl+C interruption — the full persisted cost history including all iterations and aggregated totals is printed before returning or rethrowing.

This is the most complex ticket because it touches multiple code paths in `run.ts`, but each integration point follows the same pattern: capture → derive USD → append record atomically → print summary at terminal exit.

## Blocked by

05 — init cost recording precedent; schema valid; shared pricing/aggregation/formatter functions available

## Status

ready-for-agent

## Acceptance criteria

- [ ] Every worker attempt (successful or failed) creates a ledger record with `phase: "implement"` and the iteration number it consumed
- [ ] Periodic reflection (after reflectEvery iterations) creates `phase: "reflect"` record with that worker iteration number
- [ ] Final reflection creates `phase: "reflect"` record with no `iteration` field
- [ ] Failed worker attempts still create ledger records consuming an iteration in the full-loop total
- [ ] Records are persisted atomically via existing `writeState()` path immediately after agent result settles, before later validation or state transitions can fail
- [ ] Normal completion prints full persisted cost history including all iteration subtotals, final reflection row, and aggregate total with provenance label
- [ ] Max-iteration pause prints summary with all iterations recorded so far
- [ ] Reflection failure includes worker record but no reflection record; summary printed before rethrow
- [ ] Ctrl+C interruption captures the active operation result; summary printed before throwing `RalphRunError`
- [ ] Resumed reads of persisted state include historical ledger entries in summaries

## Test approach

**Test type:** integration tests with controlled FakeLlm sequences and temp Ralph directories
**Test file/area:** `test/features/ralph-run-cost.test.ts` (new) or within existing Ralph feature test area
**Validate with:** `bun test test/features/ralph-run-cost.test.ts`

### Red-Green strategy

1. **Red**: Write tests for each terminal path: (a) successful run with 2 iterations including periodic reflection; (b) worker failure creating a record and terminating the loop; (c) max-iteration pause; (d) reflection failure; (e) interrupted run. Each test reads persisted state after the run and asserts correct ledger structure, then checks formatted summary output content. These fail because recording isn't implemented in `run.ts`.
2. **Green**: In `src/features/ralph/run.ts`: After each worker `llm.runAgent()` completes, construct a RalphCostRecord with phase "implement", iteration number, usage/usdCost from result, and append it to the state's costLedger before writing state. Do the same in the `reflect()` closure for reflection records. In every terminal path (pause, completion, error throw), read the current persisted state, aggregate its ledger through the shared function, format the summary with the formatter, and print via `ctx.ui.info()` or `ctx.ui.warn()` depending on the outcome before returning or throwing.
3. **Refactor**: Extract record-creation into a helper function used by both worker and reflection paths. Share timestamp capture pattern (startedAt before call, completedAt after). Ensure summary printing is DRY across terminal paths.

## Implementation notes

- File: `src/features/ralph/run.ts` — multiple insertion points. The main loop handles workers; the `reflect()` closure handles reflections; the `pause()` helper and various throw sites handle terminal summaries.
- Timestamps on worker records: `startedAt` is right before each `llm.runAgent()` call in the iteration loop; `completedAt` right after it returns.
- Worker failure record: even if `result.ok` is false, still create a ledger record with `ok: false`. The spec says "Worker failures consume an iteration and are included in the full-loop total."
- Iteration numbering: a worker that attempts iteration N gets record with `iteration: N`, regardless of success or failure. A periodic reflection after iteration N also gets `iteration: N`. Only init and final reflection omit `iteration`.
- Atomic persistence: Use the existing `writeState()` which validates through Zod. Append one record at a time — don't batch. If a write fails, propagate; records already persisted remain intact (spec requirement).
- Summary on error paths: The spec says to print before "returning or rethrowing the terminal error." Print as info/warn output, not separately from the error log — it's informational output that accompanies the failure signal. Check how existing warn/info calls work in `run.ts` for style consistency.
- Terminal paths to handle: (1) normal completion via final reflection returning "complete"; (2) max-iteration pause at `pause("max_iterations_reached")`; (3) reflection failure throwing RalphRunError; (4) worker validation failure — check whether this should terminate or retry based on existing logic (currently retries); (5) Ctrl+C via `interrupted` flag leading to `pause("interrupted")`.
- For testing: FakeLlm with scripted sequences. The fake context + temp dir pattern from ticket 05 applies here too. Assert both ledger contents in persisted state AND formatted output content.

## Out of scope

- Init cost recording — that's ticket 05
- Schema or shared function changes — those are tickets 03 and 04
- Pi adapter usage parsing — that's ticket 02

## Open questions

None
