# 06 — Streamed output prevents terminal scrolling

## Description

The streamed output from the Ink terminal prevents scrolling up through previous content. When trying to scroll up in the terminal while worktree-prune is running, the view immediately snaps back to the bottom instead of staying at the earlier position.

## Steps to reproduce

1. Run worktree-prune so that it produces multiple prompts/output
2. As output streams and prompts appear, attempt to scroll up in the terminal
3. Observe that the terminal immediately scrolls/snap back to the bottom

## Expected behavior

- Users should be able to scroll up to review earlier prompts, selections made, or status messages while the tool is still running
- Terminal scroll position should remain where placed until explicitly changed

## Actual behavior

- Scrolling up causes an immediate snap-back to the current bottom of output
- No way to review previous content during execution

## Impact

**Severity:** Low-Medium — Not blocking, but significantly reduces usability. Users cannot:
- Review earlier multi-select choices they made without memorizing them
- See status messages that scrolled off-screen
- Verify what worktrees were selected in previous repository prompts

## Related tickets

- **03** — Discover and normally prune selected worktrees (streamed output occurs here)
- **04** — Handle failed removal with optional loss summary (output continues streaming here)

## Proposed fix direction

- Review Ink component rendering — frequent re-renders of the full tree may be forcing terminal cursor to bottom
- Consider using static/persistent text components for earlier content rather than re-rendering everything each tick
- Investigate Ink scroll behavior flags or keep-alive options for historical output
- May need a "review" mode or transcript logging approach rather than real-time scrolling
