# 05 — Init cost recording and summary output

## What to build

After `ralph init` completes its task-generation agent run, the usage data from that `AgentResult` is persisted as a `phase: "init"` ledger record in the Ralph state file before printing. A compact cost-summary line is then printed showing the init record and current loop total (which at this point is just the init record).

This makes every new loop start with an attributable, durable cost entry from moment one.

## Blocked by

04 — needs `costLedger` schema in place so state writes validate correctly

## Status

ready-for-agent

## Acceptance criteria

- [ ] After `runRalphInit()` completes a successful agent run, one ledger record with `phase: "init"` is written to the persisted state file
- [ ] The init record has no `iteration` field, captures provider/model from the used model config, records start/completed timestamps, and carries the usage from `AgentResult`
- [ ] USD cost for the init record is derived using the shared cost-derivation function (from ticket 03) before persisting
- [ ] The init record's USD source reflects actual/estimated/zero/unavailable correctly based on provider data
- [ ] After successful init, a cost-summary line is printed to the terminal showing: loop name, "init" label, input tokens, output tokens, and USD with provenance
- [ ] If task generation fails (agent returns non-ok), no ledger record is written and error propagates normally
- [ ] The persisted state file passes full schema validation including `costLedger`

## Test approach

**Test type:** integration-like unit test with temp directory + fake context
**Test file/area:** New test in `test/features/ralph-init-cost.test.ts` or alongside existing Ralph tests
**Validate with:** `bun test test/features/ralph-init-cost.test.ts` (or equivalent path)

### Red-Green strategy

1. **Red**: Write a test that: (a) sets up a temp Ralph directory; (b) calls `runRalphInit()` with a FakeLlm that returns known usage values; (c) reads the persisted state file and asserts it contains exactly one ledger record with correct phase, provider, model, and token counts. This will fail because cost recording isn't implemented yet.
2. **Green**: In `src/features/ralph/init.ts`, after the agent result is received and validated: derive USD using the shared function from ticket 03; construct a `RalphCostRecord` with UUID id, timestamps, phase "init", provider/model, usage, and usdCost; add `costLedger: [record]` to the state object before calling `writeState()`. After state is written, format and print the cost summary using the shared formatter from ticket 03.
3. **Refactor**: Extract the record-construction step into a small helper so init and run share the same pattern (anticipating ticket 06).

## Implementation notes

- File: `src/features/ralph/init.ts` — main insertion point is after the agent result succeeds and before `writeState()`. The models for init already include provider+name from the model selection UI.
- Timestamps: `startedAt` can be captured right before calling `llm.runAgent()`; `completedAt` right after it returns.
- USD derivation: Use the shared function from ticket 03, passing the usage from AgentResult, any existing usdCost (from provider), and the init model's provider+name.
- Summary output: Call the formatter from ticket 03 with the persisted state (which now has the ledger). The total at this point is just one record. Use `ctx.ui.info()` to print — check how existing init messages are printed for style consistency.
- For testing, need a FakeLlm configured to return specific usage values so assertions are deterministic. The fake context pattern from `test/fakes/fakeContext.ts` works well here. Temp directory via `mkdtemp`.
- Remember: the spec says "Write a record immediately after an agent result settles." In init there's only one agent call, so this is straightforward.

## Out of scope

- Worker/reflection cost recording during `ralph run` — that's ticket 06
- Terminal summaries for all run paths — that's ticket 06
- Schema changes or shared pricing — those are tickets 03 and 04

## Open questions

None
