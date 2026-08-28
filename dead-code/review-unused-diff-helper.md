# Remove orphaned large-diff helper

## Type
Redundant code

## Scope
- Area: `Review HTTP server and routes`
- Candidate paths: `src/features/review/routes.ts`, `src/features/review/ui/components/DiffView.tsx`
- Symbols/config/docs: `countLines`, `isLargeDiff`, large-file collapse calculation

## Evidence
- `src/features/review/routes.ts:207-213` defines `countLines` and exports `isLargeDiff`, but whole-repository search found no caller, import, or documentation reference to `isLargeDiff` beyond its declaration.
- `createReviewRoutes` never invokes `isLargeDiff`; it only returns `largeFileLineThreshold` in the `/api/state` payload at `src/features/review/routes.ts:1077-1084`.
- The only live collapse decision independently sums `file.hunks[].lines.length` and compares with the threshold in `src/features/review/ui/components/DiffView.tsx:875-882`; this matches `countLines` plus the strict `>` comparison exactly.
- `package.json:1-5` marks the package private with `src/index.tsx` as its module entry, while `src/index.tsx:16` exports only `applyZodOptions`; no supported package export exposes the helper.
- Targeted verification: `bun test src/features/review/routes.test.ts src/features/review/server.test.ts` passed 34 tests, including route and streaming behavior; no test references `isLargeDiff`.

## Why this is safe to change
`isLargeDiff` has no in-repository consumer and does not participate in route execution. The UI retains equivalent inline threshold behavior, and the API continues returning the configured threshold. Only undocumented source-path imports remain an external compatibility risk.

## Proposed change
1. Remove `isLargeDiff` and its private `countLines` helper from `src/features/review/routes.ts`.
2. Retain `largeFileLineThreshold` in `/api/state` and the existing UI collapse calculation; remove or update only tests/docs if they are found to reference the deleted symbol.
3. Re-run targeted route/server and review UI verification to prove threshold behavior and HTTP contracts remain intact.

## Acceptance criteria
- [ ] No declaration or export remains for `isLargeDiff` or `countLines`.
- [ ] Large-file collapse still occurs when hunk line count is greater than `largeFileLineThreshold`.
- [ ] `/api/state` still returns configured `largeFileLineThreshold` and all route behavior remains supported.
- [ ] Targeted HTTP and UI verification passes.

## Risks and open questions
- Undocumented external deep imports of `src/features/review/routes.ts` could depend on the exported helper; confirm source-path compatibility policy before deletion. No such consumer exists in the repository.

## Assessment

- **Validated:** 2026-08-27 — `valid`
  - Re-ran the recorded evidence independently: repo-wide `grep -rn "isLargeDiff\|countLines"` matches the declarations (`countLines` private at `src/features/review/routes.ts:210-212`; `isLargeDiff` exported at `:214-216`) plus intentional historical workflow mentions in this ticket, `dead-code-assess-loop.md:72`, and `dead-code-removal-loop.md:92`; no caller, import, or operational documentation reference exists. Coverage run lists `routes.ts:210,214` among uncovered lines, confirming the helper is never exercised. Ticket evidence line numbers are stale by a few lines (207-213→210-216; 1077-1084→1095; 875-882→1110-1111) but every symbol and claim still holds.
- **Product impact:** `code` — **Priority P3**
  - Orphaned helper living in a runtime feature module (`routes.ts`) but with zero product surface: not on any supported path, not registered, not in the root export (only `applyZodOptions` at `src/index.tsx:16`). Equivalent collapse math lives independently at `DiffView.tsx:1110-1111` (`file.hunks.reduce((t,h)=>t+h.lines.length,0) > largeFileLineThreshold`), matching `countLines` + strict `>`. Maps to P3 (internal helper, no product surface) — same class as `review-agent-generic-parser` and `review-unused-compatibility-wrappers`.
- **Verification:**
  - Removal safe: `grep -rn "isLargeDiff" src` → only `routes.ts:214` (no consumer); `grep -rn "countLines" src` → only `routes.ts:210-215` (used solely inside `isLargeDiff`); because nothing imports either symbol, deleting both cannot break the build (`bun build src/index.tsx --compile` or `bunx tsc --noEmit` will not reference them). `bun test src/features/review/routes.test.ts src/features/review/server.test.ts` → 34 pass / 0 fail (re-run 2026-08-27).
  - Supported behavior intact: `bun test src/features/review/routes.test.ts` "uses review.largeFileLineThreshold when no route override is provided" (`routes.test.ts:273-283`) proves `/api/state` still returns the configured threshold; large-file collapse is computed independently at `DiffView.tsx:1110-1111`, so deleting `isLargeDiff`/`countLines` cannot change it; `bun test src/features/review/ui/components/DiffView.test.tsx` → 1 pass / 0 fail (UI module still loads); `/api/state` payload shape unchanged (`largeFileLineThreshold: threshold` at `routes.ts:1095`).
- **Removal risk:** In-repo `None found` after checking dynamic loading/registration (not in the feature registry nor the `src/index.tsx` export surface), external/untracked consumers (private package `package.json:6`; module entry `src/index.tsx` exports only `applyZodOptions`, no export map or barrel), public CLI options (none), config fields (`largeFileLineThreshold` is retained in schema/loader/routes, untouched by this deletion), persisted state (none), network/API shapes (`/api/state` unchanged), and release paths (not referenced by `scripts/release.ts`). Residual only: a hypothetical undocumented deep import of `isLargeDiff` from outside the repo — no in-repo consumer, private package, not in the export surface.
- **Needs investigation:** 2026-08-28 — removal is blocked before editing because baseline is not green under enforced 90% coverage. `bun test src/features/review/routes.test.ts src/features/review/server.test.ts` ran 34 pass / 0 fail / 140 expectations but exited 1 at 61.97% functions / 68.36% lines; `bun test src/features/review/ui/components/DiffView.test.tsx` ran 1 pass / 0 fail / 2 expectations but exited 1 at 6.44% functions / 25.95% lines; `bun run build` and `bun run lint` passed; full `bun test` ran 441 pass / 0 fail but exited 1 at 84.91% functions / 88.27% lines. Missing evidence: green focused and full baseline after repository coverage reaches enforced 90% thresholds. No source edit or removal-proof test was made.
## Removal process

- [x] Capture baseline before editing (2026-08-28): `bun test src/features/review/routes.test.ts src/features/review/server.test.ts` ran 34 pass / 0 fail / 140 expectations but exited 1 at 61.97% functions / 68.36% lines; `bun test src/features/review/ui/components/DiffView.test.tsx` ran 1 pass / 0 fail / 2 expectations but exited 1 at 6.44% functions / 25.95% lines; `bun run build` passed; `bun run lint` passed; full `bun test` ran 441 pass / 0 fail but exited 1 at 84.91% functions / 88.27% lines. Baseline is not green under enforced 90% coverage, so removal did not start.
- [ ] Add temporary `test/dead-code/review-unused-diff-helper.removal.test.ts` that reads `src/features/review/routes.ts` and asserts no declaration/export of `countLines` or `isLargeDiff`; run `bun test test/dead-code/review-unused-diff-helper.removal.test.ts` and observe RED while the orphaned helper exists.
- [ ] Re-run repo-wide search/LSP references and confirm `countLines` is used only by `isLargeDiff`, no route/registry/dynamic import/export-barrel consumer exists, and the private-package deep-import boundary remains the only compatibility caveat.
- [ ] Remove `countLines` and `isLargeDiff` from `src/features/review/routes.ts` only. Retain `largeFileLineThreshold` in the review config/loader and `/api/state` payload, `DiffView.tsx`'s independent `file.hunks` line sum with strict `>` comparison, and all route/server/UI callers; no config or API migration is needed.
- [ ] Run `bun test test/dead-code/review-unused-diff-helper.removal.test.ts`, `bun test src/features/review/routes.test.ts src/features/review/server.test.ts`, and `bun test src/features/review/ui/components/DiffView.test.tsx`; all must be GREEN, including the configured-threshold `/api/state` assertion and large-file collapse behavior.
- [ ] Re-check `grep -rn "isLargeDiff\|countLines" src test`, `/api/state` route assertions, and the `largeFileLineThreshold` references; confirm only intentional historical mentions remain and no network/API shape changed.
- [ ] Run final validation `bun run build`, `bun run lint`, and `bun test`; smoke the supported review entry with `bun run src/index.tsx help review`, reporting UI behavior only from tests unless the actual review UI is launched.
- [ ] Delete the temporary removal-proof test, rerun the retained route/server/DiffView tests, and record the execution result. Before committing, reconfirm no dynamic registration, public CLI option, persisted state, release path, or package export depends on either helper; if an external deep import is discovered, update `## Assessment` and stop.
