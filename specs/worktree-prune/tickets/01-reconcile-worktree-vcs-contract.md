# 01 — Reconcile the worktree VCS contract

## What to build

Make Git worktree operations available through the application's typed `Vcs` boundary so features can list only extra worktrees, attempt normal or forced removal, and collect a change snapshot without invoking Git directly.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] `Vcs` defines the worktree record and operations needed to list extra worktrees, remove normally, force-remove, and collect `status --short` plus `diff --stat` for a worktree.
- [ ] `GitAdapter` implements that contract and returns no selectable primary worktree when parsing `git worktree list --porcelain` for a repository root.
- [ ] Normal and forced removal surface Git failures as `PortError`; the change snapshot remains usable independently of later LLM summarization.
- [ ] `FakeVcs` implements the expanded contract so feature tests compile without real Git.

## Test approach

**Test type:** unit adapter tests
**Test file/area:** `src/adapters/vcs/git.test.ts`; `test/fakes/FakeVcs.ts`
**Validate with:** `bun test src/adapters/vcs/git.test.ts`

### Red-Green strategy

1. **Red**: Add type-checked fake and adapter tests covering porcelain filtering, removal success/failure, and status/diff snapshots through the public VCS contract.
2. **Green**: Align `src/ports/vcs.ts`, `GitAdapter`, and `FakeVcs` with the smallest shared worktree API.
3. **Refactor**: Keep porcelain parsing private to `GitAdapter` and retain a single worktree record shape.

## Implementation notes

- `src/adapters/vcs/git.ts` already contains `worktrees`, `removeWorktree`, `forceRemoveWorktree`, and `showWorktreeStatus` plus focused adapter tests; reconcile these with `src/ports/vcs.ts` rather than duplicating Git execution in the feature.
- `GitAdapter` uses `git worktree list --porcelain` and receives a repository root, which is the seam for excluding the primary checkout by path.
- Preserve the existing `CostTracker` behavior for Git adapter commands.

## Out of scope

- Filesystem repository scanning and command registration.
- User prompts, selection, or deletion orchestration.
- Ollama summaries.

## Open questions

None.
