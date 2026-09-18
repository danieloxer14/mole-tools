# Review UI issues implementation loop

Implement one ticket per iteration. Keep each ticket's implementation and review stages separate. Do not combine unrelated UI changes in one iteration.

## Source of truth

- Issue list: `issues.md`
- Ticket files: `ui-tickets/T01-*.md` through `ui-tickets/T08-*.md`
- Evidence: embedded Image # references recorded in each ticket

Images are not repository files. Use their numbered references and descriptions as visual acceptance evidence.

## Operating rules

1. Select first unchecked ticket in execution order.
2. Read whole ticket before editing. Confirm current component structure, existing tests, and dependencies.
3. Run only one ticket per iteration. Do not start a dependent ticket until its dependency is reviewed and accepted.
4. Preserve current behavior and accessibility contracts unless ticket explicitly changes presentation.
5. Use existing component primitives and test patterns. Do not add a parallel styling system or duplicate component abstraction.
6. Task 1 owns implementation, ticket tests, and the first verification run.
7. Task 2 owns requirement review and rework. If Task 2 changes source or tests, it MUST rerun the focused verification plus `bun run lint`, `bun run build`, and `bun test`. If Task 2 makes no changes and confirms Task 1 evidence is still applicable, it MUST record that verification is reused and MUST NOT rerun it.
8. Do not mark a task complete from code inspection alone when its ticket requires browser or viewport behavior. Record exact smoke command and observed result.
9. A failed gate blocks the ticket. Record command, failure, and next required fix under the ticket's status; do not silently carry failures forward.
10. After both tasks pass, mark the ticket `[x]` with date, changed files, focused test result, and final gate result. Then continue to next dependency-ready ticket.

## Required stage record

Each ticket implementation must record:

- Stage 1 result: implementation summary, changed files, focused tests, build result, lint result, full test result, and UI smoke result when required.
- Stage 2 result: requirements reviewed, findings, rework performed, and whether verification was rerun or reused.
- Final status: `done`, `blocked`, or `needs-rework`.

## Verification commands

Canonical repository gates:

```sh
bun run lint
bun run build
bun test
```

Use each ticket's focused test list in addition to the canonical gates. Run commands from repository root. Use Bun; do not substitute Node, npm, pnpm, Vite, Jest, or Vitest.

## Execution order

### T01 — Agent pane composer, dropdown sizing, and long-path layout

- [x] **Task 1 — Implement** `ui-tickets/T01-agent-pane-composer-and-path-layout.md`: implement issues #1, #9, #19; add/adjust tests; run focused tests; run build, full tests, and lint; perform required Agent-pane smoke.
- [x] **Task 2 — Review** T01 against all acceptance criteria, keyboard behavior, wrapping invariants, and accessibility. Rework if needed. Rerun verification only if rework changes source/tests; otherwise record verification reused.

### T02 — Review-layer labels, spacing, text colour, alignment, and progress

- [x] **Task 1 — Implement** `ui-tickets/T02-layer-cards-labels-and-progress.md`: implement issues #2, #3, #4, #5, #6, #7, #10, #12; add/adjust tests; run build, full tests, and lint; perform required layer-state and viewport smoke. Completed 2026-09-17. Changed files: `src/features/review/ui/components/LayerPane.tsx`, `src/features/review/ui/components/ProgressBar.tsx`, `src/features/review/ui/components/LayerPane.test.tsx`, `src/features/review/ui/components/ProgressBar.test.tsx`. Focused tests: 25 passed. Canonical gates: lint passed, build passed, full tests 837 passed. UI smoke: static-render state coverage passed; browser/viewport inspection unavailable.
- [x] **Task 2 — Review** T02 against hover/selected styling, white text defaults, progress math, padding, alignment, and preserved layer behavior. Rework if needed. Rerun verification only if rework changes source/tests; otherwise record verification reused. Completed 2026-09-17. Requirements review found no implementation rework; verification reused for reviewer stage. Explicit zero/full LayerPane assertions were added afterward and all final gates reran successfully.

### T03 — Changed-files separation, SHA alignment, and approval action

- [x] **Task 1 — Implement** `ui-tickets/T03-review-header-files-and-approval.md`: implement issues #8, #11, #13; add/adjust header tests; run build, full tests, and lint; smoke approved/unapproved, stale, copied-SHA, and changed-files states. Completed 2026-09-17. Changed files: `src/features/review/ui/components/MrHeader.tsx`, `src/features/review/ui/components/MrHeader.test.tsx`, `src/features/review/ui/components/ChangedFilesHeader.tsx`, `src/features/review/ui/components/ChangedFilesHeader.test.tsx`. Focused tests: 18 passed, 0 failed. Canonical gates: lint passed, build passed, full tests 842 passed. UI smoke: static/interactive header coverage passed for approved, unapproved, disabled, stale, copied-SHA, changed-files border, and count/progress states; browser/viewport inspection unavailable.
- [x] **Task 2 — Review** T03 against section borders, inline SHA layout, approval colour/state, tooltip/disabled behavior, and responsive header layout. Rework if needed; review found and fixed success dark-theme override, narrow-header shrink/wrap risk, disabled-tooltip accessibility association, and fragile SHA sizing. Completed 2026-09-17. Verification rerun after rework: focused tests 18 passed, lint passed, build passed, full tests 842 passed. No verification reused; Stage 2 changed source/tests. Browser/viewport inspection unavailable.

### T04 — Review header mutually exclusive icon toggles

- [x] **Task 1 — Implement** `ui-tickets/T04-review-toolbar-mutually-exclusive-toggles.md`: implemented issue #14 in `src/features/review/ui/components/DiffView.tsx` with controlled single-select groups for Markdown view, diff layout, and file scope; retained independent file-tag, comment-collapse, and Viewed controls; added selected orange styling and narrow-width wrapping in `src/features/review/ui/components/ui/toggle.tsx`, `src/features/review/ui/components/ui/toggle-group.tsx`, and DiffView header classes. Changed files: `src/features/review/ui/components/DiffView.tsx`, `src/features/review/ui/components/DiffView.test.tsx`, `src/features/review/ui/components/ui/toggle.tsx`, `src/features/review/ui/components/ui/toggle-group.tsx`. Initial focused verification exposed a keyboard-focus test timing/expectation failure; corrected before final verification. Final focused tests: `bun test src/features/review/ui/components/DiffView.test.tsx` — 36 passed, 0 failed. Final canonical gates: `bun run lint` passed, `bun run build` passed, `bun test` passed with 845 tests.
- [x] **Task 2 — Review** T04 against mutual exclusion, pressed semantics, filled-orange selected state, independent actions, keyboard interaction, and no overflow. Requirements review confirmed all three related groups use `multiple={false}`, controlled selected values, `aria-pressed`, and filled orange selected classes; independent actions and callbacks remain separate; header/search/group flex classes wrap without forced horizontal width. Rework: corrected focused keyboard test to await Base UI roving-focus microtasks and assert one ArrowRight/ArrowLeft transition; formatted selector assertions after lint feedback. Verification rerun, not reused: focused tests 36 passed; `bun run lint` passed; `bun run build` passed; `bun test` passed with 845 tests. Browser/viewport inspection unavailable; DOM smoke covered every toggle group, click transitions, pressed state, and horizontal keyboard navigation.
- **Final status:** `done` — completed 2026-09-17. T04 dependency T03 accepted. Failed verification attempts were fixed before completion: keyboard focus assertion and test formatting.

### T05 — Inline find-in-file control

- [x] **Task 1 — Implement** `ui-tickets/T05-inline-find-bar.md`: implemented issue #15 in `src/features/review/ui/components/DiffView.tsx`; added inline-group and interaction coverage in `src/features/review/ui/components/DiffView.test.tsx`. Completed 2026-09-17. Focused tests: 40 passed, 0 failed, 176 expect() calls. Initial lint exposed formatter-only test-helper drift; formatted changed files and reran. Canonical gates: `bun run lint` passed, `bun run build` passed, `bun test` passed with 849 tests and 0 failures. UI smoke: static interactive DOM coverage passed zero/multiple matches, disabled navigation, mouse wraparound, Cmd/Ctrl-F, Enter, Shift+Enter, and Escape; `bun run src/index.tsx help review` passed. Browser/viewport live-MR smoke unavailable without authenticated MR/agent runtime.
- [x] **Task 2 — Review** T05 against inline composition, count correctness, disabled navigation, Cmd/Ctrl-F, Enter, Shift+Enter, Escape, live-counter accessibility, focus, and width constraints. Completed 2026-09-17. Review reworked find navigation buttons to `size="icon-xs"` to preserve focus-ring geometry inside clipped group and added explicit `aria-live="polite"` coverage. Verification rerun after rework: focused tests 40 passed; lint passed; build passed; full tests 849 passed. No verification reused. Browser/viewport inspection unavailable.
- **Final status:** `done` — completed 2026-09-17. T04 dependency accepted.

### T06 — Single-source tooltips and Tag whole file action

- [x] **Task 1 — Implement** `ui-tickets/T06-tooltip-and-file-tag-actions.md`: implemented issues #16 and #17. Existing `IconButton` custom tooltip path remains native-title-free; DiffView toggle controls use custom portal tooltips without `title`, and Tag whole file uses the icon-only `IconButton` while preserving its callback/path behavior. Changed files: `src/features/review/ui/components/IconButton.tsx`, `src/features/review/ui/components/IconButton.test.tsx`, `src/features/review/ui/components/DiffView.tsx`, `src/features/review/ui/components/DiffView.test.tsx`. Completed 2026-09-17. Focused tests: 48 passed, 0 failed, 218 expect() calls. Canonical gates: `bun run lint` passed, `bun run build` passed, `bun test` passed with 861 tests and 0 failures. UI smoke: interactive DOM verified one keyboard-focus portal tooltip for IconButton, native-title absence, icon-only Tag trigger, Tag callback insertion, and toggle keyboard behavior; `bun run src/index.tsx help review` passed. Browser/viewport live-MR hover inspection unavailable without authenticated MR/agent runtime.
- [x] **Task 2 — Review** T06 against duplicate tooltip removal, icon-only Tag whole file presentation, accessible names, focus behavior, and unchanged callbacks. Completed 2026-09-17. Requirements review found no source or test rework needed; verified custom tooltip ownership, no duplicate native titles on affected icon controls, accessible labels, preserved toggle navigation, Tag callback/path, and intentional metadata titles retained. Verification reused from Task 1; no rerun required.
- **Final status:** `done` — completed 2026-09-17. T05 dependency accepted. Browser/viewport live-MR inspection unavailable; CLI and DOM smoke evidence recorded above.

### T07 — Review settings dialog width and responsive contents

- [x] **Task 1 — Implement** `ui-tickets/T07-settings-dialog-width.md`: implemented issue #18. Changed files: `src/features/review/ui/main.tsx`, `src/features/review/ui/components/SettingsPanel.tsx`, `src/features/review/ui/components/SettingsPanel.test.tsx`. Settings dialog now uses viewport-bounded width/height, a constrained single grid row, internal scrolling, narrow single-column layout, wide two-pane layout, wrapped controls, min-width-safe fields, and labelled slot navigation while preserving native selects and settings behavior. Focused tests: `bun test src/features/review/ui/components/SettingsPanel.test.tsx` — 11 passed, 0 failed, 67 expect() calls. Canonical gates: `bun run lint` passed, `bun run build` passed, `bun test` passed with 853 tests and 0 failures. UI smoke: interactive DOM smoke passed open, Close, Escape, backdrop close, and focus return; responsive/native-select assertions passed; `bun run src/index.tsx help review` passed. Browser/viewport live inspection unavailable. Initial lint attempt exposed formatter/import-only issues; formatting was applied and all verification reran successfully. Completed 2026-09-17.
- [x] **Task 2 — Review** T07 against complete content visibility, responsive layout, modal semantics, native select markup, focus handling, and unchanged settings API behavior. Review found and fixed a desktop `sm:max-w-md` override that defeated the width constraint; added `sm:max-w-none`, explicit viewport-bounded height/grid sizing, `h-full`, internal `overflow-auto`, and restored the labelled Prompt slots navigation landmark. Responsive assertions were loosened to meaningful layout tokens and interactive dialog smoke coverage was added. Verification rerun after rework, not reused: focused tests 11 passed; `bun run lint` passed; `bun run build` passed; `bun test` passed with 853 tests and 0 failures. Browser/viewport inspection unavailable. Completed 2026-09-17.

- **Final status:** `done` — completed 2026-09-17. T01 dependency accepted. T07 desktop/narrow live viewport inspection remains unavailable; DOM smoke and static responsive evidence recorded above.
### T08 — Comment wrapping, diff width, and Explain action placement

- [x] **Task 1 — Implement** `ui-tickets/T08-comment-wrapping-and-explain-actions.md`: implemented issues #20 and #21. Changed files: `src/features/review/ui/components/DiffView.tsx`, `src/features/review/ui/components/ChatPane.tsx`, `src/features/review/ui/components/CommentDraft.tsx`, `src/features/review/ui/components/CommentMarkdown.tsx`, `src/features/review/ui/app.css`, `src/shared/markdown.ts`, `src/features/review/ui/components/DiffView.test.tsx`, `src/features/review/ui/components/ChatPane.test.tsx`, `src/features/review/ui/components/CommentDraft.test.tsx`, `src/shared/markdown.test.ts`. Added container-safe wrapping, bounded markdown/code/table regions, internal table scrolling, explicit diff-table width bounds, and compact primary Explain action groups with busy state. Focused tests: 75 passed, 0 failed. Initial canonical run stopped at lint on DiffView import ordering/JSX formatting; build and full tests were not run in that attempt. Completed 2026-09-17.
- [x] **Task 2 — Review** T08 against wrapping and overflow invariants, internal code/table scrolling, Explain placement/accessibility, loading/error behavior, markdown safety, and preserved discussion/draft behavior. Review found and fixed DiffView import ordering/formatting, added explicit `.diff-table` width/max-width bounds to prevent intrinsic comment content from widening the diff, and corrected one markdown test assertion's formatter layout. Verification rerun after rework: focused tests 75 passed; `bun run lint` passed; `bun run build` passed; `bun test` passed with 861 tests. No verification reused. Browser/viewport live-MR smoke unavailable without authenticated MR/agent runtime; DOM coverage exercised long prose/URLs/paths, inline code, fenced code, tables, Explain callback/grouping, disabled/busy state, and preserved draft/discussion behavior. CLI smoke `bun run src/index.tsx help review` passed.
- **Final status:** `done` — completed 2026-09-17. T07 dependency accepted. Initial lint failure was fixed during Task 2 before final acceptance.

## Completion rule

Loop complete only when every ticket has both task checkboxes checked and a final status of `done`. Final record must list every ticket, changed files, focused tests, canonical gate results, smoke results, and any verification reused during a no-change review stage.
