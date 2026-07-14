# 02 — Multi-select state not cleared between repository groups

## Description

When multiple repositories are presented for worktree selection, selecting all worktrees in the first group causes all worktrees to be pre-selected in subsequent groups. The multi-select state persists across separate repository prompts instead of resetting.

## Steps to reproduce

1. Have at least two Git repositories with extra worktrees
2. Run worktree-prune
3. Multi-select (select all) worktrees for the first repository group
4. Observe the prompt for the second repository group — all items are pre-selected

## Expected behavior

- Each repository's multi-select prompt should start with a clean state (no items selected by default, or at least not inheriting selection from previous prompts)
- Selection choices made in one repository prompt should not affect subsequent repository prompts

## Actual behavior

- After selecting all items in the first repository prompt, the second repository prompt shows all items as pre-selected
- User must manually deselect items they don't want to remove

## Impact

**Severity:** High — This could lead to accidental deletion of worktrees the user did not intend to remove. Users expecting fresh selections per repo might make unintended choices without carefully reviewing each prompt.

## Related tickets

- **03** — Discover and normally prune selected worktrees (multi-select prompts are defined here)

## Proposed fix direction

- Ensure `UiPort.multiSelect()` is called with fresh/unselected state for each repository
- If the selection array/references persist across calls, create new selections per prompt
- Review how multi-select choices are constructed and passed between iterations in the discovery loop
