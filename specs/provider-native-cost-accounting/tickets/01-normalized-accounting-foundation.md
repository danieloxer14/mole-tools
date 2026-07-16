# 01 — Establish normalized LLM accounting foundation

## What to build

Introduce the provider-neutral accounting contract used by every LLM operation: normalized input/output/cache usage, USD provenance, provider/model attribution, optional provider session ID, and sanitized diagnostics. Make the shared price catalog serve both adapters and Ralph.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] Cost entries accept only `type: "llm"` with provider/model, optional normalized usage, and a USD outcome; only `unavailable` omits an amount.
- [ ] The catalog retains reported USD as `actual`, estimates all usage dimensions, yields zero for local providers, and yields unavailable for unlisted cloud models.
- [ ] Diagnostics are bounded and remove temporary paths, prompt/session content, credentials, and stacks.
- [ ] Ralph aggregation consumes the shared types/catalog while retaining phase and iteration attribution.

## Test approach

**Test type:** unit and schema  
**Test file/area:** `src/core/cost-tracker.test.ts`, `src/shared/ralph-cost.test.ts`, new shared-cost tests  
**Validate with:** `bun test src/core/cost-tracker.test.ts src/shared/ralph-cost.test.ts`

### Red-Green strategy

1. **Red:** Add schema, catalog, cache-rate, unknown-model, and sanitizer cases.
2. **Green:** Define normalized port/tracker values and extract Ralph pricing into shared code.
3. **Refactor:** Delete duplicate Ralph-only pricing while tests remain green.

## Implementation notes

- Current port values are in `src/ports/llm.ts`; generic entries are in `src/core/cost-tracker.ts`.
- `src/shared/ralph-cost.ts` currently owns `RALPH_MODEL_PRICING` and Ralph derivation.
- This is a breaking contract; do not retain compatibility shapes.

## Out of scope

Provider adapters, history migration, and cost-breakdown redesign.

## Open questions

None.
