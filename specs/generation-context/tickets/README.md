# Tickets for user-supplied generation context
**Status:** Implemented — tickets record shipped behavior; no implementation work remains.

**Source spec:** `specs/generation-context/generation-context.md`
**Generated:** 2026-07-14
**Output format:** local files

## Ticket list (dependency order)

| # | Title | Blocked by | Purpose |
|---|---|---|---|
| 01 | Commit: add user-supplied generation context | None | Delivered validated, documented commit guidance and the reusable context-aware commit flow. |
| 02 | Merge request: propagate user-supplied generation context | 01 | Delivered documented MR guidance and inheritance into staged-change commit generation. |

## Cross-ticket risks

- The CLI derives options and help from each feature's Zod schema; both tickets must retain matching validation and metadata.
- Ticket 02 depends on ticket 01's optional `runCommitFlow` context seam to avoid duplicate commit-generation logic.
- The project uses Bun tests and Biome; each ticket should keep `bun test`, `bun run lint`, and `bun run build` green.

The dependency and risk notes above are historical implementation context.
