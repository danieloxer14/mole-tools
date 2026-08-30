# Consolidate commits-ahead lookup with generic VCS log

## Type
Redundant code

## Scope
- Area: `Git host and VCS adapters`
- Candidate paths: `src/ports/vcs.ts`, `src/adapters/vcs/git.ts`, `test/fakes/FakeVcs.ts`, `src/features/merge-request/index.ts`, merge-request/VCS tests, maintained VCS specifications
- Symbols/config/docs: `Vcs.commitsAhead`, `GitAdapter.commitsAhead`, `Vcs.log`, merge-request nothing-to-merge guard

## Evidence
- `src/features/merge-request/index.ts:85-87` has the only production call to `ctx.vcs.commitsAhead(baseRef)`.
- `src/adapters/vcs/git.ts:298-305` builds `git log <base>..HEAD --pretty=format:%H<SEP>%s<SEP>%an<SEP>%aI` and parses it with `parseCommitLog`.
- `src/adapters/vcs/git.ts:307-315` implements the same command construction and parser through `log({ base, head?, cwd?, maxCount? })`; with `{ base: baseRef }`, `log` produces the same `base..HEAD` range and output.
- `Vcs.commitsAhead` has no callers outside its port, adapter, fake, and tests. Current review consumers already use the generic `log` method (`src/features/review/layers.ts:299-304`, `src/features/review/setup.ts:206-213`).
- Targeted verification: `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` passed 52 tests.

## Why this is safe to change
`commitsAhead(base)` adds no semantics beyond `log({ base })` in the only production flow that calls it. Reusing `log` preserves commit ordering, metadata parsing, and the existing nothing-to-merge guard while removing one port method and one duplicate Git command implementation. The application is private and wires its VCS implementation internally through `src/core/context.ts:148`.

## Proposed change
1. Replace the merge-request call with `ctx.vcs.log({ base: baseRef })`.
2. Remove `commitsAhead` from `Vcs`, `GitAdapter`, and `FakeVcs`, including its fake option and dedicated adapter test setup.
3. Update affected merge-request tests to provide `log` results and assert the generic log query where useful.
4. Update maintained VCS and merge-request specifications that still advertise `commitsAhead`; do not modify historical agent artifacts without an archival-policy decision.

## Acceptance criteria
- [ ] No production or test implementation exposes `Vcs.commitsAhead` after migration.
- [ ] Merge-request flow still aborts when `log({ base: baseRef })` returns no commits and passes commit subjects to generation otherwise.
- [ ] Generic `Vcs.log` behavior and review consumers remain unchanged.
- [ ] Focused VCS and merge-request verification passes.

## Risks and open questions
- An out-of-tree consumer could implement or call the internal `Vcs.commitsAhead` method; confirm private-package compatibility boundary before removal.
- The maintained implementation plan treats `commitsAhead` as a named contract, so its documentation must be deliberately migrated rather than silently left stale.

## Assessment

- **Validated:** 2026-08-30 — **needs-investigation**
   - Re-checked every `commitsAhead` reference (repo-wide `grep`): port decl `src/ports/vcs.ts:47`, adapter `src/adapters/vcs/git.ts:298-305`, fake `test/fakes/FakeVcs.ts:23,79-81`, sole production caller `src/features/merge-request/index.ts:86`, dedicated adapter test `src/adapters/vcs/git.test.ts:230-252`, MR fake-option refs `src/features/merge-request/index.test.ts:51/70/97/112`, and 3 maintained specs (`specs/architecture/code-design.md:249`, `specs/merge-request/merge-request-implementation-plan.md:112/344/536`). No out-of-tree consumer. Review consumers already use the generic `log` (`src/features/review/layers.ts:300`, `src/features/review/setup.ts:210`). `commitsAhead(base)` is behavior-equivalent to `log({ base })`: identical `<base>..HEAD` range, identical `%H\x1f%s\x1f%an\x1f%aI` pretty format, identical `parseCommitLog` (git.ts:302 vs 308). `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` = 52 pass / 0 fail (matches the ticket's recorded 52).
- **Product impact:** `code` — **Priority P1**
   - Runtime dedup on the supported, user-facing `merge-request` flow (`index.ts:86` → `generateMergeRequest` with commit subjects); per the legend, runtime code on a supported path maps to P1. Considered P2 ("port contract") and rejected: the `Vcs` port is internal — private package (`package.json:6`), no `exports` map, sole entry `src/index.tsx` exports only `applyZodOptions` — so it is not an external-gating contract. Removal is behavior-preserving.
- **Verification:**
   - *Safe removal:* `grep -rn commitsAhead` resolves only to port / adapter / fake / sole caller / 2 test files / 3 spec lines; `commitsAhead(base)` and `log({ base })` produce the same git command (arg order is irrelevant to git). Migration steps: (a) `index.ts:86` → `ctx.vcs.log({ base: baseRef })`; (b) drop `commitsAhead` from `Vcs` (vcs.ts:47), `GitAdapter` (git.ts:298-305), and `FakeVcs` (FakeVcs.ts:23,79-81); (c) flip MR test fake option `commitsAhead: [commit]` → `log: [commit]` (index.test.ts:51/70/97/112); (d) the dedicated adapter test at git.test.ts:239 keys `scriptedExec` on `args.join(" ")` (order-sensitive, git.test.ts:46), so its key `"log main..HEAD --pretty=…"` must flip to `log`'s construction order `"log --pretty=… main..HEAD"`, or the test is deleted.
   - *Supported behavior still works:* `bun test src/features/merge-request` — the "Nothing to merge" abort still fires when `log({ base })` returns `[]` (guard at `index.ts:87` unchanged) and commit subjects still flow to generation (`index.ts:100,160`). `bun test src/adapters/vcs` — the `log` contract stays green. Full gate: `bun test` plus `bunx biome check`.
   - *Coverage gaps the migration must close:* no existing test covers the empty "Nothing to merge" abort (grep found none in index.test.ts) — add a `log: []` → `AbortError("Nothing to merge")` case; and the no-`maxCount` `log({ base })` command construction that `commitsAhead` previously owned is not exercised by the existing `log` adapter test (git.test.ts:278-282 covers only `-n5 main..HEAD`) — add a base-only adapter case.
- **Removal risk:** Low. Dynamic loading / external consumers: none (`commitsAhead` is grep-clean outside port/adapter/fake/tests; private package, no `exports` map, sole entry `src/index.tsx`). Config / persisted state / network / API shape: none (internal VCS port method, no config field or API shape). Release / installer: not referenced in `scripts/release.ts` or `install.sh`. Spec migration (documentation, not runtime): the 3 maintained specs must be retargeted from `commitsAhead` to `log` (`code-design.md:249`; `merge-request-implementation-plan.md:112/344/536`) so the named contract is not left stale — these are maintained specs, so no archival-policy decision is needed. Sole open items: the spec retarget and the two test adjustments above; none block removal.
- **Iteration gate:** Baseline could not be green. `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` ran 52 tests with 0 failures but exited 1 because Bun coverage was 72.17% functions / 71.60% lines against the configured 90% thresholds in `bunfig.toml:3`; `bun run build` passed; `bun run lint` passed; full `bun test` ran 445 tests with 0 failures but exited 1 at 85.26% functions / 88.59% lines. No source or test removal was attempted. Missing evidence: a green baseline/full-test gate, either after unrelated coverage debt is resolved or with an approved ticket-specific gate that preserves coverage enforcement.

## Removal process

- [ ] **Migrate the production call first.** In `src/features/merge-request/index.ts:85-87`, replace `ctx.vcs.commitsAhead(baseRef)` with `ctx.vcs.log({ base: baseRef })`; leave the empty-result `AbortError("Nothing to merge")` guard and commit-subject mapping unchanged.
- [ ] **Remove the obsolete port and implementation surface.** Delete `commitsAhead` from `src/ports/vcs.ts`, remove `GitAdapter.commitsAhead` and its duplicate `git log <base>..HEAD --pretty=format:%H\x1f%s\x1f%an\x1f%aI` method from `src/adapters/vcs/git.ts`, and remove `commitsAhead` from `FakeVcsOptions` plus the `FakeVcs.commitsAhead` method in `test/fakes/FakeVcs.ts`; confirm no production/test implementation still exposes the name.
- [ ] **Update fixtures and order-sensitive adapter coverage.** Change `commitsAhead: [commit]` to `log: [commit]` in `src/features/merge-request/index.test.ts:51/70/97/112`; convert `src/adapters/vcs/git.test.ts:230-252` to call `git.log({ base: "main" })` (or remove only that now-duplicate test if equivalent coverage remains), and if retaining the scripted command assertion use the generic `log` argument order exactly: `log --pretty=format:%H\x1f%s\x1f%an\x1f%aI main..HEAD`, because `scriptedExec` keys `args.join(" ")`.
- [ ] **Close the two assessed coverage gaps.** Add a merge-request flow case with fake `log: []` that asserts `AbortError("Nothing to merge")` and proves no generation proceeds; add a GitAdapter base-only case for `git.log({ base: "main" })` with no `maxCount`, asserting the no-`-n` command and parsed commit metadata. Keep existing `Vcs.log` tests and review consumers unchanged.
- [ ] **Create temporary removal-proof RED/GREEN coverage.** Before changing the production call, make one merge-request fixture provide only `log: [commit]` (no `commitsAhead`) and run `bun test src/features/merge-request/index.test.ts`; record RED while `index.ts` still calls the removed method/default empty fake path, then run the same command after the caller, port, fake, and tests are migrated and record GREEN. Retain the equivalent generic-log fixture as permanent coverage.
- [ ] **Retarget maintained specifications only.** Replace the three live contract references at `specs/architecture/code-design.md:249` and `specs/merge-request/merge-request-implementation-plan.md:112/344/536` with `Vcs.log({ base })` semantics, including the `base..HEAD` range and structured metadata; do not rewrite historical agent artifacts without a separate archival-policy decision.
- [ ] **Retain behavior and compatibility coverage.** Keep `bun test src/features/merge-request`, `bun test src/adapters/vcs`, and `bun test src/port-contracts/vcs-worktree-create.test.ts` coverage for commit ordering, `%H\\x1f%s\\x1f%an\\x1f%aI` parsing, no-commits abort, generation prompt subjects, and all existing review `Vcs.log` consumers; verify the private package boundary and absence of any out-of-tree consumer before deleting the internal method.
- [ ] **Run final validation.** Run `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts`, then the full `bun test`, and `bunx biome check`; all must pass with no `commitsAhead` implementation, call, fake option, test fixture, or maintained-spec contract left stale.
- [ ] **Smoke the affected merge-request runtime path.** From a feature branch with at least one commit ahead of its default branch, run `bun run src/index.tsx merge-request --context "verify generic VCS log"`; confirm the non-empty path includes commit subjects in generation and reaches MR creation, then repeat on a branch with no commits ahead and confirm the existing `Nothing to merge` abort occurs before generation. Do not treat review-only `Vcs.log` consumers as migrated behavior; leave them on the generic method.
- [ ] **Close ticket-specific risks.** Record that `Vcs` is internal (`package.json:6`, no `exports` map), no config/persisted/network/API/release/installer surface uses `commitsAhead`, and no out-of-tree consumer was found; ensure arg-order-sensitive scripted tests use `GitAdapter.log`'s order and document that historical artifacts are intentionally untouched.
