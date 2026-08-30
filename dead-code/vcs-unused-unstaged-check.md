# Remove unused unstaged-change VCS contract

## Type
Dead code

## Scope
- Area: `Git host and VCS adapters`
- Candidate paths: `src/ports/vcs.ts`, `src/adapters/vcs/git.ts`, `test/fakes/FakeVcs.ts`, `src/features/merge-request/index.test.ts`
- Symbols/config/docs: `Vcs.hasUnstagedChanges`, `GitAdapter.hasUnstagedChanges`, the merge-request test override, stale implementation-plan references

## Evidence
- Whole-repository reference search found `hasUnstagedChanges` only in the VCS port, `GitAdapter`, `FakeVcs`, and `src/features/merge-request/index.test.ts:123`; no production caller reads it.
- `src/features/merge-request/index.ts:75-94` checks staged changes, then uses upstream state and `mergeBaseDiff`; it never checks unstaged changes. The test at `src/features/merge-request/index.test.ts:108-138` is explicitly named “allows unstaged changes” and overrides `hasUnstagedChanges` without the flow reading the override.
- `src/adapters/vcs/git.ts:381-384` only wraps `git diff --quiet`; removing it cannot change current production control flow.
- Targeted verification: `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` passed 52 tests.

## Why this is safe to change
The live merge-request behavior intentionally permits unstaged changes and sends only the merge-base diff. The method has no production consumer, and the application is a private package whose VCS implementation is wired internally by `src/core/context.ts:148`. No public VCS entry point or out-of-repository implementation is present in this repository.

## Proposed change
1. Remove `hasUnstagedChanges` from the `Vcs` port and `GitAdapter`.
2. Remove the corresponding `FakeVcs` method and the unused override at `src/features/merge-request/index.test.ts:123`.
3. Update maintained merge-request specifications that still describe an unstaged-change guard; leave historical agent artifacts unchanged unless their archival policy requires otherwise.
4. Run the VCS and merge-request tests and confirm unstaged changes remain allowed and excluded from the merge-base diff.

## Acceptance criteria
- [ ] `Vcs`, `GitAdapter`, and `FakeVcs` expose no `hasUnstagedChanges` method.
- [ ] Merge-request flow behavior remains: unstaged changes are allowed and excluded from the generated merge-base diff.
- [ ] All affected tests and maintained documentation no longer reference the removed guard.
- [ ] Targeted VCS and merge-request verification passes.

## Risks and open questions
- An out-of-tree consumer could implement the internal `Vcs` interface directly; confirm repository package-private status is sufficient compatibility boundary before removal.
- `specs/merge-request/merge-request-implementation-plan.md` contains historical guard requirements and needs an explicit archival/update decision.

## Assessment

- **Validated:** 2026-08-27 — `valid`
   - Whole-repo regex grep `hasUnstagedChanges` returned exactly 7 static sites before removal: port declaration `src/ports/vcs.ts:50`, `GitAdapter` `src/adapters/vcs/git.ts:381-384` (wraps `git diff --quiet`), `FakeVcs` `test/fakes/FakeVcs.ts:83-85` (returns `false`), inert override `src/features/merge-request/index.test.ts:123`, and three spec refs (`specs/merge-request/merge-request-implementation-plan.md:108/136/522`); no production caller.
   - MR flow `src/features/merge-request/index.ts:55-166` calls `hasStagedChanges`/`hasUpstream`/`isAheadOfUpstream`/`commitsAhead`/`mergeBaseDiff`, never `hasUnstagedChanges`; the "allows unstaged changes" test's override (line 123) is inert — its assertion (prompt `toContain("committed.ts")`, `not.toContain("unstaged")`) holds because the flow sends `mergeBaseDiff` only. Coverage: `FakeVcs.ts:83` body 0%-covered; no test exercises `git.ts:381`.
   - Wired internally at `src/core/context.ts:148` (`new GitAdapter()`); not a public entry point. `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` → 52 pass / 0 fail.
- **Product impact:** `code` — **Priority P3**
   - Dead runtime port-contract slot with no consumer, so no product surface. Private package (`package.json:6 "private": true`), no `exports`/`main`, no `src/ports` barrel, and root `src/index.tsx:16` exports only `applyZodOptions`. Matches the dead-internal-contract siblings `gitlab-unused-schema-types` (P3) and `review-agent-generic-parser` (P3). The layered spec update is P4-flavored; the core removal is a dead internal contract → P3.
- **Verification:**
   - Removal safe: `grep -rn "hasUnstagedChanges" src test` → 0 hits after dropping port decl `vcs.ts:50`, `git.ts:381-384`, `FakeVcs.ts:83-85`, and override `index.test.ts:123`; then `bun run build` (compile) clean — no `implements Vcs` mismatch or dangling override.
   - Supported behavior still works: after removing the inert override `index.test.ts:123`, the test "allows unstaged changes but only sends the merge-base diff" (`index.test.ts:108-138`) still passes (prompt `toContain("committed.ts")`, `not.toContain("unstaged")`); `mergeBaseDiff` (`git.ts:377-379`) is unchanged, so unstaged changes stay excluded from the diff.
- **Removal risk:** Code/compat risk **None found** after checks — dynamic loading: none (no dynamic dispatch or computed key; whole-repo regex search was exhaustive across 7 pre-removal static hits); external/untracked consumer: none (private pkg, no export surface, wired at `context.ts:148`); CLI/config/persisted-state/network shapes: none; release/installer: none. Stale historical plan material was updated to preserve live behavior documentation: unstaged changes proceed and remain excluded from the merge-base diff.
## Removal process

- [x] Capture baseline before editing: ran `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` (52 pass / 0 fail; command exited on existing coverage gate at 72.02% funcs / 71.47% lines), `bun run build` (pass), `bun run lint` (pass), and `bun test` (440 pass / 0 fail; command exited on existing coverage gate at 84.91% funcs / 88.27% lines). The retained “allows unstaged changes but only sends the merge-base diff” test passed with inert override present.
- [x] Added temporary `test/dead-code/vcs-unused-unstaged-check.removal.test.ts`; `bun test test/dead-code/vcs-unused-unstaged-check.removal.test.ts` was RED (1 fail) before removal and GREEN (1 pass / 0 fail) after removal.
- [x] Updated historical `specs/merge-request/merge-request-implementation-plan.md`: removed obsolete `hasUnstagedChanges` interface/implementation/mapping references and corrected stale “dirty unstaged trees” rationale; preserved live “unstaged changes proceed and are excluded” statements.
- [x] Removed `Vcs.hasUnstagedChanges`, `GitAdapter.hasUnstagedChanges`, `FakeVcs.hasUnstagedChanges`, and inert merge-request test override. `hasStagedChanges`, `mergeBaseDiff`, upstream/ahead checks, and retained committed/unstaged assertions were unchanged.
- [x] Re-ran removal proof before cleanup (1 pass / 0 fail) and retained `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` (52 pass / 0 fail; existing coverage gate exit at 72.17% funcs / 71.59% lines). Both test sets had no test failures.
- [x] Rechecked `hasUnstagedChanges` across `src`, `test`, and `specs` (no matches); `GitAdapter` and `FakeVcs` remain the only `Vcs` implementers; no computed/dynamic dispatch or package export surface; `package.json` remains private.
- [x] Final validation: `bun run build` (pass), `bun run lint` (pass), and `bun test` (440 pass / 0 fail; existing coverage gate exit at 84.99% funcs / 88.36% lines). `bun run src/index.tsx help` listed all five supported commands. Retained merge-request flow test exercised unstaged allowance and merge-base-only diff; no live network/release smoke was required by this internal contract removal.
- [x] Deleted temporary removal-proof test and reran retained VCS/merge-request tests (52 pass / 0 fail; existing coverage gate exit at 72.17% funcs / 71.59% lines). Private-package and internal wiring checks remained unchanged; stale plan material was updated, not archived.
