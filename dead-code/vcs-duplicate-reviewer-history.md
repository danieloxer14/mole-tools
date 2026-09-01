# Reuse reviewer history queries during fallback

## Type
Redundant code

## Scope
- Area: `Git host and VCS adapters`
- Candidate paths: `src/features/merge-request/reviewers.ts`, related reviewer-flow tests and `GitAdapter` history methods
- Symbols/config/docs: `selectReviewers`, `touchAuthorsForFiles`, `recentAuthors`, `buildFallbackReviewerSuggestions`

## Evidence
- `src/features/merge-request/reviewers.ts:211-217` runs `ctx.vcs.touchAuthorsForFiles(files, 200)` and `ctx.vcs.recentAuthors(100)` to rank suggestions.
- When `suggestions.length === 0 && members.length === 0`, the fallback at `src/features/merge-request/reviewers.ts:219-229` runs both identical VCS queries again, then builds fallback suggestions from their results.
- The first query results are not otherwise mutated; caching those arrays and passing them to `buildFallbackReviewerSuggestions` preserves the same ranking and fallback inputs while removing two redundant git-log subprocesses. `GitAdapter.touchAuthorsForFiles` and `recentAuthors` execute real history commands (`src/adapters/vcs/git.ts:417-476`).
- Targeted verification: `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` passed 52 tests. Existing `FakeVcs` returns empty history, so current tests do not expose duplicate query counts.

## Why this is safe to change
The fallback condition is reached only after the initial ranking query has already completed, and both calls use identical arguments. The fallback needs same history data already fetched; no observable ordering, filtering, or error behavior changes when arrays are retained and reused. The change is local to reviewer selection and does not alter the VCS port.

## Proposed change
1. Store touch-author and recent-author results before calling `rankReviewerSuggestions`.
2. Reuse those stored arrays in the fallback instead of invoking both VCS methods again.
3. Add focused reviewer-flow coverage with a counting VCS fake proving each history query runs once while fallback suggestions remain unchanged.

## Acceptance criteria
- [ ] A fallback reviewer selection performs at most one `touchAuthorsForFiles(files, 200)` and one `recentAuthors(100)` query.
- [ ] CODEOWNERS ranking and git-history fallback return the same reviewer candidates and preserve current host-handle resolution.
- [ ] Focused tests verify both result equivalence and query counts.
- [ ] Existing VCS and merge-request tests pass.

## Risks and open questions
- If future ranking logic mutates returned arrays, copy or document ownership before reuse; current ranking helpers only read them.
- VCS query failures currently propagate from the first query; reuse must not change that error boundary.

## Assessment

- **Validated:** 2026-08-27 — `valid`
  - Re-checked `reviewers.ts:214-215` (first `touchAuthorsForFiles(files,200)`+`recentAuthors(100)` into `rankReviewerSuggestions`) against the fallback at `:221-224` (byte-identical pair into `buildFallbackReviewerSuggestions`, gated by `suggestions.length===0 && members.length===0`); both `GitAdapter` methods run real git (`git.ts:417-462` `log --name-only`, `:464-477` `log --format=%an`); `rankReviewerSuggestions` (`:138-179`) is read-only over its inputs (builds fresh `available`/`picked`/return array), so caching the first results is behavior-preserving; `selectReviewers` is the sole production caller (grep `src`: `git.ts` def, `git.test.ts` test, `reviewers.ts:214/215/222/223`); `FakeVcs.touchAuthorsForFiles`/`recentAuthors` (`test/fakes/FakeVcs.ts:103-109`) return `[]` always, so the duplicate query count is unobservable and the count assertion is greenfield; `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` → 52 pass / 0 fail.
- **Product impact:** `code` — **Priority P1**
  - Runtime dedup on the user-facing merge-request reviewer-selection path (`merge-request/index.ts:106` → `selectReviewers`); redundant git-subprocess pair on the no-CODEOWNERS fallback branch; same surface as the sibling `vcs-duplicate-*` tickets (P1).
- **Verification:**
  - (a) Prove removal safe: the two query pairs at `:214-215` and `:221-224` share identical args `(files, 200)` / `(100)`; `rankReviewerSuggestions` (`:138-179`) never mutates the arrays, so caching the first results and passing them to `buildFallbackReviewerSuggestions` preserves ranking + fallback inputs; baseline `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts` → 52/0 confirms no existing count assertion would break.
  - (b) Prove supported behavior: add a counting fake (extend `test/fakes/FakeVcs.ts` with `touchAuthorCalls`/`recentAuthorCalls` counters) plus a focused reviewer-flow test that drives the `members.length===0` fallback and asserts each of `touchAuthorsForFiles(files,200)` and `recentAuthors(100)` is invoked exactly once while fallback candidates are unchanged; re-run the same targeted suite → green.
- **Removal risk:** `None found` after checking dynamic loading (none — fixed `Vcs` port methods at `ports/vcs.ts:54/58`, static `ctx.vcs.` calls, no string dispatch), external/untracked consumers (none — sole caller `selectReviewers`, private pkg, no `exports` map / barrel), and CLI/config/persisted-state/network/API/release/installer (untouched — local in-memory array reuse). Error boundary preserved: the first pair (`:214-215`) is awaited before the fallback, so a throw aborts `selectReviewers` before `:220`; the fallback runs only after a successful first query. Watch item only: if future ranking logic mutates the returned arrays, copy/own inputs first (ticket open-risk #1).

## Removal process

- [x] **Cache the first history results.** Updated `src/features/merge-request/reviewers.ts` to await `ctx.vcs.touchAuthorsForFiles(files, 200)` and `ctx.vcs.recentAuthors(100)` once before `rankReviewerSuggestions`, then pass those same arrays to `buildFallbackReviewerSuggestions`; removed only duplicate fallback calls. `src/ports/vcs.ts`, `GitAdapter`, and public method signatures unchanged.
- [x] **Preserve query/error ordering and fallback inputs.** Kept touch-author await before recent-author await, so the first query failure still propagates before fallback logic. Kept `rankReviewerSuggestions` read-only inputs, fallback sorting/limit/current-user exclusion, `resolveHandle` for every candidate, and `Set` de-duplication unchanged.
- [x] **Make FakeVcs observable and configurable.** Added `touchAuthors`/`recentAuthors` fixture options and `touchAuthorCalls`/`recentAuthorCalls` records to `test/fakes/FakeVcs.ts`; defaults remain empty arrays and the `Vcs` contract is unchanged.
- [x] **Add focused fallback-flow coverage.** Added `src/features/merge-request/reviewers.test.ts` coverage with no CODEOWNERS directory, non-empty history, exact `(files, 200)`/`(100)` call arguments, unchanged fallback ordering, and GitLab handle resolution to selected `alice`/`bob` handles.
- [x] **Create temporary removal-proof RED/GREEN coverage.** Before caching, `bun test src/features/merge-request/reviewers.test.ts` was **RED**: 6 pass / 1 fail because each history call was observed twice. After caching, same command was **GREEN**: 7 pass / 0 fail; exit code remains 1 only because focused coverage is below enforced 90% (32.64% funcs / 40.15% lines). Count and result-equivalence assertions remain as permanent regression coverage.
- [x] **Retain VCS and merge-request behavior coverage.** Final `bun test src/adapters/vcs src/features/merge-request src/port-contracts/vcs-worktree-create.test.ts`: 55 pass / 0 fail; exit code 1 from 90% coverage gate (73.54% funcs / 73.01% lines). Existing pure ranking/fallback tests and GitAdapter history parsing remain.
- [x] **Run final validation.** `bun run build`: passed. `bun run lint`: passed. `bunx biome check`: passed. Final `bun test`: 448 pass / 0 fail; exit code 1 from existing 90% coverage gate (85.56% funcs / 88.92% lines). Source inspection confirms only one touch-author call and one recent-author call remain in `reviewers.ts`.
- [x] **Smoke the affected reviewer-selection runtime path.** Exact `bun run src/index.tsx merge-request --context "verify reviewer history reuse"` reached diff collection but stopped before reviewer selection because Ollama was unavailable at `http://localhost:11434`. Direct `selectReviewers` fallback-flow test exercises candidate selection and handle resolution; live GitLab MR smoke remains unavailable without Ollama/host access.
- [x] **Close ticket-specific risks.** LSP found `selectReviewers` declaration plus its import/call as the only production path; repository search found no dynamic dispatch or external export consumer. `Vcs` methods remain static port calls, and no CLI/config/persisted-state/network/API/release/installer surface changed. Shared arrays are borrowed read-only inputs; future mutating ranking logic must copy them first.
