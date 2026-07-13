# Bug 03 — Cost calculation misattributes output tokens and double-counts git operation costs

## What to fix

The cost breakdown displayed after the merge-request flow is inaccurate in two ways:
1. Git operations count **output** tokens as if they were input costs, when only the user's input command should be charged (the output feeds the next step).
2. `GIT-HOST` shows 0 tokens both ways, cluttering the cost summary with a useless line.

### Observed behavior

- Git commands (e.g., diff collection, log) show non-zero output token counts in the breakdown.
- The output from one LLM step is used as input for the next step but appears charged separately.
- `GIT-HOST` appears in the cost table with 0 in / 0 out tokens.

### Expected behavior

- Only the **input** prompt sent to each model counts toward cost — the streamed output passes to the next step and should not be double-counted.
- Git adapter commands that do not call an LLM (like `GIT-HOST`) with 0 token usage should be omitted from the breakdown entirely.
- The final summary line should reflect only real input-token spend per model.

## Blocked by

None — investigate CostTracker behavior during git operations and pipeline composition.

## Status

fixed

## Implementation summary

1. **Removed cost tracking from `GitAdapter`**:
   - Git operations are CLI commands, not LLM calls — they should not record token costs at all.
   - Removed `CostTracker.record(...)` calls from `exec()` and `execIn()` methods.
   - Removed unused imports for `CostTracker` and `estimateTokens` from the git adapter.
   - Updated `context.ts` to no longer pass `costTracker` to `GitAdapter` constructor.

2. **Added zero-token filtering in breakdown renderer**:
   - Added guard `if (entry.inputTokens === 0 && entry.outputTokens === 0) return null;`
     in `formatEntriesTable()` to filter out non-LLM operations like `GIT-HOST`.
   - Changed "Out" column display from raw `entry.outputTokens` to the cost-adjusted
     `entryUsage.outputTokens`, so git entries (which have output zeroed for costing) now
     show 0 in the Out column rather than misleading estimated values.

3. **Added unit test**:
   - New test case verifies that 0/0 token entries (like GIT-HOST) are excluded from
     the rendered breakdown while LLM entries still appear correctly.

## Acceptance criteria

- [x] Git operations that don't call an LLM (or call it with 0 tokens) are omitted from the cost breakdown table.
- [x] Only input tokens per Ollama call are displayed — output tokens feeding into subsequent steps are not counted again.
- [x] The final total accurately reflects actual token spend (no double-counting across pipeline stages).
- [x] `GIT-HOST` row is absent from the table (or any other 0/0 provider).

## Reproduction steps

1. Run `mole-tools --merge-request` on a branch with Jira context and ahead-of-base commits.
2. Observe the cost breakdown printed after completion.
3. Note that `GIT-HOST` shows as 0 in / 0 out.
4. Note that git operation steps appear to count output tokens in addition to input.

## Test approach

**Test type:** unit (CostTracker) + manual
**Validate with:** mock a pipeline where output of step A feeds into step B and verify only step A's input is counted; confirm 0-token providers don't render in the breakdown table.

## Implementation notes

- Check how `CostTracker` aggregates tokens across composed async tasks — it may be counting completion tokens from one LLM call as separate usage when they're passed downstream.
- Git commands that query an API without invoking an LLM (or invoke with empty prompts) should either not log a cost entry at all, or the renderer should filter out 0-token lines.
- The breakdown rendering logic needs a guard like `if (inputTokens === 0 && outputTokens === 0) continue`.

## Out of scope

- Rewriting CostTracker — only need to fix aggregation double-counting and render filtering.
