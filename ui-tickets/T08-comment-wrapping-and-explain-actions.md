# T08 — Comment wrapping, diff width, and Explain action placement

- status: done
- issues: #20, #21
- priority: high
- dependencies: T01, T04, T06, T07

## Issue

Comments in the main review view do not wrap correctly. Their width pushes the code diff section wider and creates horizontal scrolling. Explain and its orange action need to move into the same compact action treatment used by the Agent send-message control.

## Image evidence

- Image #1 (1568×474): long review comment content occupies the diff area and demonstrates the width-pressure context.
- Image #11 (564×268): review discussion card and Explain action treatment.
- Image #12 (686×552): Agent/review layout where long content can widen the main view.

## Proposed fix

Update `src/features/review/ui/components/DiffView.tsx`, `ChatPane.tsx` where general discussions are rendered, `CommentDraft.tsx`, and shared markdown/layout styles:

1. Constrain comment/discussion content to its container with `min-width: 0`, safe word/path wrapping, bounded code/pre/table overflow, and `max-width` appropriate for readable prose.
2. Ensure discussion rows and inline comment cells do not force the diff table or center column wider than the shell. Horizontal scrolling is allowed inside code/pre/table regions only where content genuinely needs it.
3. Move Explain and the related orange action into one compact, consistently aligned action group modeled after the Agent composer action pattern. Keep labels, loading/disabled state, endpoint callback, and error handling unchanged.
4. Preserve markdown sanitization, file links, inline discussion collapse/expand, comment draft editing/preview/send/retry, and line-selection behavior.

## Acceptance

- Long prose, URLs, file paths, and inline code wrap within comment/discussion cards.
- Main review page has no unintended horizontal scrollbar caused by comments; diff remains usable at narrow widths.
- Code blocks/tables scroll internally when required and do not widen the page.
- Explain and orange action sit in one aligned action group, with accessible names and unchanged behavior.
- Markdown rendering, discussion state, draft state, and file-reference actions remain intact.

## Tests and verification

- Extend `DiffView.test.tsx`, `ChatPane.test.tsx`, and `CommentDraft.test.tsx` for long content structure, action placement, disabled/loading Explain, and preserved draft/discussion behavior.
- Launch the review UI with long comments, long URLs, fenced code, and tables at 1280px and narrow widths; verify no page-level horizontal scroll.
- Exercise Explain and confirm it creates/selects the expected chat while showing the correct busy state.
- Task 1 must finish with all gates green: `bun run lint && bun run build && bun test`.

## Focused verification command

```sh
bun test src/features/review/ui/components/DiffView.test.tsx src/features/review/ui/components/ChatPane.test.tsx src/features/review/ui/components/CommentDraft.test.tsx src/shared/markdown.test.ts
```

## Stage record

- Stage 1 — Implement: Added container-safe wrapping for DiffView discussions, ChatPane general discussions, CommentDraft, CommentMarkdown, and shared Markdown output. Added bounded fenced-code regions, internally scrollable table wrappers, explicit diff-table width bounds, compact primary Explain action groups, accessible busy state, and focused coverage. Changed files: `src/features/review/ui/components/DiffView.tsx`, `src/features/review/ui/components/ChatPane.tsx`, `src/features/review/ui/components/CommentDraft.tsx`, `src/features/review/ui/components/CommentMarkdown.tsx`, `src/features/review/ui/app.css`, `src/shared/markdown.ts`, `src/features/review/ui/components/DiffView.test.tsx`, `src/features/review/ui/components/ChatPane.test.tsx`, `src/features/review/ui/components/CommentDraft.test.tsx`, `src/shared/markdown.test.ts`. Focused tests passed: 75. First canonical run stopped at `bun run lint` on DiffView import ordering/JSX formatting; build and full test commands did not run in that attempt.
- Stage 2 — Review: Requirements review covered wrapping/overflow, internal code/table scrolling, Explain placement/accessibility/loading, markdown sanitization, file links, discussion collapse/expand, draft states/actions, and line selection. Fixed DiffView import/formatting diagnostics, added `.diff-table` `width`/`max-width` bounds, and corrected one markdown test assertion's formatter layout. Source/tests changed, so focused tests and canonical gates were rerun.
- Final status: done — completed 2026-09-17. Focused tests: 75 passed. Canonical gates: `bun run lint` passed, `bun run build` passed, `bun test` passed with 861 tests. Browser/viewport live-MR smoke was unavailable without authenticated MR/agent runtime; DOM smoke covered long prose/URLs/paths, inline/fenced code, tables, Explain callback/grouping, disabled/busy state, and draft/discussion behavior. CLI smoke `bun run src/index.tsx help review` passed. No verification reused.
