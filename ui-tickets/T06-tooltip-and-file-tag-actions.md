# T06 — Single-source tooltips and tag-whole-file action

- status: done
- issues: #16, #17
- priority: medium
- dependencies: T04, T05

## Issue

Interactive controls show duplicate tooltips: the custom tooltip and the browser's native `title` tooltip both appear. The Tag whole file action is too verbose and should present only the tag icon with the custom tooltip.

## Image evidence

- Image #5 (698×200): Tag whole file button includes text that should become icon-only.
- Image #6 (536×200): refresh control displays both custom and native tooltip treatments.

## Proposed fix

Update `src/features/review/ui/components/IconButton.tsx`, `DiffView.tsx`, `MrHeader.tsx`, and any other review UI callers:

1. Make the custom tooltip the only hover/focus explanation for icon controls. Remove duplicate browser `title` attributes where the custom tooltip already supplies the same label; retain titles only where they are intentionally non-tooltip metadata.
2. Render Tag whole file as the tag icon with an accessible name and custom tooltip. Keep its callback and disabled state unchanged.
3. Ensure tooltip content is available on keyboard focus, does not duplicate in the DOM, and remains usable for icon-only controls.

## Acceptance

- Each affected control produces one visible tooltip source, never custom plus browser duplicate.
- Tag whole file is icon-only visually, with accessible name and tooltip text.
- Refresh, sync, find navigation, collapse, copy, and other icon actions keep their labels and callbacks.
- Tooltip behavior works on hover and keyboard focus.

## Tests and verification

- Extend `IconButton.test.tsx` and `DiffView.test.tsx` to assert accessible names and absence of duplicate `title` usage on affected controls.
- Use an interactive DOM render for portal tooltip behavior; do not rely only on static markup for opened tooltips.
- Launch the review UI and hover/focus refresh and Tag whole file; verify one tooltip each and verify tag insertion.
- Task 1 must finish with all gates green: `bun run lint && bun run build && bun test`.

## Focused verification command

```sh
bun test src/features/review/ui/components/IconButton.test.tsx src/features/review/ui/components/DiffView.test.tsx
```
## Stage 1 result — 2026-09-17

- Implementation: kept custom portal tooltips as the single explanation source for icon controls; removed native-title reliance from affected controls; rendered Tag whole file as an icon-only `IconButton` while preserving its path callback and enabled state.
- Changed files: `src/features/review/ui/components/IconButton.tsx`, `src/features/review/ui/components/IconButton.test.tsx`, `src/features/review/ui/components/DiffView.tsx`, `src/features/review/ui/components/DiffView.test.tsx`.
- Focused tests: `bun test src/features/review/ui/components/IconButton.test.tsx src/features/review/ui/components/DiffView.test.tsx` — 48 pass, 0 fail.
- Lint: `bun run lint` — passed.
- Build: `bun run build` — passed.
- Full tests: `bun test` — 861 pass, 0 fail.
- UI smoke: interactive DOM coverage verified keyboard-focus portal tooltip rendering without native `title`, icon-only Tag whole file presentation, Tag callback insertion, and affected toggle behavior. CLI smoke: `bun run src/index.tsx help review` — passed. Browser hover inspection unavailable without authenticated review runtime.

## Stage 2 result — 2026-09-17

- Requirements reviewed: single tooltip source, keyboard-focus availability, icon-only Tag whole file, accessible names, preserved refresh/sync/find/collapse/copy/approval behavior, and unchanged callbacks.
- Findings: none.
- Rework: none.
- Verification: reused Stage 1 focused and canonical gate evidence; no source or test changes during review.

## Final status

`done`
