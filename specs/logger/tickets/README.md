# Tickets for file logger

**Source spec:** `specs/logger/logger.md`
**Generated:** 2026-07-13
**Output format:** local files

## Ticket list (dependency order)

| # | Title | Blocked by | Purpose |
|---|---|---|---|
| 01 | Safe structured logger core | None | Provide an in-memory, testable singleton API with safe event serialization. |
| 02 | Durable per-run JSONL log sink | 01 | Persist logger events safely to isolated files and flush at shutdown. |
| 03 | Initialize logger for normal CLI commands | 02 | Create and close one logger run around normal commands while preserving help behavior. |

## Cross-ticket risks

- `src/index.tsx` has top-level CLI registration and parsing, so CLI lifecycle testing may require extracting a testable runner/registration seam without changing command behavior.
- Logger writes must never leak secrets or replace the primary command error; sink failure remains best-effort.
- Do not instrument features or adapters in this ticket set. The existing console-backed `Context.log` is not part of this migration.
