# Consolidate duplicated responsive review-column dimensions

## Type
Redundant code

## Scope
- Area: `Review UI shell and layout`
- Candidate paths: `src/features/review/ui/column-resize.ts`, `src/features/review/ui/main.tsx`, `src/features/review/ui/app.css`
- Symbols/config/docs: `compactColumnWidths`, `regularColumnWidths`, `initialColumnWidth`, `centreColumnMinimumWidth`, `.review-shell`, `.column-splitter-left`, `.column-splitter-right`, `@media (max-width: 1200px)`

## Evidence
- `src/features/review/ui/column-resize.ts:3-12` hard-codes compact left/right widths `260/270`, regular left/right widths `300/320`, and breakpoint `1200` for JavaScript initialization.
- `src/features/review/ui/main.tsx:407-409` separately hard-codes the same `1200` breakpoint and center minimum widths `450/500`; `main.tsx:446-449` consumes the resize module's duplicated left/right values.
- `src/features/review/ui/app.css:40-43,61-65` repeats regular grid defaults `300px`, `500px`, and `320px`; `app.css:1250-1255` repeats compact grid values `260px`, `450px`, and `270px` under the same breakpoint.
- `src/features/review/ui/main.tsx:1414-1417` always injects left/right width custom properties, while CSS independently retains hard-coded fallback and media-query dimensions. A change to one representation can silently leave initial sizing, grid minimums, and splitter placement out of sync.
- Reachability inspection confirmed the page is bundled from `src/features/review/ui/index.html:9-10`, served by `src/features/review/server.ts:6,36-50`, and rendered by `main.tsx:1601-1603`; these values belong to one live shell, not an unused compatibility path.
- Targeted verification: `bun test src/features/review/ui/column-resize.test.ts` passed 3 tests and 8 expectations. No application changes were made.

## Why this is safe to change
The candidate is duplicated layout data, not a removable runtime path. The existing shell and resize handlers remain live through the review server's bundled HTML entry. Consolidating dimensions into one canonical layout contract can preserve the observed `<=1200` compact breakpoint, regular/compact column widths, center minimums, splitter placement, and keyboard/pointer clamping while removing parallel literals. No external CSS consumer was found in repository references; the package is private and `app.css` is imported only by `main.tsx`. Direct browser behavior at breakpoint transitions remains an open verification boundary.

## Proposed change
1. Establish one canonical responsive column-dimension contract for left, center, and right minimum widths plus breakpoint, and derive both initial resize state and shell CSS custom properties/grid constraints from it.
2. Remove repeated hard-coded values and fallback/media-query copies from the other representation without changing compact or regular sizing behavior.
3. Preserve `column-resize.ts` boundary tests and add focused shell/browser coverage for regular and compact viewport widths, splitter keyboard/pointer resizing, and available-center clamping.

## Acceptance criteria
- [ ] One canonical responsive dimension definition supplies initial widths, center minimum, grid constraints, and splitter positioning; no duplicated breakpoint or width literals remain across the three candidate files.
- [ ] Review shell still renders left layers, center changed-file/diff content, and right chat at existing regular and compact widths.
- [ ] Pointer and keyboard splitter resizing preserve minimums, maximums, and center-column available space at both responsive sizes.
- [ ] Existing resize tests and new targeted shell/layout verification pass.

## Risks and open questions
- Browser verification must confirm no flash or invalid grid occurs before React applies custom properties and that crossing the `1200px` viewport breakpoint does not leave stale JavaScript minimums.
- Decide whether canonical values live in TypeScript and are emitted as CSS variables, or in CSS and are read by the resize logic; avoid introducing a second runtime parser or a new untested fallback path.

## Assessment

- **Validated:** 2026-08-27 — `valid`
   - Re-verified all three representations still carry the same literals: `column-resize.ts:3-4` (`compactColumnWidths` 260/270, `regularColumnWidths` 300/320, module-private) + breakpoint `1200` at `column-resize.ts:10`; `main.tsx:410` re-declares `1200` + centre minimums 450/500 in `centreColumnMinimumWidth`, `main.tsx:448-451` consumes `initialColumnWidth`; `app.css:41-43` regular fallbacks 300/500/320, `app.css:61-65` splitter `calc(... -4px)` fallbacks, `app.css:1282-1287` compact `@media (max-width: 1200px)` 260/450/270. Live shell confirmed: `index.html:9-10` → `server.ts:6,46` serves the bundled page; `main.tsx:40` is the sole `app.css` consumer; `.review-shell`/`.column-splitter-*` render at `main.tsx:1475/1499/1590`; UI is in the build graph via `registry.ts:4` → `features/review/index.ts:10` → `server.ts`. `bun test src/features/review/ui/column-resize.test.ts` → 3 pass / 0 fail / 8 expects. Ticket line refs are stale (main.tsx now 1660 lines, app.css 1288) but substance unchanged; only stray numeric hits outside the three files are HTTP `500` status codes in `routes.ts:917/1067/1314/1316`, not dimensions.
- **Product impact:** `code` — **Priority P2**
   - Duplicated responsive layout contract across the user-facing review UI shell (runtime JS in `main.tsx` + CSS in `app.css`), not a live bug: the copies are self-consistent today and the CSS fallbacks only paint the pre-mount first frame, while steady state uses the injected `--left-/--right-column-width` (`main.tsx:1470-1471`). Mirrors the P2 precedent set by `review-duplicate-http-token-transport` (UI-runtime surface, deferrable). Not P1 (the redundancy does not break the product now), not P3 (runtime UI code, not internal/test), not P4 (not docs).
- **Verification:**
   - Safe: `bun test src/features/review/ui/column-resize.test.ts` must still report 3 pass / 0 fail (asserts 260/270 at `1200`, 300/320 at `1201`); `bun test src/features/review/ui/` for shell/resize coverage; `bun run build` to confirm the UI still compiles after consolidation; `grep -rn "app.css" src` must still show a single consumer (`main.tsx:40`).
   - Behavior preserved: launch the review server and confirm the shell at a viewport > 1200px (regular 300/500/320) and ≤ 1200px (compact 260/450/270), that pointer and keyboard splitter resizing keep minimums, maximums (`minimum*3`), and centre-column available space at both sizes, and that no flash / invalid grid appears before React applies the custom properties.
- **Removal risk:** Low. Dynamic loading / external / untracked consumers: none — `app.css` is a static import (`main.tsx:40`), with no CSS-in-JS or dynamic import, and `.review-shell`/`.column-splitter-*` appear only in `app.css` + `main.tsx`. Config / persisted state / network / API shape / release / installer: none — dimensions are in-code literals + CSS with no user config field, API shape, or release artifact. Sole boundary: the CSS fallback values paint the pre-mount first frame, so the canonical contract must still emit those CSS fallbacks (not drop them) to avoid an unstyled / zero-width initial grid before `--left-/--right-column-width` are injected — keep the fallbacks as the emitted copy of the contract. The core hazard this consolidation removes is a future edit to one representation (e.g. `column-resize.ts` widths) silently desyncing the CSS fallbacks and media query.
## Removal process

- [x] Baseline gate (2026-08-30): `bun test src/features/review/ui/column-resize.test.ts` passed 3 tests / 8 expectations; `bun test src/features/review/ui/` passed 12 tests / 35 expectations but exited 1 at 31.72% functions / 53.77% lines coverage; `bun run build` passed; `bun run lint` passed; `bun test` passed 440 tests / 1073 expectations but exited 1 at 84.99% functions / 88.36% lines coverage; `grep` inspection found one `app.css` import in `src/features/review/ui/main.tsx:40`.
- [ ] Add a temporary contract test in `src/features/review/ui/column-resize.test.ts` for the canonical responsive dimensions and boundary behavior: compact at `1200px` (`260/450/270`), regular at `1201px` (`300/500/320`), plus minimum/maximum/available-center clamping; run `bun test src/features/review/ui/column-resize.test.ts` and record RED for the not-yet-migrated canonical contract before changing the layout implementation.
- [ ] Establish one TypeScript-owned responsive contract containing breakpoint `1200`, left/right initial widths (`260/270` compact, `300/320` regular), and center minimums (`450/500`); migrate `initialColumnWidth` and `centreColumnMinimumWidth` in `src/features/review/ui/main.tsx` to consume it, removing their independent breakpoint/width literals.
- [ ] Migrate `src/features/review/ui/app.css` to consume the contract's emitted custom properties for `.review-shell`, `.column-splitter-left`, and `.column-splitter-right`; remove repeated regular and `@media (max-width: 1200px)` compact literals, while retaining valid pre-mount fallbacks generated from the same contract so the first frame never has zero/invalid grid columns.
- [ ] Keep splitter behavior unchanged: pointer and keyboard resize handlers must continue clamping each side to its minimum and `minimum * 3`, and must preserve available center width; do not change shell column ordering, changed-file/diff rendering, layer rendering, or chat rendering.
- [ ] Run `bun test src/features/review/ui/column-resize.test.ts` again and record GREEN for the migrated contract; remove or fold the temporary assertion into durable boundary coverage only after it proves both viewport branches.
- [ ] Retain focused UI coverage with `bun test src/features/review/ui/` and verify the app stylesheet still has one import; cover regular and compact viewports, crossing the breakpoint, pointer/keyboard splitter movement, min/max clamping, center-space clamping, and pre-mount fallback validity.
- [ ] Smoke-test the actual review surface with `bun run src/index.tsx review <reachable-mr-url> --no-open`: open the printed local URL at widths above and at/below `1200px`, confirm all three panes render, resize both splitters by pointer and keyboard, and inspect initial paint for no flash or invalid grid.
- [ ] Final validation: run `bun test src/features/review/ui/column-resize.test.ts src/features/review/ui/` and `bun run build`; inspect `src/features/review/ui/column-resize.ts`, `main.tsx`, and `app.css` to confirm one canonical dimension source and no stale duplicate breakpoint/width literals.
- [ ] Risk caveat: `app.css` is statically imported only by `main.tsx`, but its fallback values cover the pre-mount frame; never delete fallbacks without replacing them with contract-derived values. Keep the `1200px` inclusive compact boundary, current `calc(... -4px)` splitter placement, and existing CSS custom-property names to avoid stale JavaScript minimums or a zero-width initial grid.
- [x] Iteration outcome (2026-08-30): stopped before removal because required baseline is not green; focused UI and full suites have 0 test failures but fail enforced 90% coverage thresholds. Missing evidence is a green baseline after the repository-wide coverage gate is resolved; no source or test removal performed.
