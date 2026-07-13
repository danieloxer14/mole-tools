# 03 — Discover and normally prune selected worktrees

## What to build

Given a base directory, find Git repositories beneath it, present only each repository's extra worktrees in stable repository-by-repository multi-select prompts, and normally remove every selected worktree. A failed removal must not stop later selected removals.

## Blocked by

01 — Reconcile the worktree VCS contract

## Status

ready-for-agent

## Acceptance criteria

- [ ] Discovery recursively finds Git repository directories under a supplied base directory, normalizes/deduplicates repository roots, and returns deterministic repository and worktree ordering.
- [ ] The primary checkout is never offered; repositories with no extra worktrees create no selection prompt.
- [ ] Each repository with extra worktrees receives its own `UiPort.multiSelect` prompt whose choices identify the worktree path and branch/ref when available.
- [ ] A selected worktree is removed with normal `git worktree remove` without an additional confirmation.
- [ ] When one normal removal fails, remaining selected worktrees are still attempted and the failure is retained for the later fallback flow.
- [ ] No repositories, or no extra worktrees, produces a clear clean exit with no deletion calls.

## Test approach

**Test type:** unit-style feature tests plus temporary-directory discovery tests
**Test file/area:** new `src/features/worktree-prune/discovery.test.ts` and `src/features/worktree-prune/index.test.ts`; `test/fakes/FakeVcs.ts`
**Validate with:** `bun test src/features/worktree-prune/discovery.test.ts src/features/worktree-prune/index.test.ts`

### Red-Green strategy

1. **Red**: Test empty discovery, duplicate/nested repository candidates, primary-worktree exclusion, per-repository selection transcripts, and continued deletion after a failure.
2. **Green**: Implement a small discovery module and feature orchestration that consumes the VCS contract from ticket 01 and records per-worktree removal results.
3. **Refactor**: Keep filesystem traversal, worktree grouping, prompt choice construction, and deletion-result handling separately testable.

## Implementation notes

- The spec requires scanning directories containing `.git`, normalizing roots with Git, and grouping by parent repository.
- `UiPort.multiSelect()` and `FakeUiPort` already support typed choices and scripted selections; the Ink host renders one prompt at a time, which suits repo-by-repo selection.
- `GitAdapter.worktrees(repoRoot)` is the source of extra worktree records after ticket 01; do not parse porcelain in the feature.
- This slice accepts a resolved base directory as input so ticket 02 can connect command/config resolution without making normal pruning depend on it.

## Out of scope

- Persisting or resolving the base directory at the CLI boundary.
- Force removal, change summaries, and force-delete confirmation.

## Open questions

None.
