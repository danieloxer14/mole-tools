# Remove unused approval helper exports

## Type
Redundant code

## Scope
- Area: `Review UI components`
- Candidate paths: `src/features/review/ui/components/ApprovalControls.tsx`
- Symbols/config/docs: `actionLabel`, `stateLabel` re-export at module end

## Evidence
- `src/features/review/ui/components/ApprovalControls.tsx:14-29` defines `stateLabel` and `actionLabel`; the component itself consumes them at lines 46 and 106.
- `src/features/review/ui/components/ApprovalControls.tsx:113` exports both helpers, but whole-repository search found no import or reference to either exported name outside their defining module.
- LSP references for `actionLabel` and `stateLabel` show only their definitions, internal calls, and the export statement; no test imports either helper.
- `src/features/review/ui/components/ApprovalControls.test.tsx:4,25-33` imports and renders only `ApprovalControls`.
- `package.json:1-5` marks `mole-tools` private and sets `src/index.tsx` as its module entry; `src/index.tsx:16` exports only `applyZodOptions`. No review UI component is re-exported through the package entry.
- Targeted verification: `bun test src/features/review/ui/components/ApprovalControls.test.tsx src/features/review/ui/components/ChatPane.test.tsx src/features/review/ui/components/CommentDraft.test.tsx src/features/review/ui/components/DiffView.test.tsx src/features/review/ui/components/LayerPane.test.ts` passed 9 tests with 0 failures.

## Why this is safe to change
`actionLabel` and `stateLabel` remain needed as private implementation helpers, but their named exports have no repository consumer and are outside the private package root export surface. Removing only the export statement preserves `ApprovalControls` rendering and all approval state/action behavior. The remaining compatibility boundary is undocumented external deep imports into source files; no such consumer is observable in this repository.

## Proposed change
1. Remove `export { actionLabel, stateLabel };` from `src/features/review/ui/components/ApprovalControls.tsx`.
2. Keep both helpers private and retain the `ApprovalControls` export, its props, `ApprovalAction` type, and all internal callers.
3. Re-run targeted UI component tests.

## Acceptance criteria
- [x] `actionLabel` and `stateLabel` are no longer exported from `ApprovalControls.tsx`.
- [x] `ApprovalControls` continues rendering approval status and action labels through its private helpers.
- [x] No callers, tests, or package exports reference removed helper exports.
- [x] Targeted UI component verification passes.

## Risks and open questions
- An undocumented external deep import could depend on these helper names; package-private status and whole-repository references establish the supported boundary, but external source imports are not observable here.

## Assessment

- **Validated:** 2026-08-27 — `valid`
   - LSP refs + repo grep confirm each helper has exactly 3 references, all in `ApprovalControls.tsx`: `stateLabel` (def :14, internal use :46, export :113) and `actionLabel` (def :23, internal use :106, export :113); no external consumer. Test file imports only `ApprovalControls` (:4); `src/index.tsx:16` re-exports only `applyZodOptions`; all component importers (`main.tsx:23`, `LayerPane.tsx:3`, test) import the component / `ApprovalAction` type, never the helpers.
- **Product impact:** `code` — **Priority P3**
   - Dead part is the unused `export { actionLabel, stateLabel }` (:113) on a review UI component module; helpers stay private and live (render status :46, action buttons :106). No consumer + private package + no export map/barrel → internal helper export with no direct product surface, not user-facing behavior.
- **Verification:**
   - Safe: `rg -w "actionLabel|stateLabel" src` (or LSP references on :14 / :23) yields only the def + internal-use + export lines; deleting line 113 leaves def + internal callers intact; `bun run build` / typecheck shows no dangling import.
   - Supported behavior: `bun test src/features/review/ui/components/ApprovalControls.test.tsx src/features/review/ui/components/ChatPane.test.tsx src/features/review/ui/components/CommentDraft.test.tsx src/features/review/ui/components/DiffView.test.tsx src/features/review/ui/components/LayerPane.test.ts` → 9 pass, 0 fail; helpers still drive `ApprovalControls` rendering (status :46, buttons :106).
- **Removal risk:** None found after checking dynamic loading (static ES import), external/untracked consumers (private pkg, root `index.tsx:16` exports only `applyZodOptions`, no export map/barrel), CLI/config/persisted-state/network/API/release & installer paths (none touched). Residual: an undocumented out-of-tree deep import into the source file is not observable in-repo (same boundary the ticket already notes).
- **Needs investigation:** 2026-08-30 — baseline remains not green under current Bun coverage enforcement. The five-file focused command ran 9 tests with 0 failures but exited 1 at 24.13% functions / 48.64% lines; `bun run build` and `bun run lint` passed; full `bun test` ran 436 tests with 0 failures but exited 1 at 85.12% functions / 88.92% lines against the 90% thresholds. Missing evidence: a green baseline under the enforced gate (or an explicit decision to resolve the pre-existing coverage deficit before this removal). No source or test removal started.
- **Resolution:** 2026-08-30 — coverage gate is pre-existing and unrelated; focused and full suites had zero assertion failures, while build and lint passed. Proceeded with removal and recorded every coverage-gate exit in `## Removal process`; no new removal risk was found.
## Removal process

- [x] Capture baseline before editing: run the five affected component suites (`bun test src/features/review/ui/components/ApprovalControls.test.tsx src/features/review/ui/components/ChatPane.test.tsx src/features/review/ui/components/CommentDraft.test.tsx src/features/review/ui/components/DiffView.test.tsx src/features/review/ui/components/LayerPane.test.ts`), then `bun run build`, `bun run lint`, and `bun test`; record existing UI test counts. Observed 2026-08-30: focused 9 pass / 0 fail, exit 1 from 24.13% functions / 48.64% lines; build passed; lint passed; full 436 pass / 0 fail, exit 1 from 85.12% functions / 88.95% lines below enforced 90% thresholds. Test assertions are green; only pre-existing coverage gate exits non-zero.
- [x] Add temporary `test/dead-code/review-ui-unused-helper-exports.removal.test.ts` that reads `src/features/review/ui/components/ApprovalControls.tsx` and asserts its module has no named export of `actionLabel` or `stateLabel`; run `bun test test/dead-code/review-ui-unused-helper-exports.removal.test.ts` and observe RED while `export { actionLabel, stateLabel };` remains (0 pass / 1 fail, as expected).
- [x] Re-ran LSP references and repository search before editing. Before removal, each helper had only its definition, internal call, and export; `ApprovalControls`, `ApprovalAction`, component imports, and private root export remained supported. After removal and language-server refresh, LSP found only definition plus internal call for each helper; source scan found no helper export/import, and `src/index.tsx` still exports only `applyZodOptions`.
- [x] Removed only `export { actionLabel, stateLabel };` from `src/features/review/ui/components/ApprovalControls.tsx`; both helpers remain private, with status/action call sites at `:46` and `:106`, `ApprovalControls`, its props, and `ApprovalAction` unchanged. No caller or package-export migration was needed.
- [x] Ran `bun test test/dead-code/review-ui-unused-helper-exports.removal.test.ts` (1 pass / 0 fail) and the retained five-component command (9 pass / 0 fail; exit 1 only from the existing coverage threshold); approval status and action-label behavior remained green.
- [x] Re-checked helper names in `src` and `test`, LSP references, imports, dynamic-loading paths, and export paths. Only private definitions/internal calls remain; no stale helper import or named export exists, and no unrelated component export was narrowed.
- [x] Final validation: `bun run build` passed; `bun run lint` passed; `bun test` ran 437 tests with 0 failures and exited 1 only at the existing 85.12% functions / 88.92% lines coverage gate; `bun run src/index.tsx help review` printed supported review usage. UI was not visually launched; retained component tests exercised approval rendering and action labels.
- [x] Deleted temporary `test/dead-code/review-ui-unused-helper-exports.removal.test.ts` and reran the retained five-component command (9 pass / 0 fail; exit 1 only from existing coverage threshold). Final compatibility check found static ES imports, private package/no export map, and no CLI/config/persisted-state/network/release impact; residual risk remains undocumented out-of-tree deep imports, not observable in this private package.
