# Tickets for Explicit Per-Phase Model Routing

**Source spec:** `specs/explicit-model-routing.md`
**Generated:** 2026-07-13
**Output format:** local files

## Ticket list (dependency order)

| # | Title | Blocked by | Purpose |
|---|---|---|---|
| 01 | Strict explicit model routing for commit and merge requests | None | Replace legacy model routing with validated explicit feature routes. |
| 02 | Persist and execute Ralph phase models | 01 | Make Ralph phase selections durable and use them in init, worker, and reflection calls. |
| 03 | Customize Ralph phase model names during init | 02 | Let init collect three prefilled model names while retaining configured providers. |

## Cross-ticket risks

- `RalphStateFileSchema`, init, and run must migrate together in ticket 02 because removing flat state fields otherwise breaks all existing references.
- The source spec’s companion link to `architecture/code-design.md` is stale; the verified design contract is `specs/architecture/code-design.md`.
- The active worktree has uncommitted README/ADR/spec changes; ticket 01 should verify the final documentation rather than overwrite unrelated work.
