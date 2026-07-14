# 04 — Force-delete prompt loops when declined

## Description

When a user answers "no" to the force-delete confirmation question for a worktree, the tool appears to loop back and ask the same force-delete question again instead of moving on. The user is stuck in a cycle of being asked to force-delete a worktree they already declined.

## Steps to reproduce

1. Select worktrees including ones that will fail normal removal
2. When prompted "Force-delete this worktree?" for a failed worktree, answer "no" or decline
3. Observe that the same force-delete question is presented again for the same worktree
4. Answering "no" again results in the prompt repeating indefinitely

## Expected behavior

- Declining the force-delete question should:
  - Skip force removal for that specific worktree
  - Record a skip/failure result
  - Move on to the next worktree or conclude the operation
  - Eventually display a summary of outcomes including which worktrees were skipped

## Actual behavior

- After declining, the same force-delete prompt repeats
- User is trapped in an apparent infinite loop for that worktree
- Only workaround may be to cancel the entire operation

## Impact

**Severity:** Critical — This can trap users in an unrecoverable state requiring them to kill/cancel the command entirely. This represents a broken control flow and poor user experience.

## Related tickets

- **04** — Handle failed removal with optional loss summary (force-delete logic lives here)

## Proposed fix direction

- Review the force-delete confirmation loop logic in ticket 04's implementation
- When declined, ensure the worktree is marked as "skipped" and iteration advances to the next item
- Add guard clauses or state tracking to prevent re-prompting already-decided worktrees
- Verify that decline path doesn't fall through to same prompt again due to missing break/continue
