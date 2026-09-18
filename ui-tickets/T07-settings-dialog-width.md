# T07 — Review settings dialog width and responsive contents

- status: done
- issue: #18
- priority: medium
- dependencies: T01

## Issue

The Review Settings modal is too narrow. Its two-column contents and prompt editor are clipped, forcing users to scroll or hiding controls.

## Image evidence

- Image #4 (1002×1568): Settings modal editor is clipped on the right and does not expose all contents.

## Proposed fix

Update `src/features/review/ui/main.tsx`, `src/features/review/ui/components/SettingsPanel.tsx`, and dialog/layout styles:

1. Give the dialog a bounded viewport-relative width and height with internal scrolling rather than clipping its editor.
2. Preserve the two-pane slot navigation/editor layout on wide screens; collapse to a usable single-column layout at narrow widths.
3. Keep prompt text, preset, version, agent, model, save/reset, close, and error controls visible and keyboard reachable.
4. Preserve native select markup, settings API calls, close behavior, focus return, and Escape/backdrop dismissal.

## Acceptance

- Full settings content is reachable without horizontal clipping at supported desktop widths.
- Narrow view remains usable without page-level horizontal scrolling.
- Dialog has correct modal semantics and closes through Close, Escape, and backdrop interaction.
- Existing settings values, prompt editing, preset/version selection, save/reset, and error states remain unchanged.

## Tests and verification

- Extend `SettingsPanel.test.tsx` for responsive layout hooks and preserved select/option markup.
- Add an interactive dialog smoke test for open, focus, Escape close, backdrop close, and focus return.
- Launch the review UI at desktop and narrow viewport sizes and inspect all settings controls and prompt text.
- Task 1 must finish with all gates green: `bun run lint && bun run build && bun test`.

## Focused verification command

```sh
bun test src/features/review/ui/components/SettingsPanel.test.tsx
```
## Stage 1 result — 2026-09-17

- Implementation verified: viewport-bounded settings dialog with internal scrolling, narrow single-column and wide two-pane layouts, wrapped controls, min-width-safe fields, labelled Prompt slots navigation, preserved native selects, and unchanged settings behavior.
- Changed files: `src/features/review/ui/main.tsx`, `src/features/review/ui/components/SettingsPanel.tsx`, `src/features/review/ui/components/SettingsPanel.test.tsx`.
- Focused tests: `bun test src/features/review/ui/components/SettingsPanel.test.tsx` — 11 passed, 0 failed, 67 expect() calls.
- Lint: `bun run lint` — passed.
- Build: `bun run build` — passed.
- Full tests: `bun test` — 861 passed, 0 failed.
- UI smoke: browser/viewport inspection unavailable. Behavioral DOM smoke covered open, Close, Escape, backdrop dismissal, focus return, responsive layout markers, native select markup, and settings controls; CLI smoke was not required for this ticket.

## Stage 2 result — 2026-09-17

- Requirements reviewed: complete settings visibility, viewport bounds, narrow/wide responsive layout, modal semantics, native select markup, keyboard reachability, focus return, Escape/backdrop/Close behavior, and preserved settings API behavior.
- Findings: none.
- Rework: none.
- Verification: reused Stage 1 evidence; no source or test changes during review.

## Final status

`done`
