# 04 — Add `RalphCostRecord` schema and require `costLedger` in Ralph state

## What to build

Zod schemas for `RalphCostRecord` are defined and wired into the existing `RalphStateFileSchema`. After this change, every new Ralph state file must include a valid `costLedger` array. State files that lack `costLedger` or contain malformed ledger entries fail validation with a structured `RalphError`. The schema reflects all fields from the spec: UUID id, phase enum, optional iteration, provider, model, timestamps, ok flag, usage, and optional usdCost.

Existing code paths that create Ralph state (init, run) will also need to supply an empty or populated ledger — but recording individual records is tickets 05-06. This ticket only establishes the schema contract.

## Blocked by

01 — needs `LlmUsage` and `UsdCost` types for the usage/usdCost subfields
03 — pulls in the record shape used by aggregation

## Status

ready-for-agent

## Acceptance criteria

- [ ] `RalphCostRecordSchema` Zod object defined with all spec fields: `id` (UUID string), `phase` (`"init"` | `"implement"` | `"reflect"`), optional `iteration` (non-negative int), `provider` (string), `model` (string), `startedAt`/`completedAt` (numbers), `ok` (boolean), `usage` (LlmUsage shape), optional `usdCost` (UsdCost shape)
- [ ] `RalphStateFileSchema` requires a `costLedger` field of type `RalphCostRecord[]`
- [ ] Parsing a state file missing `costLedger` throws a structured validation error
- [ ] Parsing a state file with a malformed ledger entry (wrong types, missing required fields) throws a structured validation error
- [ ] Parsing a state file with valid `costLedger: []` (empty array) succeeds
- [ ] Existing `writeState()` rejects states without `costLedger` via the schema validation already in place
- [ ] All existing tests for RalphStateFileSchema continue to pass after adding the new required field

## Test approach

**Test type:** unit
**Test file/area:** `src/features/ralph/schema.test.ts` — add tests alongside existing state-file parsing tests
**Validate with:** `bun test src/features/ralph/schema.test.ts`

### Red-Green strategy

1. **Red**: Write tests asserting: (a) a valid ledger record round-trips through the schema; (b) state missing `costLedger` fails validation; (c) state with malformed records (e.g., non-UUID id, phase not in enum, negative iteration) fails; (d) empty ledger array succeeds. These will fail because `costLedger` isn't defined yet.
2. **Green**: Add `RalphCostRecordSchema` as a new Zod object alongside the existing schemas. Update `RalphStateShape` to require `costLedger: z.array(RalphCostRecordSchema)`. Update all existing test fixtures that create RalphStateFile objects to include `costLedger: []`.
3. **Refactor**: Ensure the record schema shares types with the port definitions rather than duplicating shapes — import or re-export `LlmUsage`/`UsdCost` where possible.

## Implementation notes

- File: `src/features/ralph/schema.ts` — add the new schemas here with existing patterns
- The spec defines three phase values: `"init"`, `"implement"`, `"reflect"`. Define a Phase enum or use a literal union in Zod.
- `iteration` is optional but only present for `"implement"` and `"reflect"` phases tied to a specific worker iteration (not init, not final reflection).
- Existing test fixtures in `schema.test.ts`, `persistence.test.ts`, and any Ralph integration tests will need `costLedger: []` added to their state objects — this is straightforward but touches many files.
- The spec explicitly says "State files without it are invalid; migration is out of scope." So no backward-compat preprocessor for missing `costLedger`.
- Use `crypto.randomUUID()` pattern for the id field type (just validate it as a string with UUID regex or Zod's `.uuid()`).

## Out of scope

- Actually recording cost records during init/run — that's tickets 05 and 06
- Cost derivation or aggregation logic — that's ticket 03
- Terminal cost-summary output — that's tickets 05 and 06

## Open questions

None
