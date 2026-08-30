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
- [ ] `actionLabel` and `stateLabel` are no longer exported from `ApprovalControls.tsx`.
- [ ] `ApprovalControls` continues rendering approval status and action labels through its private helpers.
- [ ] No callers, tests, or package exports reference removed helper exports.
- [ ] Targeted UI component verification passes.

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
## Removal process

- [x] Capture baseline before editing: run the five affected component suites (`bun test src/features/review/ui/components/ApprovalControls.test.tsx src/features/review/ui/components/ChatPane.test.tsx src/features/review/ui/components/CommentDraft.test.tsx src/features/review/ui/components/DiffView.test.tsx src/features/review/ui/components/LayerPane.test.ts`), then `bun run build`, `bun run lint`, and `bun test`; record existing UI test counts. Observed 2026-08-30: focused 9 pass / 0 fail, exit 1 from 24.13% functions / 48.64% lines; build passed; lint passed; full 436 pass / 0 fail, exit 1 from 85.12% functions / 88.92% lines below enforced 90% thresholds. Removal blocked; no source edit.
- [ ] Add temporary `test/dead-code/review-ui-unused-helper-exports.removal.test.ts` that reads `src/features/review/ui/components/ApprovalControls.tsx` and asserts its module has no named export of `actionLabel` or `stateLabel`; run `bun test test/dead-code/review-ui-unused-helper-exports.removal.test.ts` and observe RED while `export { actionLabel, stateLabel };` remains.
- [ ] Re-run LSP references and repository search before editing; verify `actionLabel` and `stateLabel` have only their definitions/internal calls/export, while `ApprovalControls`, `ApprovalAction`, and all component imports remain supported. Confirm private package root `src/index.tsx` still exports only `applyZodOptions`.
- [ ] Remove only `export { actionLabel, stateLabel };` from `src/features/review/ui/components/ApprovalControls.tsx`; keep both helpers private, their status/action call sites (`:46` and `:106`), `ApprovalControls`, its props, and `ApprovalAction` type. No caller or package-export migration is expected.
- [ ] Run `bun test test/dead-code/review-ui-unused-helper-exports.removal.test.ts` and the retained five-component command; both must be GREEN, proving approval status rendering and action labels still use the private helpers.
- [ ] Re-check `grep -rn "\bactionLabel\b\|\bstateLabel\b" src test`, LSP references, dynamic imports, and export barrels; confirm no stale helper import or named export exists and no unrelated component export was narrowed.
- [ ] Run final validation `bun run build`, `bun run lint`, and `bun test`; smoke the supported review entry with `bun run src/index.tsx help review`, and report UI behavior from component tests rather than claiming visual verification unless a review UI is actually launched.
- [ ] Delete the temporary removal-proof test, rerun the retained component suites, and record the execution result. Before committing, reconfirm static ES-import usage, private/no-export compatibility, and no CLI/config/persisted-state/network/release impact; if an undocumented deep import is discovered, update `## Assessment` and stop.
