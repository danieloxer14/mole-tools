# 03 — No loading indicator during worktree removal and between prompts

## Description

After selecting worktrees to remove, there is no visual feedback shown while the removal commands execute. This same issue occurs between force-deletion confirmation questions, leaving the terminal appearing frozen during actual git operations.

## Steps to reproduce

**Scenario A — Normal removal:**
1. Select one or more worktrees via multi-select prompt
2. Confirm selection
3. Observe that during `git worktree remove` execution, nothing is displayed on screen

**Scenario B — Between force-delete prompts:**
1. Select a worktree that fails normal removal
2. Decline or accept the force-delete question
3. Observe that while waiting for the next prompt or during the force operation, there's no loading indicator

## Expected behavior

- A loading/spinner or status message should appear while `git worktree remove` commands execute
- Between prompts (especially after confirmation), progress indicators should be shown during async git operations
- Users should clearly see that removal work is in progress

## Actual behavior

- Terminal appears completely frozen with no output during worktree removal
- Same issue occurs between sequential force-delete confirmation prompts
- User has no feedback that operations are executing

## Impact

**Severity:** Medium — Same as bug #01 but in a different flow. Users may think the tool crashed after confirming their selections.

## Related tickets

- **03** — Discover and normally prune selected worktrees (normal removal executes here)
- **04** — Handle failed removal with optional loss summary (force-delete prompts happen here)

## Proposed fix direction

- Add loading indicators around `git worktree remove` execution blocks
- Show "Removing X worktrees..." or similar status during batch removals
- Ensure Ink components flush output properly between sequential prompts
- Consider progressive updates like "Removing worktree 1/3..." for better UX
