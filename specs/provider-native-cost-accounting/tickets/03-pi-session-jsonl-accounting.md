# 03 — Account Pi runs from completed session JSONL

## What to build

Make both Pi operations create a mole-tools-owned temporary session directory, capture the JSON-stream session ID, then derive settled normalized usage and USD only from the matching completed JSONL. Remove the directory for every terminal outcome.

## Blocked by

01 — Establish normalized LLM accounting foundation

## Status

ready-for-agent

## Acceptance criteria

- [ ] Pi launches with `--mode json --session-dir` in an OS temporary directory and never relies on `HOME`, `~/.pi`, persisted session paths, or raw JSONL retention.
- [ ] Matching completed JSONL input/output/cache/USD wins over contradictory stream usage and supplies provider session ID.
- [ ] Header/JSONL defects, ID mismatch, invalid usage, process failure, cancellation, and persistence failure raise a typed sanitized accounting error and clean up the directory.
- [ ] Absent JSONL USD uses shared estimated/zero/unavailable derivation; defects never use text-token estimates.

## Test approach

**Test type:** fixture-driven adapter integration  
**Test file/area:** `src/adapters/llm/pi.test.ts`, focused parser/session helper tests, `test/fixtures/`  
**Validate with:** `bun test src/adapters/llm/pi.test.ts`

### Red-Green strategy

1. **Red:** Add fixtures for matching totals, contradictory stream data, catalog outcomes, and every cleanup failure path.
2. **Green:** Extract shared process/session lifecycle and completed-JSONL parser for `generate()` and `runAgent()`.
3. **Refactor:** Separate process orchestration from parser and normalization.

## Implementation notes

- Current adapter/tests: `src/adapters/llm/pi.ts`, `src/adapters/llm/pi.test.ts`.
- The completed matching JSONL is authoritative, not root-level stream usage.

## Out of scope

Raw session retention, a recovery queue, or a recovery command.

## Open questions

None.
