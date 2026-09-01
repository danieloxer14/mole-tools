# Remove unconsumed shared utility exports

## Type
Redundant code

## Scope
- Area: `Shared parsing and utilities`
- Candidate paths: `src/shared/gitlab-position.ts`, `src/shared/diff-parse.ts`, `src/shared/format.ts`
- Symbols/config/docs: `lineCode`, `LineSelection`, `DiffLineKind`, `FileStatus`, `FormatCheck`

## Evidence
- LSP references for `lineCode` (`src/shared/gitlab-position.ts:34-42`) find only its declaration, the internal `rangeEntry` call at `:214-218`, and direct unit-test calls at `src/shared/gitlab-position.test.ts:7,53-60`; no feature, adapter, port, registry, dynamic-import, documentation, or fixture imports it.
- LSP references for `LineSelection` (`src/shared/gitlab-position.ts:5-10`) find only the declaration and internal annotations at `:142,148,211,223`; production/request state uses the canonical Zod-backed `src/features/review/state.ts:22-28` type.
- LSP references for `DiffLineKind` (`src/shared/diff-parse.ts:3`) find only its declaration and `DiffLine.kind` at `:6`; references for `FileStatus` (`:21`) find only its declaration, `ParsedFileDiff.status` at `:26`, and `statusForPaths` at `:72-86`. No direct importer consumes either alias.
- LSP references for `FormatCheck` (`src/shared/format.ts:21`) find only its declaration and `checkFormat`'s return annotation at `:23`; callers consume the discriminated return value from `checkFormat`, not the named type.
- Whole-repository symbol/import search found live consumers for the containing APIs (`buildPosition`, `parseFileDiff`, `parseFileDiffs`, and `checkFormat`) but no consumers of these four aliases or helper as exported names. `GitLabPositionPayload` and `GitLabLineRangeEntry` remain live port contract types.
- `package.json:1-6` marks the application private, `src/index.tsx:16` exports only `applyZodOptions`, and `src/shared/` has no barrel export or package export map.
- Targeted verification: `bun test src/shared` passed 47 tests across 7 files with 0 failures.

## Why this is safe to change
These names are implementation-only types/helpers whose behavior-bearing containing APIs remain live. Removing only their `export` modifiers leaves diff parsing, format validation, GitLab position construction, and all payload values unchanged. The canonical review `LineSelection` schema/type remains in `src/features/review/state.ts`; `DiffLineKind`, `FileStatus`, and `FormatCheck` are still available internally for their containing declarations. An undocumented source deep import is not observable from this private package and remains the only compatibility boundary checked.

## Proposed change
1. Remove `export` from `lineCode` and `LineSelection` in `src/shared/gitlab-position.ts`; retain `lineCode` for `rangeEntry` and retain `LineSelection` for `buildPosition` and internal validation.
2. Remove `export` from `DiffLineKind` and `FileStatus` in `src/shared/diff-parse.ts`; retain both aliases for exported `DiffLine`/`ParsedFileDiff` declarations and parser implementation.
3. Remove `export` from `FormatCheck` in `src/shared/format.ts`; retain it as `checkFormat`'s internal return type.
4. Update the direct `lineCode` unit assertions in `src/shared/gitlab-position.test.ts` to assert generated `line_code` through `buildPosition`, and remove any stale named-type imports if typechecking requires it.
5. Re-run shared position/parser/format tests and GitLab adapter/port-contract tests.

## Acceptance criteria
- [ ] `lineCode`, `LineSelection`, `DiffLineKind`, `FileStatus`, and `FormatCheck` are no longer exported names from their shared modules.
- [ ] `rangeEntry`/`buildPosition`, diff parsing, and format validation preserve current runtime behavior and payload values.
- [ ] All production callers and shared tests use supported containing APIs with no stale imports of the narrowed names.
- [ ] Live `GitLabPositionPayload`, `GitLabLineRangeEntry`, `DiffLine`, `DiffHunk`, `ParsedFileDiff`, and `MrRef` contracts remain available to their current consumers.
- [ ] Targeted shared and GitLab adapter/port-contract verification passes.

## Risks and open questions
- An undocumented external deep import from `src/shared/gitlab-position.ts`, `diff-parse.ts`, or `format.ts` could depend on one of these names; confirm source-path compatibility policy before deletion. No such consumer exists in the repository, and the package is private with no root export for these symbols.

## Assessment

- **Validated:** 2026-08-27 — `valid`
   - Re-checked all 5 names: `lineCode` (gitlab-position.ts:34) → only `rangeEntry` :215 + own test gitlab-position.test.ts:7,53-60; `LineSelection` (gitlab-position.ts:5) → only internal :142,148,211,223 (main.tsx:16,908 import the canonical `state.ts:28` type, not this export); `DiffLineKind` (diff-parse.ts:3) → only `DiffLine.kind` :6; `FileStatus` (diff-parse.ts:21) → only `ParsedFileDiff.status` :26 + `statusForPaths` :76; `FormatCheck` (format.ts:21) → only `checkFormat` return :23. Containing APIs live: `buildPosition` routes.ts:1010/setup.ts:235, `parseFileDiffs` index.ts:118/routes.ts:645/setup.ts:320, `checkFormat` commit/index.ts:75/merge-request/generate.ts:46. `bun test src/shared` = 56 pass/0 fail/9 files (ticket's 47/7 stale — suite grew).
- **Product impact:** `code` — **Priority P3**
   - Dead surface is the `export` modifier on 5 internal helpers/types in a private package (no `exports` map in package.json, no `src/shared` barrel, index.tsx:16 exports only `applyZodOptions`); removing the modifier is behavior-preserving and touches no runtime path — internal cleanup, not product-critical.
- **Verification:**
   - Safe: `grep -rn '\b(lineCode|LineSelection|DiffLineKind|FileStatus|FormatCheck)\b' src` returns only declarations + internal use + the `lineCode` unit test; then drop the 5 `export`s and `bun run build` still compiles and `bun test src/shared` stays green.
   - Supported behavior after removal: `bun test src/shared` (56/0), `bun test src/port-contracts src/adapters` (buildPosition/validatePosition/parseFileDiffs contracts), `bun test src/features/commit src/features/merge-request` (checkFormat callers), `bun run build` typecheck.
- **Removal risk:** Low. No dynamic import/registration of any of the 5 names; no config field, persisted state, network/API shape, release/installer path, or CLI option references them. Sole consumer of a narrowed name is `lineCode`'s own unit test (gitlab-position.test.ts:7,53-60) — migrate its `line_code` assertions through `buildPosition` (proposed step 4). Undocumented deep import into `src/shared/*.ts` is the only uncheckable boundary; not observable from this private package (no `exports` map, no barrel). Note the same-named `LineSelection` in `state.ts:28`: the review UI (`main.tsx`) consumes that one, not the shared export, so no collision.
## Removal process

- [x] Baseline captured from `HEAD` before narrowing: `bun test src/shared` ran 56 / 0, `bun test src/port-contracts src/adapters` ran 171 / 0, and `bun test src/features/commit src/features/merge-request` ran 31 / 0; each exited 1 only because configured aggregate coverage was below 90% (shared 90.83% funcs / 89.50% lines; full baseline 84.91% / 88.27%). `bun run build` and `bun run lint` passed; `bun test` ran 441 / 0 across 59 files and exited 1 on the same existing coverage gate.
- [x] Added temporary `test/dead-code/shared-line-code-export.removal.test.ts`; against baseline it was RED at 0 / 5 because all five export modifiers existed. After narrowing, `bun test test/dead-code/shared-line-code-export.removal.test.ts` was GREEN at 5 / 0.
- [x] Re-ran LSP references: `lineCode` has only its declaration and `rangeEntry`; `LineSelection` only its declaration and internal annotations; `DiffLineKind` only `DiffLine.kind`; `FileStatus` only `ParsedFileDiff.status` and `statusForPaths`; `FormatCheck` only its declaration and `checkFormat` return. Repository scan found no narrowed-name import, dynamic registration, barrel, root export, config, persisted-state, network, release, installer, or CLI consumer. `package.json` remains private with no `exports` map; `src/features/review/state.ts` `LineSelection` is canonical and distinct.
- [x] Removed exactly five export modifiers: `lineCode` and `LineSelection` in `src/shared/gitlab-position.ts`, `DiffLineKind` and `FileStatus` in `src/shared/diff-parse.ts`, and `FormatCheck` in `src/shared/format.ts`. Removed direct `lineCode` unit assertions; existing `buildPosition` tests retain generated `line_code` coverage for new and old sides. No containing API or payload changed.
- [x] Post-removal focused checks: proof test 5 / 0; `bun test src/shared` 55 / 0; `bun test src/port-contracts src/adapters` 171 / 0; `bun test src/features/commit src/features/merge-request` 31 / 0. Focused commands with coverage enabled exited 1 on the configured aggregate threshold; all test assertions passed.
- [x] Post-removal source scan found only internal declarations/usages plus the separate review `state.ts` `LineSelection`; no stale narrowed-name imports or exports. LSP references above confirm retained `GitLabPositionPayload`, `GitLabLineRangeEntry`, `DiffLine`, `DiffHunk`, `ParsedFileDiff`, `MrRef`, `buildPosition`, `parseFileDiffs`, and `checkFormat` paths remain live. GitLab payload tests passed without shape changes.
- [x] Final validation: `bun run build` passed; `bun run lint` passed (145 files); `bun test` ran 445 / 0 across 60 files and exited 1 only because aggregate coverage remained 84.91% funcs / 88.27% lines. CLI smoke `bun run src/index.tsx help` listed five commands; `bun run src/index.tsx help review` printed review usage. No live review UI was launched; supported shared behavior is covered by focused tests.
- [x] Deleted temporary removal-proof test and reran retained `bun test src/shared` (55 / 0), `bun test src/port-contracts src/adapters` (171 / 0), and `bun test src/features/commit src/features/merge-request` (31 / 0); each had zero test failures and exited 1 on coverage threshold. Final compatibility check found no dynamic/config/persisted-state/network/release/installer/CLI consumer; private package/no export-map policy leaves only undocumented deep imports as an explicit residual risk.
