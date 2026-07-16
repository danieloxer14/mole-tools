# 05 — Keep non-Ralph features resilient to accounting faults

## What to build

Connect settled Pi-backed feature operations to strict generic history. When ancillary accounting fails, the primary feature still succeeds and appends exactly one unavailable normalized LLM entry with a sanitized diagnostic.

## Blocked by

02 — Persist strict LLM-only cost history  
03 — Account Pi runs from completed session JSONL

## Status

ready-for-agent

## Acceptance criteria

- [x] Pi-backed commit or merge-request generation remains successful when its accounting fails after primary work settles.
- [x] That failure appends exactly one unavailable entry with provider/model and a sanitized diagnostic, without invented usage or USD amount.
- [x] Every successfully settled provider operation records exactly one normalized LLM entry.
- [x] Generic history and diagnostics expose no raw Pi session content or temporary paths.

## Test approach

**Test type:** feature integration  
**Test file/area:** Pi-backed commit/MR feature tests and cost-history integration coverage  
**Validate with:** `bun test`

### Red-Green strategy

1. **Red:** Simulate accounting failure after primary feature success and assert success plus one unavailable entry.
2. **Green:** Handle non-Ralph accounting errors at the feature/history boundary.
3. **Refactor:** Share the fallback path across affected flows without changing primary error behavior.

## Implementation notes

- Generic persistence is `src/adapters/cost-history/file.ts`; Pi accounting originates in `src/adapters/llm/pi.ts`.
- Non-Ralph accounting is intentionally fail-open for feature success.

## Out of scope

Changing Ralph failure behavior or exposing raw sessions for recovery.

## Open questions

None.
