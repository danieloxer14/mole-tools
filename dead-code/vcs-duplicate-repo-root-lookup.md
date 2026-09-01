# Cache merge-request repository root lookup

## Type
Redundant code

## Scope
- Area: `Git host and VCS adapters`
- Candidate paths: `src/features/merge-request/index.ts`, merge-request flow tests
- Symbols/config/docs: `runMergeRequestFlow`, `Vcs.repoRoot`, dynamic environment script branch

## Evidence
- `src/features/merge-request/index.ts:137-145` calls `ctx.vcs.repoRoot()` once to compute `repoName` and calls it again to build the dynamic-environment script path when the configured-repository branch is accepted.
- `GitAdapter.repoRoot()` at `src/adapters/vcs/git.ts:479-481` executes `git rev-parse --show-toplevel` for each call; the second call returns the same repository root and adds no behavior.
- The second call is conditional on `dynamicEnvRepos` matching and user confirmation, so current no-config behavior must remain unchanged; caching the first result within this post-create branch preserves that boundary.
- Targeted merge-request/VCS verification: `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` passed 52 tests.

## Why this is safe to change
Both uses need the same root for one flow invocation, and `repoRoot()` is a pure read of Git repository state. Reusing the first result changes only subprocess count, not repository selection, script path, confirmation order, or dynamic-environment execution. The owner and change are local to the merge-request flow.

## Proposed change
1. Retain the first repository-root result after MR creation and use it to construct the dynamic-environment script path.
2. Preserve the existing conditional so `repoRoot()` is not introduced for configurations without dynamic environment repositories.
3. Add focused call-count coverage for a matching configured repository and retain existing dynamic-environment behavior tests.

## Acceptance criteria
- [ ] A configured dynamic-environment repository performs one `Vcs.repoRoot()` lookup per flow invocation after MR creation.
- [ ] Unconfigured repositories retain current control flow and do not perform an unnecessary lookup.
- [ ] Dynamic-environment script discovery and execution use the same path as before.
- [ ] Focused merge-request verification passes.

## Risks and open questions
- If a VCS implementation can change repository root between calls, caching would preserve the first observed root; `GitAdapter` resolves a fixed worktree root and the flow already treats both calls as one operation.

## Assessment

- **Validated:** 2026-08-27 — `valid`
   - Re-checked both `ctx.vcs.repoRoot()` calls in `src/features/merge-request/index.ts`: line 138 (`const repoName = basename(await ctx.vcs.repoRoot())`) and line 144 (`join(await ctx.vcs.repoRoot(), ...)` inside the dynamic-env branch). `GitAdapter.repoRoot()` (`src/adapters/vcs/git.ts:479-481`) runs `git rev-parse --show-toplevel` per call, so the second is a redundant subprocess — dedup claim holds. `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` → 52 pass / 0 fail (matches the ticket's 52). Also found a 3rd independent call at `src/features/merge-request/reviewers.ts:192` (CODEOWNERS lookup) — separate concern, out of scope for this dedup.
- **Product impact:** `code` — **Priority P1**
   - Runtime dedup on the user-facing merge-request flow, gated by the live config fields `dynamicEnvRepos`/`dynamicEnvScript` (`src/adapters/config/schema.ts:65-66`, `README.md:135-136`, `loader.ts:34-35`). Same product surface as the sibling `vcs-duplicate-commits-ahead-log` P1, but a narrower trigger (config + confirm gated, vs that one's unconditional call).
- **Verification:**
   - Prove the dedup is safe: cache line 138's result and reuse it at 144; `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` must stay 52/0 (confirmed green before the change).
   - Prove supported behavior still works: the dynamic-env branch (`index.ts:137-157`) is currently **0% covered** (coverage reports lines 142-155 uncovered) and `FakeVcs` has **no call counter** (`test/fakes/FakeVcs.ts:111-113` only returns the value; no `repoRootCalls` field anywhere in the repo). So acceptance criterion #1 ("one `repoRoot()` lookup per flow invocation") is greenfield — add a `repoRootCalls: string[]` field to `FakeVcs` and a new matching-`dynamicEnvRepos` test that asserts exactly one `repoRoot()` call. Proposed change #3 ("retain existing dynamic-environment behavior tests") is inaccurate: none exist, so they must be written.
- **Removal risk:** Behavior-preserving. No dynamic loading or external/untracked consumers — only three static call sites, two in scope at `index.ts:138/144`; `dynamicEnvRepos`/`dynamicEnvScript` config, persisted state, network, and release/installer surfaces are all untouched. Caveat: caching assumes a stable root between the two calls, which is safe because `git rev-parse --show-toplevel` runs in the fixed process cwd (`git.ts:480`, no `cwd` arg) and nothing mutates git state between lines 138 and 144 (only a `ctx.ui.confirm`). None found.

## Removal process

- [x] **Cache one root only in the dynamic-environment path.** Updated `src/features/merge-request/index.ts` to resolve `ctx.vcs.repoRoot()` once inside the non-empty `dynamicEnvRepos` branch, derive `repoName`, and reuse the cached root for `join`. Confirmed configured script execution writes the expected marker and preserves MR creation, confirmation order, missing-script handling, and process waiting. Independent `src/features/merge-request/reviewers.ts:192` CODEOWNERS lookup remains out of scope.
- [x] **Honor the no-config boundary explicitly.** `dynamicEnvRepos` absent or empty now skips the dynamic-environment lookup and prompt; configured repositories perform one dynamic-environment lookup. `src/features/merge-request/index.test.ts` records the independent reviewer lookup separately and asserts one total root call for no-config flow.
- [x] **Instrument the fake and add greenfield flow coverage.** Added `repoRootCalls` to `test/fakes/FakeVcs`, recording every returned root. Added matching-repository coverage with a temporary executable script, exact script execution marker, cached-root call count, and no-config prompt/call-count coverage.
- [x] **Create temporary removal-proof RED/GREEN coverage.** `bun test src/features/merge-request/index.test.ts` before caching: **RED**, 6 pass / 2 fail (matching flow observed three root calls instead of two; no-config flow observed two instead of one). After caching and the no-config guard: **GREEN**, 8 pass / 0 fail (command exits 1 only because this repository enforces 90% coverage). These call-count and branch assertions defend supported behavior and remain as permanent regression tests; no source-only proof test was retained.
- [x] **Retain existing behavior coverage.** Existing merge-request flow, `GitAdapter.repoRoot()`, `git rev-parse --show-toplevel`, and VCS port-contract tests remain. Final focused command `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts`: 54 pass / 0 fail; coverage gate reported 72.17% functions / 72.07% lines.
- [x] **Run final validation.** `bun run build`: passed. `bun run lint`: passed. `bunx biome check`: passed. Final `bun test`: 447 pass / 0 fail; command exits 1 on the pre-existing 90% coverage gate (85.26% functions / 88.75% lines), not test failures.
- [x] **Smoke the affected merge-request runtime path.** Exact command `bun run src/index.tsx merge-request --context "verify dynamic environment root"` first reached diff generation but stopped at unavailable Ollama. Re-ran exact command with isolated mock `glab`, mock Ollama, temporary configured handoff script, and temporary HOME: accepted MR creation and dynamic-environment prompt; process exited 0 and marker contained `dynamic-env-ran`. Repeated with `dynamicEnvRepos` omitted: process exited 0 after MR creation with no dynamic-environment prompt. No production or repository files were used for smoke fixtures.
- [x] **Close the assessed compatibility caveat.** Caching first observed root is intentional: `GitAdapter.repoRoot()` runs `git rev-parse --show-toplevel` from fixed process cwd without a `cwd` override, and no git-state mutation occurs between the former reads. No schema, loader, README, persisted config, network, release, installer, or reviewer CODEOWNERS changes.
