# Tickets for Explicit Model Routing

**Source spec:** `../explicit-model-routing.md`
**Generated:** 2026-07-13
**Output format:** local files

## Ticket list

| # | Title | Blocked by | Purpose |
|---|---|---|---|
| 01 | Strict explicit model routing for commit and merge requests | None | Replace legacy model routing with validated explicit feature routes. |

## Cross-ticket risks

- The config schema, loader, and context router must migrate together so invalid routes fail consistently at load time.
- The active worktree has uncommitted README/ADR/spec changes; ticket 01 should verify the final documentation rather than overwrite unrelated work.
