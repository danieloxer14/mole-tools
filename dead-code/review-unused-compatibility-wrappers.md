# Remove unused review compatibility wrappers

## Type
Redundant code

## Scope
- Area: `Review setup, HTTP server, persistent state, analysis, and conversations`
- Candidate paths: `src/features/review/setup.ts`, `paths.ts`, `store.ts`, `server.ts`, `routes.ts`, `sse.ts`, `chat.ts`, `layers.ts`
- Symbols/config/docs: `setupReviewWorktree`, `reviewPaths`, `pathsForReview`, `createReviewStore`, `startReviewServer`, `createReviewRouter`, `reviewRoutes`, `createSseResponse`, `validateLineTags`, `createChatPrompt`, `sendChatMessage`, `runChat`, `runLayerGeneration`, `createLayerInput`

## Evidence
- `src/features/review/setup.ts:483` exports `setupReviewWorktree` as an alias of `setupReview`; whole-repository search found no reference beyond that declaration. The live flow imports and calls `setupReview` from `src/features/review/index.ts:11-15,67`.
- `src/features/review/paths.ts:68-69` exports `reviewPaths` and `pathsForReview` as aliases of `getReviewPaths`; whole-repository search found no consumers. Production and tests use `getReviewPaths`, including `src/features/review/setup.ts:10,173,296,348` and `src/features/review/index.ts`.
- `src/features/review/store.ts:234-237` defines `createReviewStore`, but production code constructs `new ReviewStore` directly (`src/features/review/index.ts:17,117`; review chat/routes/layers). Whole-repository search found no factory call.
- `src/features/review/server.ts:85` exports `startReviewServer = createReviewServer`; `src/features/review/routes.ts:1309-1310` exports `createReviewRouter` and `reviewRoutes = createReviewRoutes`; `src/features/review/sse.ts:93` exports `createSseResponse = sseResponse`. LSP references and whole-repository search found declarations only; production and tests use canonical names `createReviewServer`, `createReviewRoutes`, and `sseResponse`.
- `src/features/review/chat.ts:133,246,428-429` exports `validateLineTags`, `createChatPrompt`, `sendChatMessage`, and `runChat` as aliases of canonical functions. LSP references and whole-repository search found declaration-only references; live routes/tests use `validateChatTags`, `buildChatPrompt`, and `runChatTurn`.
- `src/features/review/layers.ts:630-631` exports `runLayerGeneration` and `createLayerInput` as aliases of canonical functions. LSP references and whole-repository search found declaration-only references; live routes/tests use `generateLayers` and `buildLayerInput`.
- `package.json:1-5` marks the package private and sets `src/index.tsx` as its module entry. `src/index.tsx:16` exports only `applyZodOptions`; `src/features/review/index.ts` does not re-export these names, and no dynamic registration path references them.

## Why this is safe to change
These fourteen declarations have no in-repository callers, are not part of the private package's root export surface, and duplicate live entry points already used by setup, paths, store, server, routes, SSE, chat, layers, and tests. Removing them does not alter setup, path derivation, store persistence, worktree lifecycle, HTTP routing, streaming, chat sessions, layer generation, or comment behavior. The only remaining risk is undocumented external scripts importing source paths; package-private status and the absence of root exports establish the supported compatibility boundary, but such scripts are not observable from this repository.

## Proposed change
1. Remove `setupReviewWorktree` from `src/features/review/setup.ts`.
2. Remove `reviewPaths` and `pathsForReview` from `src/features/review/paths.ts`; retain `getReviewPaths` and all live path fields/builders.
3. Remove `createReviewStore` from `src/features/review/store.ts`; retain `ReviewStore` and its constructor/API.
4. Remove `startReviewServer` from `src/features/review/server.ts`, `createReviewRouter` and `reviewRoutes` from `src/features/review/routes.ts`, and `createSseResponse` from `src/features/review/sse.ts`; retain canonical `createReviewServer`, `createReviewRoutes`, and `sseResponse`.
5. Re-run review setup/state and HTTP route/server tests to prove current callers and persistence/streaming behavior remain intact.
6. Remove `validateLineTags`, `createChatPrompt`, `sendChatMessage`, and `runChat` from `src/features/review/chat.ts`; retain canonical chat prompt, tag-validation, and turn functions plus all compatibility input fields consumed by current callers.
7. Remove `runLayerGeneration` and `createLayerInput` from `src/features/review/layers.ts`; retain canonical layer input and generation functions.

## Acceptance criteria
- [ ] No unused setup, path, store, server, route, SSE, chat, or layer wrapper remains under the removed names.
- [ ] All live callers continue using canonical review setup, paths, store, server, route, SSE, chat, and layer APIs.
- [ ] Review worktree setup, path derivation, state migration, store persistence, HTTP routing, streaming, chat sessions, layer generation, and comment behavior remain unchanged.
- [ ] Targeted review setup/state, chat/layer, and route/server verification passes.

## Risks and open questions
- An undocumented external deep import could depend on one of these names; confirm package-private/deep-import policy before deletion. No such consumer exists in the repository.

## Assessment

- **Validated:** 2026-08-27 — `valid`
   - All 14 wrappers are declaration-only: a repo-wide search (gitignore off) returns only their own `export const … = …` lines plus this ticket — no import or call site. Canonical targets are all live: `setupReview` (index.ts:67), `getReviewPaths` (setup.ts:173,296,348), `new ReviewStore` (index.ts:117, setup.ts:349), `createReviewServer` (index.ts:115), `createReviewRoutes` (server.ts:33), `sseResponse` (routes.ts:303,760,850), `validateChatTags` (routes.ts:256), `buildChatPrompt` (chat.ts:347), `runChatTurn` (routes.ts:804), `generateLayers` (routes.ts:666), `buildLayerInput` (layers.ts:559). `createReviewStore` body is the only uncovered span in `store.ts` (coverage 220-222), proving the factory is never invoked. Stale ticket lines corrected: `createReviewStore` store.ts:220-223 (not 234-237); chat wrappers chat.ts:129,242,424-425 (not 133,246,428-429); layer wrappers layers.ts:632-633 (not 630-631); route wrappers routes.ts:1321-1322 (not 1309-1310).
- **Product impact:** `code` — **Priority P3**
   - Redundant aliases inside runtime review files (setup/paths/store/server/routes/sse/chat/layers), but each is dead: no consumer, absent from the root export surface (`src/index.tsx:16` exports only `applyZodOptions`), not re-exported by `src/features/review/index.ts` (imports canonical names only; no `export *` in the feature), and the package is private (`package.json:6`) with no `exports` map. Removal touches no product surface → internal dead code, defer.
- **Verification:**
   - Prove safe: search all 14 identifiers repo-wide (gitignore off) → expect only the 14 declaration lines in `src/features/review/{setup,paths,store,server,routes,sse,chat,layers}.ts` plus this ticket; LSP `references` on each returns declaration-only; no `import(` / string reference in the feature, `core/registry.ts`, or `scripts/release.ts`.
   - Prove behavior intact: `bun test src/features/review/` → 98 pass / 0 fail / 346 expect() calls; canonical names carry all setup/state/server/route/sse/chat/layers behavior.
- **Removal risk:** None found for dynamic loading (no `import()`/string reference), config fields, persisted state (review.json/chat.ndjson are written via the live `new ReviewStore` constructor, not the dead `createReviewStore` factory), and release paths. Residual: an unobservable external deep import into `src/features/review/*` could depend on a name — private package with no `exports` map makes this unobservable and outside repo support; confirm deep-import policy before actioning (pre-existing open question, not a blocker).
## Removal process

- [x] Capture baseline before editing: `bun test src/features/review/` passed 98/0 with 346 expect() calls but exited 1 at 63.83% functions / 68.97% lines under the enforced 90% coverage gate; `bun run build` passed; `bun run lint` passed; `bun test` passed 441/0 with 1,075 expect() calls but exited 1 at 84.91% functions / 88.27% lines under the same gate. Baseline is not green; no source removal started.
- [ ] Add temporary `test/dead-code/review-unused-compatibility-wrappers.removal.test.ts` that reads the eight review modules and asserts none exports the 14 obsolete aliases (`setupReviewWorktree`, `reviewPaths`, `pathsForReview`, `createReviewStore`, `startReviewServer`, `createReviewRouter`, `reviewRoutes`, `createSseResponse`, `validateLineTags`, `createChatPrompt`, `sendChatMessage`, `runChat`, `runLayerGeneration`, `createLayerInput`); run `bun test test/dead-code/review-unused-compatibility-wrappers.removal.test.ts` and observe RED before removal.
- [x] Re-ran LSP references for all 14 aliases: each returned its declaration only. Gitignore-off repository search found only alias declarations plus this ticket's historical mentions; no dynamic wrapper reference, string registration, feature-registry use, release-path use, or root export. Canonical callers remain `setupReview`, `getReviewPaths`, `new ReviewStore`, `createReviewServer`, `createReviewRoutes`, `sseResponse`, `validateChatTags`, `buildChatPrompt`, `runChatTurn`, `generateLayers`, and `buildLayerInput`.
- [ ] Remove exactly the 14 declarations from `src/features/review/setup.ts`, `paths.ts`, `store.ts`, `server.ts`, `routes.ts`, `sse.ts`, `chat.ts`, and `layers.ts`; retain canonical implementations, all live callers, compatibility input fields, `ReviewStore` constructor/API, state persistence, route/SSE behavior, chat behavior, layer generation, and comment behavior. No caller migration is expected beyond confirming canonical names because the Assessment found no aliases in use.
- [ ] Run `bun test test/dead-code/review-unused-compatibility-wrappers.removal.test.ts` and `bun test src/features/review/`; both must be GREEN, preserving review setup/worktree lifecycle, path derivation, state migration, persistence, HTTP routing/streaming, chat sessions, layers, and comments.
- [ ] Re-check all 14 names repo-wide and with LSP; confirm only this report's historical mentions remain, no stale imports/exports/aliases survive, and review state files (`review.json`, `chat.ndjson`) still flow through `new ReviewStore`.
- [ ] Run final validation `bun run build`, `bun run lint`, and `bun test`; smoke the supported review entry with `bun run src/index.tsx help review`, and do not claim visual/UI verification beyond launched surface/tests.
- [ ] Delete the temporary removal-proof test, rerun `bun test src/features/review/`, and record the execution result. Before committing, reconfirm private-package/no-export and no dynamic-loading compatibility, no config/API/release impact, and the unresolved undocumented deep-import policy; if any external deep import is found, update `## Assessment` and stop.
- [ ] Removal blocked: baseline must be green before creating the temporary removal-proof test or deleting the 14 declarations. Missing evidence is a green focused and full baseline after the enforced 90% coverage gate is satisfied or an explicit loop-approved baseline exception is recorded; no source, test, or temporary proof file changed in this iteration.
