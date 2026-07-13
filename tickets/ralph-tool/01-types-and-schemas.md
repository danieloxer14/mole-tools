# 01 — Ralph type definitions & schemas

## What to build

Core TypeScript interfaces and Zod validation schemas for the three Ralph artifact types: task files, state files, and lock files. These types are used by every subsequent Ralph module and make structurally-invalid artifacts fail fast with clear error messages.

## Blocked by

None — can start immediately.

## Status

done

## Acceptance criteria

- [x] `RalphTaskFile` interface defines the parsed structure of a task Markdown file (goal, deliverable, checklist items as array, headings present)
- [x] `RalphStateFile` interface matches the spec's JSON schema at §6.2 including persisted `provider` and `model`, plus all runtime fields from §6.3 (`active`, `status`, `phase`, `workerRunId`, `workerItem`, `lastError`, etc.)
- [x] `RalphLockFile` interface defines PID, run metadata (timestamp, optional) shape
- [x] Zod schemas validate each type: parse succeeds on conformant data, throws descriptive errors on invalid data
- [x] `LoopName` type enforces kebab-case regex: `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- [x] Status enum (`ready`, `in_progress`, `paused`, `completed`) and phase enum (`ready`, `implementing`, `reflecting`, `paused`, `completed`) are exported as typed constants
- [x] `PauseReason` enum at minimum covers `max_iterations_reached`, `reflection_failed`, `interrupted`

## Test approach

**Test type:** unit
**Test file/area:** `src/features/ralph/schema.test.ts`
**Validate with:** `bun test src/features/ralph/schema.test.ts`

### Red-Green strategy

1. **Red**: Write tests asserting Zod schemas reject invalid data (bad loop name, missing required state fields, incomplete task structure) and accept valid examples matching the spec shapes
2. **Green**: Define interfaces in `src/features/ralph/schema.ts` with Zod schemas matching each requirement
3. **Refactor**: N/A — implementation is the schema definitions

## Implementation notes

- Place types in `src/features/ralph/schema.ts` alongside the new Ralph feature
- Follow existing patterns: `src/adapters/config/schema.ts` for Zod object schemas, `src/core/errors.ts` for custom error classes
- Export a `RalphError` (subclass of `AbortError` or `PortError`) for validation failures — used by later tickets
- Keep the module pure — no I/O; only type definitions and parsing functions exported from `src/features/ralph`

## Out of scope

- File I/O (paths, reads, writes) — that's ticket 04
- Prompt loading — that's ticket 02
- CLI argument parsing beyond type shapes

## Open questions

- None
