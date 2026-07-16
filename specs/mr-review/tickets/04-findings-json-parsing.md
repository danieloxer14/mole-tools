
# 04 — Findings JSON defensive parsing

## What to build

Defines the `ParsedFinding` type (spec §5.8 shape, minus re-review fields) and a `parseFindingsJson(raw: string)` function that never throws: bad JSON → empty array, non-array root → empty array, per-item validation drops only bad items while keeping the rest. This is the defensive parser used by both agent output handling and the dedupe pass.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] `ParsedFinding` type matches spec: severity (critical|important|minor|recommendation), filePath, lineStart, lineEnd, description, fix, suggestion, optional category/funMessage
- [ ] Valid JSON array of correctly-shaped findings → all items returned
- [ ] Invalid JSON string → empty array (no throw)
- [ ] Valid JSON but non-array root (object, string, number) → empty array (no throw)
- [ ] Array with some valid items and one item with bad severity → bad item dropped, valid items kept
- [ ] Item with `filePath: null` has its `lineStart`, `lineEnd`, `suggestion` coerced to `null`
- [ ] Valid findings array where item is missing `description` → that item dropped

## Test approach

**Test type:** unit
**Test file/area:** `src/features/mr-review/findings.test.ts`
**Validate with:** `bun test src/features/mr-review/findings.test.ts`

### Red-Green strategy

1. **Red**: Write a test asserting that `"not json at all"` returns `[]`. Fails because function doesn't exist yet.
2. **Green**: Implement the defensive parser: try-catch JSON.parse, check array, validate each item with zod or manual checks, drop bad items. Test passes.
3. **Red (per-item)**: Write test with a mixed array where one item has an invalid severity (`"urgent"` instead of valid enum). Assert that item is dropped but others remain.
4. **Green**: Add per-item validation logic. Per-item test passes. Regress full suite.
5. **Refactor**: Extract the Zod schema for `ParsedFinding` into its own small reusable module if it's referenced from multiple callers (dedupe, publish). Run full suite green.

## Implementation notes

- Mirror mr-reviewer's `parseFindingsJson` behavior: defensive parse, degrade to `[]`, never throw.
- Use zod `z.coerce` or manual per-item validation. The key invariant: the function must NEVER throw regardless of input. Each bad item is silently dropped.
- The Zod schema can be `z.array(parsedFindingSchema).optional().default([])` but with individual item catch — if one item fails, don't fail the whole array.
- Category field is optional and defaults to the agent id at write time (not in parsing — set by caller when writing the findings file).

## Out of scope

- Writing findings files to disk (ticket 06/09)
- LLM output formatting (handled by agent prompts)

## Open questions

None
