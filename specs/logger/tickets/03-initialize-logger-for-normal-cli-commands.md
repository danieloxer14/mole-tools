# 03 — Initialize logger for normal CLI commands

## What to build

Give every normal mole-tools feature command one durable logger run from before configuration loading until after feature completion/error handling. Preserve the special plain help route: help must continue to produce no log file and no Ink/config side effects.

## Blocked by

02 — Durable per-run JSONL log sink

## Status

ready-for-agent

## Acceptance criteria

- [ ] A normal feature-command invocation initializes one logger run before `loadConfig()` is called.
- [ ] The logger is flushed/closed on successful completion and every thrown/error-handled completion path.
- [ ] Configuration loading failures are eligible for logger events because initialization precedes config loading.
- [ ] `mole-tools help` and `mole-tools help <command>` do not initialize a logger, create a log file, load config, or mount Ink.
- [ ] Existing CLI stdout, stderr, Ink output, feature result handling, and exit-code behavior are unchanged by logger lifecycle wiring.
- [ ] CLI lifecycle tests run against an isolated HOME/log directory and assert normal-command versus help behavior.
- [ ] This ticket introduces lifecycle events only if needed to diagnose logger startup/shutdown; it adds no reviewer, feature, or adapter diagnostic snapshots.

## Test approach

**Test type:** CLI integration plus focused unit tests
**Test file/area:** New or extracted testable CLI runner test adjacent to `src/index.tsx`; retain core tests in `src/core/logger.test.ts`
**Validate with:** `bun test src/core/logger.test.ts <new-cli-test-file>` and `bun test`

### Red-Green strategy

1. **Red:** Add an isolated CLI test proving a normal command creates one log file and a help command creates none, while preserving expected output/exit status.
2. **Green:** Wire logger initialization before the normal feature-command config path and flush it in a `finally`; extract a minimal test seam from `src/index.tsx` only if needed to exercise routing without changing behavior.
3. **Refactor:** Keep help's intentional bypass obvious and keep lifecycle ownership at the CLI composition root.

## Implementation notes

- The source spec is `specs/logger/logger.md`.
- `src/index.tsx` currently registers and parses `cac` commands at module evaluation. It special-cases help before `loadConfig`, `buildContext`, and `runInInk`; preserve that order.
- `src/app.tsx` owns Ink mounting, while `src/core/errors.ts` maps feature errors to UI output. Logger failures must not interfere with either.
- `src/adapters/config/loader.ts` may still print its existing first-run config-template message; this ticket must not redirect it through the logger.

## Out of scope

- Adding inline logger calls to `selectReviewers`, other features, or adapters.
- Migrating/removing `Context.log`.
- New user-facing logging configuration or output.

## Open questions

None
