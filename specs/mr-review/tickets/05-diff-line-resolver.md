
# 05 — Diff-line resolver (port from mr-reviewer)

## What to build

Port the diff hunk parser and line-position resolver from the mr-reviewer app. Given a per-file unified-diff string, parse `@@ -old,startLines +new,startLines @@` hunks and resolve `{ new_line?, old_line? }` for any target line number within that file's range. Supports nearest-line snapping fallback when the exact line isn't in any hunk.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] Given a unified diff with hunks, resolve an exact target line to its correct `new_line` / `old_line` pair
- [ ] Added lines (present only in new file) resolve to `new_line` only
- [ ] Removed lines (present only in old file) resolve to `old_line` only
- [ ] When target line isn't in any hunk, snap to the nearest line in a hunk and set `snappedFrom` to indicate the direction of snapping
- [ ] Multi-hunk files: resolves correctly across all hunks
- [ ] Empty or malformed diff → graceful handling (no throw, returns null for unresolvable lines)

## Test approach

**Test type:** unit
**Test file/area:** `src/shared/diff-line-resolver.test.ts`
**Validate with:** `bun test src/shared/diff-line-resolver.test.ts`

### Red-Green strategy

1. **Red**: Write a test with a two-hunk diff patch (one addition, one modification). Assert that resolving line 5 in the first hunk returns the expected `{ new_line: 7 }`. Fails because resolver doesn't exist yet.
2. **Green**: Implement the hunk parser + line tracker. Walk through lines of hunk, counting old/new positions, building a map. Exact-match test passes.
3. **Red (snapping)**: Write test asserting that resolving a line between hunks snaps correctly and `snappedFrom` is set. Fails because snapping logic not implemented yet.
4. **Green**: Add nearest-line snapping. Snapping test passes. Regress full suite (`bun test`).
5. **Refactor**: Clean up the hunk parser while tests remain green. Extract helper types (Hunk, Line) if they improve readability. Run full suite.

## Implementation notes

- Place at `src/shared/diff-line-resolver.ts` — pure string parsing, reusable across features.
- The mr-reviewer's `diffLineResolver.ts` is the source to port from (`/Users/danieloxer/dev/mr-reviewer`). Read its approach but adapt to mole-tools' unified-diff format (glab-sourced, not git-local).
- The resolver takes `(fileDiff: { path: string, patch: string }, targetLine: number)` and returns `{ new_line?: number; old_line?: number; snappedFrom?: "above" | "below" }` or `null`.
- Context lines (` `) advance both old and new line counters. Additions (`+`) advance only new. Deletions (`-`) advance only old.
- Snapping: when targetLine > all hunks' range, snap to last line in last hunk. When targetLine < first hunk's start, snap to first line in first hunk. Between hunks, snap to nearest end/start boundary.

## Out of scope

- Actual diff fetching from GitLab (ticket 07)
- Inline comment posting via GitHost (ticket 08)

## Open questions

None
