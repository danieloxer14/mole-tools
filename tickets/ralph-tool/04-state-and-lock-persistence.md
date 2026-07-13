# 04 — State & lock persistence layer

## What to build

A file-I/O module that reads and writes the three Ralph artifacts—`.ralph/<name>.md`, `.ralph/<name>.state.json`, and `.ralph/<name>.lock`—with atomic rename-on-write, collision detection, PID-based locking with stale-lock reclamation, and snapshot restoration for failed workers. Loop state includes the selected provider/model. This is the durable storage layer that tickets 05, 06, and 07 rely on continuously.

## Blocked by

- **00** — supplies the provider identifier persisted with a Ralph loop
- **01** — needs `RalphStateFile`, `RalphLockFile` types and Zod schemas for validation before persisting
- **02** — shares the prompt directory convention (prompts live adjacent to config; `.ralph/` artifacts are relative to cwd)

## Status

done

## Acceptance criteria

- [x] `ensureRalphDir(): string` creates `.ralph/` in the current working directory if absent, returns its path
- [x] `writeState(name: string, state: RalphStateFile): void` writes `.ralph/<name>.state.json` including persisted provider/model using a temp file + atomic rename (per spec §5, step 6)
- [x] `readState(name: string): RalphStateFile` reads and validates JSON—including persisted provider/model—against the Zod schema from ticket 01; throws `RalphError` on malformed data or mismatched name
- [x] `writeTaskFile(name: string, content: string): void` writes `.ralph/<name>.md` atomically (temp file + rename)
- [x] `readTaskFile(name: string): string | null` reads task file text; returns null if missing
- [x] `snapshotTaskFile(name: string): string` creates a sidecar snapshot (`.ralph/<name>.snap.md`) for later restoration on failure — used by tickets 06 and 07
- [x] `restoreSnapshot(name: string): void` restores from `.snap`, deleting the snapshot afterward
- [x] `createLock(name: string, runId: string): LockHandle` atomically creates `.ralph/<name>.lock` with PID + UUID; throws on live collision; returns an object with a `.release()` method
- [x] A lock whose stored PID is no longer alive (e.g., stale from a crash) is re — `createLock` detects and overwrites it
- [x] Collision check: if `.ralph/<name>.md` or `.ralph/<name>.state.json` already exists, `checkCollision(name)` throws before any provider invocation

## Test approach

**Test type:** unit (filesystem-based, using temp dirs like existing tests)
**Test file/area:** `src/features/ralph/persistence.test.ts`
**Validate with:** `bun test src/features/ralph/persistence.test.ts`

### Red-Green strategy

1. **Red**: Write tests for each operation — provider-aware state read/write round-trip, task file atomic write, lock creation/release/stale-detection, collision detection, snapshot restore
2. **Green**: Implement file functions using `Bun.file.read`, `Bun.file.write`, `node:fs/promises` for rename and access-checks; use `process.pid` and `kill(pid, 0)` for lock liveness
3. **Refactor**: Extract shared temp-file + rename pattern into a helper; ensure cleanup functions exist (per spec §5, step 6: "If persistence fails, clean up artifacts created by this command")

## Implementation notes

- Place in `src/features/ralph/persistence.ts`
- Lock format (JSON): `{ pid: number, runId: string, createdAt: string }` — simple but enough for stale-detection and debugging
- For lock liveness: on POSIX use `process.kill(pid, 0)` throws when PID is dead; on Windows this may always succeed so fall back to `createdAt` age threshold (e.g., >1hr = stale)
- Atomic write pattern: `mktemp` in same directory → write content → `rename()` → catch + cleanup temp on failure
- State JSON must pass Zod validation before being returned from `readState` and after being written by `writeState` — this prevents corrupted state files from silently accumulating bad data
- Import types from `./schema`

## Out of scope

- CLI dispatch or command wiring (that's tickets 05, 08)
- Provider agent execution (tickets 05–07; PiAdapter belongs to ticket 00)
- Prompt loading (ticket 02)

## Open questions

- None
