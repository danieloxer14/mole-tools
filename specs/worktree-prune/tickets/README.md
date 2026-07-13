# Tickets for worktree-prune

**Source spec:** `specs/worktree-prune/`
**Generated:** 2026-07-13
**Output format:** local files

## Ticket list (dependency order)

| # | Title | Blocked by | Purpose |
|---|-------|------------|---------|
| 01 | Reconcile the worktree VCS contract | None | Expose typed, fakeable Git worktree operations. |
| 02 | Add base-directory configuration and command entry | None | Resolve and persist the scan directory safely. |
| 03 | Discover and normally prune selected worktrees | 01 | Let users select extra worktrees and remove them normally. |
| 04 | Handle failed removal with optional loss summary | 03 | Offer safe, per-worktree force removal after failures. |

## Cross-ticket risks

- `GitAdapter` already has worktree methods and adapter tests, but `src/ports/vcs.ts` and `test/fakes/FakeVcs.ts` do not yet expose the matching contract; ticket 01 reconciles this partial implementation.
- Ticket 02 must persist only a prompted directory. A `--baseDir` value is a session override and must not change `config.json`.
- Discovery must never offer the primary worktree, must deduplicate repository roots, and needs deterministic ordering for testable prompts.
- The full `bun test` suite currently has an unrelated failure because `src/features/ralph/validator.test.ts` imports a missing `./validator` module. Worktree-prune tickets should run focused tests and report this baseline failure separately.
