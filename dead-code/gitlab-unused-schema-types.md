# Remove unconsumed GitLab schema type aliases

## Type
Dead code

## Scope
- Area: `Git host and VCS adapters`
- Candidate paths: `src/adapters/git-host/glab-schemas.ts`, direct GitLab adapter imports
- Symbols/config/docs: `GitLabApprovalState`, `GitLabPositionPayload`, `GitLabMergeRequest`, `GitLabNote`

## Evidence
- Scoped repository search found no imports or references to `GitLabApprovalState` (`glab-schemas.ts:62`), `GitLabPositionPayload` (`:151`), `GitLabMergeRequest` (`:175`), or `GitLabNote` (`:177`) beyond their declarations.
- The runtime schema values remain live: `GitLabApprovalStateSchema`, `GitLabPositionPayloadSchema`, `GitLabMergeRequestSchema`, `GitLabDiscussionSchema`, and `GitLabDiscussionPageSchema` are consumed by `src/adapters/git-host/glab.ts:252-253,302-304,388-390,407-410,449-450`.
- `GitLabPositionPayload` is redundant with the shared `GitLabPositionPayload` interface at `src/shared/gitlab-position.ts:19-32`, re-exported through `src/ports/git-host.ts:5-8`; `GlabAdapter` accepts that shared port type and only needs the schema value for runtime validation.
- `GitLabDiscussion` is not included as a candidate: `src/adapters/git-host/glab.ts:454` textually references it, but it is missing from that file’s import list (`:18-24`), producing a separate TypeScript diagnostic (`Cannot find name 'GitLabDiscussion'`).
- `package.json:4,6` identifies a private application with `src/index.tsx` as its module entry; no package export map or repository import exposes these aliases. Targeted GitLab tests passed 53 tests.

## Why this is safe to change
The aliases have no current consumer and deleting them does not alter parsed payloads, validation, or adapter output. The shared position interface remains the single port-facing type. This audit checked repository consumers and the package-private application boundary rather than assuming that every schema declaration is dead.

## Proposed change
1. Remove only the four unconsumed inferred type aliases from `glab-schemas.ts`.
2. Keep all runtime schema constants and all inferred aliases that have a live adapter reference, including `GitLabDiscussion` after its separate missing-import issue is resolved.
3. Re-run GitLab adapter and port-contract tests, and run the typecheck to distinguish this cleanup from existing diagnostics.

## Acceptance criteria
- [ ] No unconsumed inferred type aliases remain in `glab-schemas.ts` for approval state, position payload, merge request, or note.
- [ ] Runtime GitLab validation and adapter outputs remain unchanged.
- [ ] Shared `GitLabPositionPayload` remains the only port-facing position type.
- [ ] GitLab adapter and port-contract verification passes; no new diagnostics are introduced.

## Risks and open questions
- Direct consumers outside this private repository could import internal schema types; confirm package-private source boundary before deleting exports.
- `GitLabDiscussion` has a separate unresolved import/typecheck error and must not be silently removed as part of this ticket.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Re-ran repo-wide word-boundary grep for all four aliases: each appears only at its own declaration — `GitLabApprovalState` glab-schemas.ts:62, `GitLabPositionPayload` :151, `GitLabMergeRequest` :175, `GitLabNote` :177 — with no import or usage anywhere. Runtime `*Schema` values confirmed consumed at glab.ts:253 (fetchMr), :303 (fetchApprovalState), :450 (mapDiscussion), plus :388-390/:407-410. `gitlab-schemas` is imported only by glab.ts (glab.ts:18-24); no `export *` barrel. `GitLabDiscussion` (glab-schemas.ts:176) confirmed as a separate pre-existing diagnostic — glab.ts:454 `Cannot find name 'GitLabDiscussion'` (absent from the import list) — correctly excluded from scope. `bun run build` compiles `mole-tools`; `bun test src/ports src/adapters/git-host src/shared/gitlab-position` → 58 pass / 0 fail (up from the 53 recorded at discovery, still green).
- **Product impact:** `code` — **Priority P3**
   - Type-only aliases in the internal adapter schema module `glab-schemas.ts`; erased at compile time, no runtime surface, private package (`package.json:6`) with no `exports`/`main` map and zero consumers. Internal dead code with no direct product surface → P3. Not P2: the live port-facing position type is the shared `GitLabPositionPayload` interface at `src/shared/gitlab-position.ts:19` (re-exported via `src/ports/git-host.ts:7`), not this duplicate alias; the aliases gate nothing.
- **Verification:**
   - Removal is safe: `grep -rnE '\b(GitLabApprovalState|GitLabPositionPayload|GitLabMergeRequest|GitLabNote)\b' .` returns only the four glab-schemas.ts declaration lines; `grep -rn 'from "./glab-schemas"' .` returns only glab.ts; `grep -rn 'export \* from' src/adapters` returns nothing (no re-export surface). `bunx tsc --noEmit` baseline error set contains none of the four aliases, so deleting them adds zero new diagnostics (existing errors live in exec.test.ts, loader.test.ts, glab.ts:99/454/456/469/470, chat.test.ts, comments.test.ts, features/review/index.ts).
   - Supported behavior after removal: `bun run build` compiles the runtime path that imports the schemas; `bun test src/ports src/adapters/git-host src/shared/gitlab-position` → 58 pass / 0 fail (gitlab adapter + port-contract + shared position); schema consumption at glab.ts:253/303/388-390/407-410/450 unchanged.
- **Removal risk:** None found — no dynamic loading (type aliases are compile-time only); no external/untracked consumer (private package, no export map, `module: src/index.tsx` app entry, `glab-schemas` imported only by glab.ts, no barrel); not a CLI option, config field, or persisted state; no network/API shape change (the runtime `*Schema` values — the parsed shapes — remain; the aliases are erased); `scripts/release.ts` untouched. Scope guard: removing `GitLabMergeRequest` (glab-schemas.ts:175) must leave the adjacent live `GitLabDiscussion` (:176, referenced at glab.ts:454) intact — do not remove it as part of this ticket.
## Removal process

- [x] Baseline re-verification completed on Bun 1.3.14. LSP references for `GitLabApprovalState`, `GitLabPositionPayload`, `GitLabMergeRequest`, and `GitLabNote` each returned only its declaration in `src/adapters/git-host/glab-schemas.ts`; repository search found no other alias consumers. `glab.ts` remains the sole `./glab-schemas` import and no adapter export barrel was found. `bun run build` passed, `bun run lint` passed with no fixes, `bun test` passed 441 / 0 across 59 files, and `bun test src/ports src/adapters/git-host src/shared/gitlab-position` passed 58 / 0. `bunx tsc --noEmit` reported the pre-existing 115-diagnostic set, including `GitLabDiscussion` missing from `glab.ts` imports; no alias diagnostic was present.
- [x] Added temporary `test/dead-code/gitlab-unused-schema-types.removal.test.ts` using Bun file reads. `bun test test/dead-code/gitlab-unused-schema-types.removal.test.ts` was RED with 0 pass / 4 fail while the four declarations existed.
- [x] Preserved runtime `GitLabApprovalStateSchema`, `GitLabPositionPayloadSchema`, `GitLabMergeRequestSchema`, `GitLabDiscussionSchema`, and `GitLabDiscussionPageSchema`; preserved shared port-facing `GitLabPositionPayload` and `GitLabDiscussion`.
- [x] Removed exactly the four inferred type aliases from `src/adapters/git-host/glab-schemas.ts`: `GitLabApprovalState`, `GitLabPositionPayload`, `GitLabMergeRequest`, and `GitLabNote`. No caller migration was needed.
- [x] `bun test test/dead-code/gitlab-unused-schema-types.removal.test.ts` passed 4 / 0 after removal, and `bun test src/ports src/adapters/git-host src/shared/gitlab-position` passed 58 / 0.
- [x] Post-removal search found only intentional shared `GitLabPositionPayload` references and the live runtime schema import from `glab.ts`; no removed alias declaration remained. `bunx tsc --noEmit` reported the same 115 diagnostics as baseline, including only the pre-existing `GitLabDiscussion` diagnostic in this area.
- [x] Final validation passed: `bun run build`, `bun run lint`, and a rerun of `bun test` passed 445 / 0 across 60 files. One initial full-test run hit an unrelated transient `routes.test.ts:730` failure; its focused rerun passed 1 / 0 and the subsequent full run passed. CLI smoke `bun run src/index.tsx help` passed and listed supported commands; GitLab adapter/schema consumers stayed on the normal path.
- [x] Deleted temporary removal proof and reran `bun test src/ports src/adapters/git-host src/shared/gitlab-position`, which passed 58 / 0. Final compatibility check confirmed private package boundary, no `exports` map or adapter barrel, no dynamic loading, no CLI/config/persisted-state/release/API impact, and untouched `GitLabDiscussion` declaration; no external deep import was found.
