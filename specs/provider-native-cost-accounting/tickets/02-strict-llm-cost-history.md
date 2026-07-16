# 02 — Persist strict LLM-only cost history

## What to build

Make generic cost history persist and read only current normalized LLM entries. New sessions round-trip, legacy/token-only rows fail without migration, cost-breakdown remains unchanged, and Jira/glab stop recording pseudo-costs.

## Blocked by

01 — Establish normalized LLM accounting foundation

## Status

ready-for-agent

## Acceptance criteria

- [ ] A current-session LLM entry round-trips provider/model, session ID, usage, USD provenance, and diagnostic.
- [ ] Legacy/token-only rows are rejected at read/write boundaries; no migration or coercion exists.
- [ ] Jira and glab operations create no cost entries and retain existing behavior/diagnostics.
- [ ] Valid new-entry cost-breakdown output is unchanged.

## Test approach

**Test type:** persistence and adapter integration  
**Test file/area:** `src/adapters/cost-history/file.test.ts`, `src/adapters/issue-tracker/jira.test.ts`, `src/adapters/git-host/glab.test.ts`, `src/features/cost-breakdown/format.test.ts`  
**Validate with:** `bun test src/adapters/cost-history/file.test.ts src/adapters/issue-tracker/jira.test.ts src/adapters/git-host/glab.test.ts src/features/cost-breakdown/format.test.ts`

### Red-Green strategy

1. **Red:** Add current-entry round-trip/rejection cases and assert tracker silence for issue-tracker/git-host calls.
2. **Green:** Add strict session validation and remove non-LLM tracker dependencies/calls.
3. **Refactor:** Adapt formatter access only enough to preserve presentation.

## Implementation notes

- History boundary: `src/adapters/cost-history/file.ts`; generic type: `src/core/cost-tracker.ts`.
- Dependency composition is in `src/core/context.ts`; UI formatter is `src/features/cost-breakdown/format.ts`.

## Out of scope

Migrating legacy rows or changing cost-breakdown tables.

## Open questions

None.
