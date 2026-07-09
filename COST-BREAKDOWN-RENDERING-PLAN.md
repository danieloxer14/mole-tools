# Cost Breakdown Rendering + Git Cost Fix Plan

**Status:** Planned
**Date:** 2026-07-09

## Goal
Fix the cost breakdown display so it renders model costs in a readable table, and correct Git cost tracking so Git commands are recorded as command-text input only, with `outputTokens = 0`.

## Decisions
- Fix both cost displays:
  - `src/features/cost-breakdown/format.ts`
  - `src/index.tsx` (`formatCostSavingsTable`)
- Use a shared table renderer.
- Git entries should record the **full command string** as the task.
- Git `outputTokens` should be **0**.
- Git command text should be treated as **input tokens**.

## Proposed design
Create a shared table renderer, likely in `src/shared/table-renderer.ts` or similar, that:
- accepts headers + rows
- computes column widths
- renders aligned monospace tables for terminal output
- supports reuse by both cost summary surfaces

Keep cost estimation logic separate from rendering logic.

## Phase 1 — Add shared table renderer
### Changes
- Add a reusable table renderer in `src/shared/`
- Decide on a small API for:
  - headers
  - row values
  - optional alignment/padding

### Output shape
The renderer should support output like:

```text
Model      In       Out      Cache W   Cost
Haiku 4.5  29012    21038    29012     $0.17
Sonnet 5   29012    21038    29012     $0.51
Opus 4.8   29012    21038    29012     $0.85
```

### Tests
- empty table
- one row
- multiple rows with different widths
- alignment stays stable

## Phase 2 — Switch cost summary formatting to the renderer
### Changes
- `src/features/cost-breakdown/format.ts`
  - replace comma-separated model lines with table output
  - keep session totals above the table
- `src/index.tsx`
  - update savings summary to use the same renderer

### Notes
The current breakdown should still show:
- total session tokens
- per-model costs
- per-entry details

But the model cost block should become structured and readable.

### Tests
- `src/features/cost-breakdown/index.test.ts`
- any tests covering `formatCostSavingsTable`
- verify the new shape includes headers and aligned columns

## Phase 3 — Fix Git cost recording
### Changes
- `src/adapters/vcs/git.ts`
  - record `task` as the full command string, e.g. `git commit --file -`
  - set `outputTokens: 0`
  - set `inputTokens` from command text (and stdin when applicable)

### Important behavior
For Git, the output is not model output, so it should not be priced as such.
The token record should represent command-text input only.

### Tests
- `src/adapters/vcs/git.test.ts`
  - assert task name is the full command
  - assert input token accounting uses the command text
  - assert output tokens are zero
  - preserve current execution tests

## Phase 4 — Shared cost formatting cleanup
### Changes
- Move any repeated table formatting helpers into the shared renderer
- Ensure both summary surfaces use the same formatting code path
- Remove any old comma-separated formatting helpers if no longer needed

### Tests
- regression test for both output surfaces using the shared renderer
- ensure formatting changes don’t alter token math

## Suggested implementation order
1. Add shared table renderer
2. Update cost-breakdown display
3. Update live savings display
4. Fix Git cost recording
5. Update tests

## Risks / open questions
- Whether Git stdin should be counted as input tokens in all commands, or only commands that actually receive stdin
- Whether the table renderer should support multi-line cells now or later
- Whether the renderer should be used for any other terminal summaries after this
