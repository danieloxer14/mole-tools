# Tickets for commit `--auto` mode
**Status:** Implemented — ticket records shipped behavior; no implementation work remains.

**Source spec:** `specs/commit-auto/commit-auto.md`
**Generated:** 2026-07-14
**Output format:** local files

## Ticket list (dependency order)

| # | Title | Blocked by | Purpose |
|---|-------|------------|---------|
| 01 | Bare `--auto` commit flow | None | Delivered valueless, strictly non-interactive local commit path with no push. |

## Cross-ticket risks

- Bare boolean support changes generic Zod-to-CAC and Zod-to-help introspection;
  retain current value-bearing option behavior.
- The current commit feature has no dedicated test file. Reuse the repository's
  fakes to establish the auto-mode no-input contract before changing behavior.
- `runCommitFlow` is shared with merge-request; preserve its `askToPush: false`
  behavior while adding auto mode.

The risk notes and dependency record above are historical implementation context.
