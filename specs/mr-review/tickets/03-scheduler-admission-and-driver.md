
# 03 — Scheduler admission policy and driver loop

## What to build

Pure admission function implementing the concurrency cap + ≤1 non-parallel rule, plus a promise-based driver loop that starts agent tasks as slots free. No I/O, no dependencies on config or ports — pure logic over arrays of agent descriptors and simulated agent results.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] `canAdmit(inFlight: ScheduledAgent[], candidate: ScheduledAgent, cap: number)` returns `true` when in-flight count < cap AND (candidate is parallel OR no non-parallel agent currently in flight)
- [ ] When in-flight ≥ cap → `false`, regardless of candidate's parallel flag
- [ ] When a non-parallel agent is already in flight and candidate is also non-parallel → `false`
- [ ] When `parallel: true` candidates can overlap a running non-parallel agent (as long as cap not exceeded)
- [ ] Cap counts ALL in-flight agents regardless of their parallel flag
- [ ] Driver loop starts tasks as slots free, waits for completion, and returns an array of results with status tracking (success / failed)

## Test approach

**Test type:** unit (pure logic + scripted promises)
**Test file/area:** `src/features/mr-review/scheduler.test.ts`
**Validate with:** `bun test src/features/mr-review/scheduler.test.ts`

### Red-Green strategy

1. **Red**: Write a table-driven test for `canAdmit` covering: cap boundary, two non-parallel never both admitted, parallel overlaps non-parallel, empty in-flight always admitted if cap > 0. Fails because function doesn't exist yet.
2. **Green**: Implement `canAdmit`. Table tests pass.
3. **Red (driver)**: Write a test that passes an array of agent descriptors + a fake task function into the driver loop, asserts all agents eventually complete and concurrency cap is never exceeded (check via in-flight watermark). Fails because driver doesn't exist yet.
4. **Green**: Implement driver using `Promise.race` or a queue-based approach. Uses `canAdmit` to decide which candidate to start next. Driver test passes.
5. **Refactor**: Clean up the driver while tests remain green. Run full suite (`bun test`).

## Implementation notes

- The driver is pure: it takes an array of agent descriptors (each with id, parallel flag) and a task function `(agent) => Promise<Result>`. It manages scheduling internally.
- A simple approach: maintain an `inFlight` array. When a task completes, remove from in-flight and re-check which waiting candidate can be admitted. Use a priority queue or sorted list to ensure non-parallel agents don't starve parallel ones (but fairness isn't spec'd — correctness is the bar).
- Results array should track per-agent: the agent id, success/failure status, and either the result payload or error. This is consumed by ticket 09's orchestration.

## Out of scope

- Actual LLM calls or file reads (no `ctx`)
- Reviewer discovery or validation (ticket 02)
- Any GitHost interaction

## Open questions

None
