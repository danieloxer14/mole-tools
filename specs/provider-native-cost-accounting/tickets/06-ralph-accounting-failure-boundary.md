# 06 — Pause Ralph on normalized accounting failure

## What to build

Persist normalized provider accounting and provider session IDs in Ralph’s durable phase/iteration ledger. A settled accounting failure during init, worker, or reflection atomically persists an unavailable record and pauses with `cost_accounting_failed`, preserving completed worker changes and preventing later sessions.

## Blocked by

01 — Establish normalized LLM accounting foundation  
03 — Account Pi runs from completed session JSONL

## Status

ready-for-agent

## Acceptance criteria

- [ ] Ralph cost-record schemas persist provider session ID, normalized usage/USD provenance, and accounting diagnostic with phase/iteration attribution.
- [ ] Init, worker, and reflection success paths use shared derivation and persist normalized ledger records.
- [ ] A settled accounting failure atomically writes an unavailable record and `paused`/`cost_accounting_failed`, retains worker edits, and starts neither reflection nor another worker.
- [ ] Terminal cost output remains derived from persisted state; no session retention or recovery command is introduced.

## Test approach

**Test type:** schema and Ralph feature integration  
**Test file/area:** `src/features/ralph/schema.test.ts`, `test/features/ralph-init.test.ts`, `test/features/ralph-run.test.ts`, `src/shared/ralph-cost.test.ts`  
**Validate with:** `bun test src/features/ralph/schema.test.ts test/features/ralph-init.test.ts test/features/ralph-run.test.ts src/shared/ralph-cost.test.ts`

### Red-Green strategy

1. **Red:** Add ledger/session-ID and init/worker/reflection accounting-failure transition cases, including no-later-session assertions.
2. **Green:** Persist normalized records and centralize the atomic pause transition.
3. **Refactor:** Remove Ralph-only pricing paths while preserving persisted-state summaries.

## Implementation notes

- Ralph seams: `src/features/ralph/schema.ts`, `init.ts`, `run.ts`, `persistence.ts`; aggregation is `src/shared/ralph-cost.ts`.
- Ralph is fail-closed only after a settled accounting failure.

## Out of scope

Generic feature fallback behavior, session-file retention, and a recovery command.

## Open questions

None.
