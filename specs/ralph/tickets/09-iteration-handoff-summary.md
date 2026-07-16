# 09 — Persist Ralph iteration handoff summaries

## What to build

Add durable iteration handoff context to Ralph worker iterations. After a
successful worker, Ralph extracts its tagged summary, stores the latest summary
in loop state, and supplies it to the next worker as advisory quick-reference
context. Resumed loops retain the summary.

## Blocked by

- **06 — Worker loop: agent execution + checklist tracking** (completed)

## Status

ready-for-agent

## Acceptance criteria

- [ ] New Ralph state initializes `iterationSummary` to an empty string.
- [ ] First worker prompt contains an explicit empty handoff section.
- [ ] A valid `RALPH_ITERATION_SUMMARY` / `END_RALPH_ITERATION_SUMMARY` block is
      extracted and persisted without its markers.
- [ ] The next worker prompt receives the latest persisted summary as advisory
      quick-reference context.
- [ ] A resumed loop supplies its persisted summary to the next worker.
- [ ] Parsed summaries are trimmed to 2,000 characters before persistence and
      prompt inclusion; the state schema imposes no maximum length.
- [ ] A successful worker with missing or malformed summary keeps valid code and
      task-file changes and persists an empty summary.
- [ ] Provider failures, invalid task Markdown, and invalid checklist changes
      retain existing snapshot restoration, iteration consumption, and retry
      behavior.
- [ ] Reflections do not produce or replace the worker iteration summary.
- [ ] Existing Ralph tests and the new focused tests pass.

## Test approach

**Test type:** Unit and feature integration

**Test file/area:**

- `src/features/ralph/schema.test.ts`
- `test/features/ralph-init.test.ts`
- `test/features/ralph-run.test.ts`
- A focused parser/prompt test seam under `src/features/ralph` if useful

**Validate with:**

```bash
bun test src/features/ralph/schema.test.ts test/features/ralph-init.test.ts test/features/ralph-run.test.ts
```

### Red-Green strategy

1. **Red:** Add failing tests for state initialization, tagged-summary parsing,
   prompt inclusion, 2,000-character trimming, empty fallback, resume behavior,
   and preservation of valid worker changes.
2. **Green:** Add `iterationSummary` to the state schema/init state; implement
   worker response parsing and trimming; include state summary in worker input;
   persist parsed or empty summary after worker validation.
3. **Refactor:** Keep parsing and prompt construction in focused helpers, then
   run the full suite with `bun test`.

## Implementation notes

- Ralph worker attempts are the source of summaries; reflection sessions do not
  emit, parse, or replace them.
- Use `FakeLlm`, `FakeUiPort`, `fakeContext`, and Ralph temporary-directory
  helpers already used by `test/features/ralph-run.test.ts`.
- The task file, repository, and verification evidence remain authoritative over
  the advisory summary.
- Missing or malformed summary must not restore a valid worker's task snapshot.
- Existing cost-ledger behavior is unchanged.
- Likely implementation seams: `src/features/ralph/schema.ts`,
  `src/features/ralph/init.ts`, `src/features/ralph/run.ts`, and Ralph tests.
- Cross-reference behavior from `specs/ralph/ralph-tool.md` if the main Ralph
  spec is updated later.

## Out of scope

- Summary history or per-iteration summary ledger entries.
- Reflection-generated summaries.
- New UI rendering for summaries.
- Changes to provider cost accounting or the `AgentResult` contract.

## Open questions

None.
