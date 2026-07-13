# 02 — Durable per-run JSONL log sink

## What to build

Make initialized logger runs durable: create one collision-safe JSONL file under the mole-tools log directory, append safe structured events in order, and expose a deterministic flush/close operation. File-system failures must degrade to a no-op logger rather than changing command behavior.

## Blocked by

01 — Safe structured logger core

## Status

ready-for-agent

## Acceptance criteria

- [ ] Logger initialization creates a per-run JSONL file under `~/.config/mole-tools/logs/` by default.
- [ ] The filename includes an ISO-safe timestamp, PID, and random suffix so simultaneous processes do not share a file.
- [ ] Each emitted event occupies exactly one valid JSON line; events retain call order after flush.
- [ ] Initialization exposes the generated run ID and keeps it consistent across events in the run.
- [ ] Shutdown/flush waits for already accepted writes to settle without throwing to application callers.
- [ ] Directory creation, open/write failure, serialization failure, and flush failure leave the logger usable as a no-op and do not write to stdout or stderr.
- [ ] Tests use a temporary directory or injected writer, never the developer's actual home directory.
- [ ] This ticket adds no feature, adapter, or reviewer-flow logging calls.

## Test approach

**Test type:** Unit/integration against a temporary filesystem directory
**Test file/area:** `src/core/logger.test.ts`
**Validate with:** `bun test src/core/logger.test.ts`

### Red-Green strategy

1. **Red:** Add failing tests that initialize a temporary log directory, emit multiple events, flush, and assert one ordered JSONL file; add injected filesystem/writer failures.
2. **Green:** Add the Bun-backed file sink, collision-safe run file naming, queued append/flush behavior, and no-op fallbacks.
3. **Refactor:** Isolate filesystem concerns behind the logger initialization/sink seam while retaining the core event tests from ticket 01.

## Implementation notes

- The source spec is `specs/logger/logger.md`.
- `src/adapters/config/loader.ts` already defines `defaultConfigPath()` as `~/.config/mole-tools/config.json`; the logger directory is its sibling `logs/` directory.
- Logging is fire-and-forget for callers, but `flush` is required for deterministic shutdown and tests.
- The file sink only receives already-sanitized events from ticket 01.

## Out of scope

- Wiring initialization or flushing into `src/index.tsx`.
- Log viewing, rotation, retention, upload, config flags, or feature instrumentation.

## Open questions

None
