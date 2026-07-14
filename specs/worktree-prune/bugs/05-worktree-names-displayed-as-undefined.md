# 05 — Worktree names displayed as "undefined" in prompts and error messages

## Description

Worktree names are being rendered as the literal string `"undefined"` in multiple places including:
- Loss summary warnings: "Potential loss for undefined: If you delete this worktree, you will lose the following changes:"
- Error messages: "Normal removal failed for undefined. Force-delete this worktree?"
- Multi-select choice labels may also show "undefined"

This indicates that worktree name/identifier data is not being properly retrieved or passed through to the UI layer.

## Steps to reproduce

1. Run worktree-prune on a repository with extra worktrees
2. Trigger scenarios where worktree names appear:
   - Multi-select prompts for choosing worktrees
   - Force-delete confirmation after failed removal
   - Potential loss warning messages
3. Observe "undefined" appearing where actual worktree names should be

## Expected behavior

- Worktree names/paths are correctly resolved from the VCS layer
- Prompts display actual worktree identifiers (branch name or path)
- Error and warning messages contain meaningful identifiers for user context

## Actual behavior

- The literal string "undefined" appears in all places where worktree names should be shown
- Users cannot identify which specific worktree is being referenced in prompts or errors

## Impact

**Severity:** High — This severely degrades usability. Users cannot:
- Make informed decisions about which worktrees to delete when names show as "undefined"
- Understand what they might lose (changes summary references unknown items)
- Trust error messages during troubleshooting

## Related tickets

- **03** — Discover and normally prune selected worktrees (worktree data is retrieved here)
- **04** — Handle failed removal with optional loss summary (error/warning messages rendered here)

## Proposed fix direction

- Verify that `GitAdapter.worktrees()` returns proper name/path fields in the worktree objects
- Check how worktree records are mapped to UI choice labels and message templates
- Inspect VCS contract to ensure name identification is part of the typed response
- Add fallback identification logic (e.g., use path if name is missing, but never allow "undefined" string through)
- Unit test edge cases where worktree metadata might be incomplete
