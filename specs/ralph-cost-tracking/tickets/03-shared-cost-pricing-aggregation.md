# 03 — Shared model-price catalog, cost derivation, and aggregation functions

## What to build

Pure functions in `src/shared/` (or a logical subdirectory) that implement the provider-neutral pricing logic:

1. **Model-price catalog** — a lookup table of known models with per-million-token input/output rates. Must be model-specific; must NOT reuse the existing Claude comparison table from `cost-breakdown/format.ts`.
2. **Cost derivation** — given an `LlmUsage`, provider key, and model name: preserve existing actual `usdCost` unchanged; return exact `$0` (source `"zero"`) for cataloged local/self-hosted models; calculate USD from catalog rates (source `"estimated"`) for cataloged priced models; return no USD value for unlisted models.
3. **Aggregation** — group `RalphCostRecord[]` by iteration to compute per-iteration subtotals, keep init and final reflection as separate labelled rows, sum full-loop totals with correct provenance labelling (`actual`, `estimated`, `zero`, or `"USD unavailable"` when any record lacks USD).
4. **Summary formatting** — produce the Ralph cost-summary text table matching the spec's examples (loop name, status, per-row token/USD columns, full total row with provenance label).

## Blocked by

01 — needs the `LlmUsage`/`UsdCost` types and `RalphCostRecord` shape
03 doesn't depend on 02; it works at the shared/pure-function layer with typed inputs

## Status

ready-for-agent

## Acceptance criteria

- [ ] A model-price catalog exists as a simple lookup (map or array) keyed by provider+model identifiers, not by the existing Claude comparison names
- [ ] `deriveUsdCost(usage, usdCost, providerKey, modelName)` returns unchanged actual costs when already provided `{ amount, source: "actual" }`
- [ ] Cataloged local/self-hosted models return `{ amount: 0, source: "zero" }`
- [ ] Cataloged priced models calculate USD from input/output/cache rates and return source `"estimated"`
- [ ] Unlisted cloud models return `undefined` (no USD) so callers display "USD unavailable"
- [ ] Token counts are preserved regardless of whether USD is available
- [ ] Aggregate function groups records by iteration, keeps init/final-reflection separate, computes full-loop totals with correct provenance blending
- [ ] Summary formatter produces output matching the spec's example tables (with and without cache columns)
- [ ] All functions are pure — no I/O, no mutations

## Test approach

**Test type:** unit
**Test file/area:** `src/shared/cost-ledger.test.ts` (new file) or alongside existing cost-estimate tests
**Validate with:** `bun test src/shared/cost-ledger.test.ts`

### Red-Green strategy

1. **Red**: Write unit tests for each pricing branch: (a) actual USD preserved unchanged; (b) local model returns `$0`; (c) cataloged model calculates correct estimate from known token counts and rates; (d) unlisted model returns undefined. Write aggregation test with a seeded ledger of known records checking iteration grouping, provenance blending, and total computation. Write formatting test comparing output against spec examples.
2. **Green**: Implement the pure functions: catalog data structure, `deriveUsdCost()` or named equivalent, `aggregateLedger()`, and `formatCostSummary()`. Cache read/write token handling follows the same multiplier pattern from existing `cost-estimate.ts` if needed but adapted to the new usage shape.
3. **Refactor**: Ensure naming aligns with spec terminology (`RalphCostRecord`, `iteration subtotal`, `full-loop total`). Extract any repeated provenance-blending logic into a small helper.

## Implementation notes

- New file: `src/shared/cost-ledger.ts` (or `src/shared/ralph-cost.ts`) alongside `cost-estimate.ts`. Keep it separate — the spec explicitly says NOT to alter the existing generic `cost-breakdown` feature or its historical JSONL format.
- The existing `cost-estimate.ts` has a Claude pricing table for comparison purposes only. The new catalog must be model-specific (provider + model name) and used for actual Ralph cost calculation, not just comparison.
- Cache token handling: the new `LlmUsage` includes optional `cacheReadTokens`/`cacheWriteTokens`. Pricing should apply appropriate multipliers per catalog entry (or per-provider defaults). If a model's rate card doesn't include cache pricing, omit cache tokens from the calculation rather than guessing.
- Provenance blending rules: "actual" takes precedence over "estimated"; if all values are "zero", label as "zero"; if any record has no USD at all, the total is "USD unavailable". A mix of actual and estimated = "estimated".
- The spec shows two formatting examples — one with cache columns when available, one without. The formatter should adapt column display based on whether any records contain cache token data.

## Out of scope

- Ralph state schema changes for `costLedger` — that's ticket 04
- Integrating cost recording into `ralph init` or `ralph run` — that's tickets 05 and 06
- Parsing Pi events — that's ticket 02

## Open questions

None
