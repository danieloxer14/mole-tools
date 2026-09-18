# T02 — Review-layer labels, spacing, text colour, alignment, and progress

- status: done
- issues: #2, #3, #4, #5, #6, #7, #10, #12
- priority: high
- dependencies: none

## Issue

Review-layer file labels lack hover feedback and a clear selected state. Layer descriptions use an inconsistent default colour. Coverage/progress fills are inaccurate. The layer pane has insufficient top padding, titles switch between orange and white, and the review-layer icon does not align with the completed-layer counter.

## Image evidence

- Image #3 (1065×200): layer action/refresh controls and adjacent status content.
- Image #9 (200×267): review-layer icon and completed count are vertically misaligned.
- Image #11 (564×268): review-layer cards show inconsistent title/description emphasis.
- Image #14 (971×200): completed layer card and progress presentation.
- Image #15 (588×200): completed-layer counter and header spacing.
- Image #16 (797×200): file labels/chips without clear hover or selected treatment.

## Proposed fix

Update `src/features/review/ui/components/LayerPane.tsx`, `ProgressBar.tsx`, and the owning UI styles:

1. Give file-label buttons a visible hover state and a selected state keyed to the active file. Selected labels must use a filled orange treatment, not only orange text.
2. Use white as default layer-title and description text. Reserve orange for selected/action emphasis only.
3. Calculate progress from the same numerator/denominator used by the displayed count. Clamp invalid or empty values so fills cannot exceed 100% or disappear for valid completed work. Keep accessible progress attributes and inline percentage width.
4. Add consistent pane/header top padding and align the layers icon, status text, progress bar, and completed counter on one baseline/grid.
5. Preserve collapse/expand, done/stale states, file selection, regenerate/retry, and viewed-file behavior.

## Acceptance

- Every file label has a visible hover state.
- Active file label has a filled orange selected state; inactive labels do not appear selected.
- Layer titles and descriptions are white by default across open, done, and stale cards.
- Displayed progress count and fill percentage agree for 0%, partial, and 100% cases.
- Review-layer pane has intentional top padding; icon and completed count align at normal and narrow widths.
- Existing layer semantics (`aria-expanded`, done checkbox, stale state, file selection) remain unchanged.

## Tests and verification

- Extend `src/features/review/ui/components/LayerPane.test.tsx` for hover/selected file-label state, title/description output, 0/partial/full progress, and header alignment structure.
- Keep `src/features/review/ui/components/ProgressBar.test.tsx` green, including ARIA values and inline width.
- Launch the review UI with layers in open, running, done, and stale states; select files and inspect hover/selected styling at desktop and narrow widths.
- Task 1 must finish with all gates green: `bun run lint && bun run build && bun test`.

## Focused verification command

```sh
bun test src/features/review/ui/components/LayerPane.test.tsx src/features/review/ui/components/ProgressBar.test.tsx
```

## Stage 1 result

- Implemented issues #2, #3, #4, #5, #6, #7, #10, and #12.
- Changed files: `src/features/review/ui/components/LayerPane.tsx`, `src/features/review/ui/components/ProgressBar.tsx`, `src/features/review/ui/components/LayerPane.test.tsx`, `src/features/review/ui/components/ProgressBar.test.tsx`.
- File labels now expose hover treatment and filled orange active treatment; active labels retain accessible full-path names and `aria-current`.
- Layer titles and descriptions use white foreground text by default; selected layer titles retain orange emphasis.
- Progress values normalize invalid ranges and clamp fills/ARIA values; displayed layer counts and progress values agree for zero, partial, and full coverage.
- Layer header uses intentional top padding and a four-column aligned grid for icon, status, progress, and completed count.
- Focused tests: `bun test src/features/review/ui/components/LayerPane.test.tsx src/features/review/ui/components/ProgressBar.test.tsx` — 25 passed, 0 failed.
- Build: `bun run build` — passed.
- Full tests: `bun test` — 837 passed, 0 failed.
- Lint: `bun run lint` — passed after formatting the changed files; initial run reported formatting-only findings.
- UI smoke: no browser/viewport runtime available. Static-render smoke in focused tests covered open, running, done, stale, selected-file, zero-coverage, partial-coverage, and full-coverage markup; 25 tests passed.

## Stage 2 result

- Requirements reviewed against all acceptance criteria, keyboard/accessibility semantics, `Badge`, `Button`, `Checkbox`, `Collapsible`, and review state behavior.
- Findings: none requiring reviewer rework. `aria-expanded`, done checkbox, stale/done state, file selection, collapse behavior, and action callbacks remain unchanged.
- Review verification: reused Stage 1 evidence because reviewer made no source or test edits.
- Post-review test completion: added explicit zero/full LayerPane coverage assertions required by the ticket test matrix; reran focused tests and all canonical gates. All passed.

## Final status

- done — 2026-09-17
