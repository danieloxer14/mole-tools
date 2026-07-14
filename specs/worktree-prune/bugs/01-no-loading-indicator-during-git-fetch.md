# 01 — No loading indicator during git fetch

## Description

When the worktree-prune command runs and performs a `git fetch` operation, there is no visual feedback or loading indicator to inform the user that background work is in progress. The terminal appears completely frozen/unresponsive with no output.

## Steps to reproduce

1. Ensure at least one repository has remote-tracking branches that need updating
2. Run the worktree-prune command
3. Observe that during the git fetch phase, nothing is displayed on screen

## Expected behavior

- A loading indicator or status message should be shown while `git fetch` runs
- User should have clear visibility that the tool is still active and working

## Actual behavior

- Terminal appears completely frozen with no output during git fetch
- User has no indication anything is happening

## Impact

**Severity:** Medium — Users may think the tool hung or crashed and could interrupt it prematurely.

## Related tickets

- **03** — Discover and normally prune selected worktrees (git fetch would occur during discovery)

## Proposed fix direction

- Display a spinner or "Fetching repository information..." message while git fetch runs
- Ensure status messages are flushed properly in the Ink terminal environment
- Consider using Ink's built-in loading/spinner components if available
