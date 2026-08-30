# Remove redundant FakeVcs-only worktree contract tests

## Type
Obsolete test/fixture

## Scope
- Area: `Tests, fakes, and fixtures`
- Candidate paths: `src/port-contracts/vcs-worktree.test.ts`
- Symbols/config/docs: `Vcs port contract — worktrees`; `FakeVcs` default/error forwarding assertions

## Evidence
- `src/port-contracts/vcs-worktree.test.ts:6-29` invokes `worktrees`, `removeWorktree`, `forceRemoveWorktree`, and `showWorktreeStatus` only on `FakeVcs`; none of these tests invokes `GitAdapter` or a production feature.
- `src/port-contracts/vcs-worktree.test.ts:31-73` repeats FakeVcs option forwarding and default-return behavior. `FakeVcs implements Vcs` in `test/fakes/FakeVcs.ts:37` already makes interface conformance a TypeScript compile-time check.
- Live adapter behavior is covered by `src/adapters/vcs/git.test.ts:296-373,375-430,450-462` for worktree discovery, clean/forced removal, failures, and status output. `src/port-contracts/vcs-worktree-create.test.ts:16-70` covers clone/fetch/merge-base/worktree/diff/remote adapter wiring.
- Feature behavior consumes the fake through `src/features/worktree-prune/discovery.test.ts:69-143`, `src/features/worktree-prune/index.test.ts:129-462`, and review setup/routes tests; these assert filtering, removal decisions, failure recovery, and persisted review worktrees rather than fake defaults.
- LSP references for `FakeVcs` found 73 references across the candidate file plus live feature/adapter tests; no production import of the test file exists. `bun test src/port-contracts/vcs-worktree.test.ts src/port-contracts/vcs-worktree-create.test.ts src/adapters/vcs/git.test.ts src/features/worktree-prune/discovery.test.ts src/features/worktree-prune/index.test.ts src/features/review/setup.test.ts src/features/review/routes.test.ts` passed 95 tests with 0 failures and 268 expectations.

## Why this is safe to change
The candidate file tests the behavior of a test double, not the GitAdapter or a user-visible feature. Its interface-call checks duplicate compile-time implementation checking, while its default and error assertions duplicate the same FakeVcs configurations exercised by worktree-prune and review orchestration tests. Removing this file leaves `FakeVcs` available to live tests and retains production adapter and feature behavior coverage. No package export or runtime test-discovery registration references this file directly.

## Proposed change
1. Delete `src/port-contracts/vcs-worktree.test.ts`.
2. Keep `test/fakes/FakeVcs.ts`, its Vcs methods, and all live adapter/feature tests; migrate an assertion only if verification identifies a unique observable contract currently covered nowhere else.
3. Re-run the focused VCS, review setup/routes, and worktree-prune suites plus the repository test command.

## Acceptance criteria
- [ ] `src/port-contracts/vcs-worktree.test.ts` is removed without deleting `FakeVcs` or any production VCS method.
- [ ] No test imports or test-discovery references to the deleted file remain.
- [ ] GitAdapter worktree discovery/removal/status behavior and worktree-prune/review orchestration remain covered by their existing tests.
- [ ] Focused verification and the full Bun test suite pass.

## Risks and open questions
- An untracked consumer could import this internal test path, but `package.json:1-6` marks the application private and no package export exposes test files. Confirm repository policy before execution.
- Do not combine this cleanup with removal of Vcs methods or FakeVcs options; those are separate compatibility/port decisions.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Re-checked `FakeVcs implements Vcs` (`test/fakes/FakeVcs.ts:37`); all 8 tests in `src/port-contracts/vcs-worktree.test.ts` are `new FakeVcs()` shape/forwarding checks. Duplicate coverage confirmed: `worktrees` (discovery.test.ts:80-135, index.test.ts:107-516, setup.test.ts:52, routes.test.ts:1364/1462), `removeWorktreeError` (index.test.ts:143/277/312/416), `showWorktreeStatusOutput` (index.test.ts:344 + real git.test.ts:450-462). The `forceRemoveWorktreeError` knob is exercised only here, but its product failure path stays covered by index.test.ts:454-457 inline override and real git.test.ts:418-430. Real adapter coverage at git.test.ts:296-462 exceeds the fake tests. Evidence drift since discovery: 75 LSP refs / 98 tests / 273 expect (ticket said 73/95/268); direction unchanged.
- **Product impact:** `test` — **Priority P3**
   - Pure test-of-a-fake (Vcs worktree contract via FakeVcs). No runtime, config, CLI, network, or release surface touched; maps to P3 (test/fixture, no direct product surface).
- **Verification:**
   - Removal-safe (run without the candidate file): `bun test src/port-contracts/vcs-worktree-create.test.ts src/adapters/vcs/git.test.ts src/features/worktree-prune/discovery.test.ts src/features/worktree-prune/index.test.ts src/features/review/setup.test.ts src/features/review/routes.test.ts` → 90 pass / 0 fail / 264 expect; `grep -rn "vcs-worktree"` shows no importer; `package.json` has no `exports` map.
   - Supported behavior still works: same command keeps worktree discovery / removal / force-removal / status / failure-recovery covered (git.test.ts:296-462 real adapter + worktree-prune/review suites); full run `bun test` → 98 pass / 0 fail with the file present.
- **Removal risk:** None found for product behavior after checking dynamic loading (bun auto-discovers `*.test.ts`; file is self-discovering, not imported), external consumers (private pkg, no export map), and config/release paths (test-only). Residual: FakeVcs knob `forceRemoveWorktreeError` (`test/fakes/FakeVcs.ts:33,171-172`) becomes unused — a test-only injection point, non-blocking; the proposed change keeps `FakeVcs` intact.
- **Needs investigation:** 2026-08-30 — removal still blocked before editing because required baseline is not green. Re-ran the recorded focused suite with the candidate file: 98 pass / 0 fail / 273 expectations, but Bun exited 1 at 64.28% functions / 70.19% lines against the 90% threshold; the removal-safe retained suite likewise ran 90 pass / 0 fail / 264 expectations and exited 1 at 64.28% / 70.19%. `bun run build` passed and `bun run lint` passed. Re-ran full `bun test`: 447 pass / 0 fail / 1,097 expectations, but exited 1 at 85.39% functions / 88.90% lines. Missing evidence: green focused and full baseline after resolving the repository-wide coverage shortfall; no removal-proof test or source edit was started.
## Removal process

- [x] Capture baseline before editing (2026-08-30): focused suite with candidate file ran 98 pass / 0 fail / 273 expectations but exited 1 at 64.28% functions / 70.19% lines; retained suite without candidate ran 90 pass / 0 fail / 264 expectations but exited 1 at 64.28% / 70.19%; `bun run build` passed; `bun run lint` passed; full `bun test` ran 447 pass / 0 fail / 1,097 expectations but exited 1 at 85.39% functions / 88.90% lines under the enforced 90% coverage gate. Baseline is not green, so removal did not start.
- [ ] Add temporary `test/dead-code/redundant-fake-vcs-contract-tests.removal.test.ts` that asserts `src/port-contracts/vcs-worktree.test.ts` does not exist and, after confirming no retained test uses it, that `forceRemoveWorktreeError` is absent from `test/fakes/FakeVcs.ts`; run `bun test test/dead-code/redundant-fake-vcs-contract-tests.removal.test.ts` and observe RED before deletion.
- [ ] Preserve compile-time `FakeVcs implements Vcs`, `test/fakes/FakeVcs.ts` methods needed by worktree-prune/review tests, real `GitAdapter` worktree discovery/removal/status/failure tests, and feature failure recovery. Remove the eight FakeVcs-only tests by deleting exactly `src/port-contracts/vcs-worktree.test.ts`.
- [ ] Re-run the FakeVcs search and remove only the now-unused `forceRemoveWorktreeError` test knob (`test/fakes/FakeVcs.ts:33,171-172`) if no retained behavior uses it; do not remove Vcs methods, FakeVcs options, or production VCS code merely because this test file is gone.
- [ ] Run `bun test test/dead-code/redundant-fake-vcs-contract-tests.removal.test.ts` and the retained focused suite `bun test src/port-contracts/vcs-worktree-create.test.ts src/adapters/vcs/git.test.ts src/features/worktree-prune/discovery.test.ts src/features/worktree-prune/index.test.ts src/features/review/setup.test.ts src/features/review/routes.test.ts`; both must be GREEN, preserving worktree discovery, clean/forced removal, status, and failure-recovery behavior.
- [ ] Re-check `grep -rn "vcs-worktree" src test`, `grep -rn "forceRemoveWorktreeError" src test`, and package metadata; confirm no import or Bun test-discovery reference to the deleted file, no stale test knob unless intentionally retained, and no external export path.
- [ ] Run final validation `bun run build`, `bun run lint`, and `bun test`; smoke the supported CLI entry with `bun run src/index.tsx help` to confirm test-only cleanup leaves command composition unchanged.
- [ ] Delete the temporary removal-proof test, rerun the retained VCS/worktree/review tests, and record the execution result. Before committing, reconfirm Bun auto-discovery, private-package/no-export compatibility, and no config/release/runtime surface was changed; if an out-of-tree import is found, update `## Assessment` and stop.
