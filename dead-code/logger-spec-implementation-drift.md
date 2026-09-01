# Reconcile logger specifications with implemented lifecycle

## Type
Stale documentation

## Scope
- Area: `Core application composition`
- Candidate paths: `specs/logger/logger.md`, `specs/logger/tickets/01-safe-structured-logger-core.md`, `specs/logger/tickets/02-durable-per-run-jsonl-log-sink.md`, `specs/logger/tickets/03-initialize-logger-for-normal-cli-commands.md`
- Symbols/config/docs: `Context.log`, logger status fields, logger acceptance criteria, CLI initialization and shutdown ownership

## Evidence
- `specs/logger/logger.md:3,9` labels the logger spec `Draft` and says `Context.log` is an unused console-backed logger. Current `src/core/context.ts:20-29` has no `log` property, and repository-wide search found no production `ctx.log` reference.
- `specs/logger/logger.md:119-123` says logger lifecycle wiring is future work, but `src/index.tsx:48-95` initializes logging for normal feature commands before config loading and closes it in `finally`; the help route at `:21-40` bypasses that lifecycle.
- `src/core/logger.ts:139-237` contains the structured singleton, sanitization path, injectable sink, per-run ID, JSONL writer, flush, close, and no-op failure fallback described as future work in the spec.
- `specs/logger/tickets/01-safe-structured-logger-core.md:11-23` remains `ready-for-agent` while `src/core/logger.ts:139-202` provides the logger API, safe event construction, and `MemoryLogSink`.
- `specs/logger/tickets/02-durable-per-run-jsonl-log-sink.md:11-24` remains `ready-for-agent` while `src/core/logger.ts:213-237` creates timestamp/PID/random JSONL paths, queues writes, flushes, closes, and falls back to a no-op sink.
- `specs/logger/tickets/03-initialize-logger-for-normal-cli-commands.md:11-23` remains `ready-for-agent` while `src/index.tsx:48-95` owns the requested normal-command lifecycle and preserves help bypass behavior.
- `bun run src/index.tsx help` produced the help output without config loading or Ink startup. The targeted composition/help/worktree test run passed 32 tests. No logger-specific test file was found, so implementation status and test evidence still need explicit reconciliation rather than blind status changes.

## Why this is safe to change
The candidate artifacts are specifications and planning tickets; they do not participate in runtime imports. Updating their status and current contracts cannot alter logging behavior. The stale `Context.log` statement is contradicted by the live Context interface, while logger lifecycle ownership is directly visible in the composition root. Keep any unverified acceptance criteria marked open instead of claiming tests that do not exist.

## Proposed change
1. Mark completed logger-core, durable-sink, and CLI-lifecycle work as implemented only after mapping each acceptance criterion to current code and adding or linking the missing focused test evidence; otherwise archive the tickets as superseded plans with an explicit verification gap.
2. Update `specs/logger/logger.md` to describe the current singleton and `src/index.tsx` lifecycle, remove the nonexistent `Context.log` premise, and distinguish implemented foundation from future instrumentation.
3. Align ticket acceptance criteria and implementation notes with current APIs, especially the injected sink, returned run ID, no-op failure behavior, and help-route bypass.
4. Preserve the stated out-of-scope boundary around feature/adapter instrumentation unless a separate ticket is created.

## Acceptance criteria
- [ ] Logger spec no longer describes `Context.log` or lifecycle wiring as current/future work when source shows otherwise.
- [ ] Logger tickets no longer remain `ready-for-agent` while describing behavior already present, or are clearly archived as superseded plans.
- [ ] Every claimed logger acceptance criterion has linked focused test evidence; unverified behavior remains explicitly open.
- [ ] Help-route bypass and normal-command initialization/close ordering remain documented accurately.
- [ ] Targeted logger and CLI verification proves supported behavior after documentation reconciliation.

## Risks and open questions
- Current repository has no `src/core/logger.test.ts` in the discovered test paths; determine whether missing focused coverage is a separate implementation ticket or a prerequisite before marking the three plans complete.
- Preserve future instrumentation scope; do not infer that logger documentation drift authorizes adding logging calls to features or adapters.

## Assessment

- **Validated:** 2026-08-26 — `valid`
    - Re-checked every ticket claim. `Context` (`src/core/context.ts:20-29`) has no `log` property, no `ctx.log` repo-wide, and no console-backed `Logger` interface exists anywhere (only the new `LoggerSink` at `src/core/logger.ts:18`); the spec premise at `logger.md:9/102/120` is already false. `logger.md:3` still reads `Draft`; `:119-123` + non-goals `:28,115` + follow-up `:127` still frame the logger as future/out-of-scope, while `src/core/logger.ts:139-237` (singleton debug/info/warn/error, `safeEvent` sanitization, injectable sink via `InitializeLoggerOptions.sink`, per-run `runId`, JSONL writer, `flushLogger`/`closeLogger`, `NoopSink` fallback via `unusable`) + `src/index.tsx:50` (init before config load, `:82-83`) / `:94` (close in `finally`) + help bypass at `:21-40` are live. All three tickets still `ready-for-agent` (`01:13/02:13/03:13`). No `src/core/logger.test.ts`. `bun run src/index.tsx help` / `help commit` exit 0 with no new log file; `bun run src/index.tsx init` creates a fresh JSONL under `~/.config/mole-tools/logs`; targeted run `bun test src/core/context.test.ts src/features/help/format.test.ts src/features/worktree-prune/` → 43 pass / 0 fail (was "32" at discovery; count grew, all green).
    - **New finding — drift is broader than captured.** 12 live `logger.warn(...)` calls already crossed the out-of-scope boundary the spec and all three tickets declare. `src/adapters/git-host/glab.ts:558,570,574,626,648` (5, git-host adapter); `src/features/merge-request/reviewers.ts:60` (1, reviewer selection); `src/features/review/layers.ts:247,256,280,290,402` (5, reviewer flow); `src/features/review/store.ts:211` (1, review state). This violates AC "adds no logger calls to features, adapters, or reviewer selection" (`01:23/02:24/03:23`), spec non-goals (`logger.md:28`, AC `:115`), and the "later feature" framing (`:127`). Proposed change #4 ("preserve out-of-scope boundary") is therefore inapplicable — the boundary is already crossed; the "no instrumentation" ACs are now false and must be marked superseded or moved to a separate instrumentation ticket, not left as "adds no calls."
- **Product impact:** `docs` — **Priority P4**
    - Drift lives entirely in `specs/logger/logger.md` + `specs/logger/tickets/01-03`. No runtime/test import of spec files (`grep -rn "specs/logger\|from .*specs\|import.*\.md" src test` → none); `package.json` build/release + `scripts/` don't reference specs; no CI config (`.github/workflows`, `.gitlab-ci.yml`, `ci/` absent). Editing specs cannot change logging behavior. Nuance: the logger foundation is now load-bearing (12 live call sites + `index.tsx` lifecycle + on-disk JSONL), so the `Draft`/`future-work` framing is a factual-accuracy gap that can mislead a future agent into re-doing instrumentation — but the fix is still a doc edit, hence P4 (deferrable), not P1/P2.
- **Verification:**
    - Safe to edit docs: `grep -rn "specs/logger\|from .*specs\|import.*\.md" src test` → empty; `grep -rn "specs\|logger" scripts` → empty; no CI/build/release consumer of specs; re-run the targeted tests after the edit.
    - Supported behavior after edit: `bun run src/index.tsx help` and `bun run src/index.tsx help commit` → exit 0, no new file in `~/.config/mole-tools/logs`; `bun run src/index.tsx init` → creates a fresh JSONL; `bun test src/core/context.test.ts src/features/help/format.test.ts src/features/worktree-prune/` → 43 pass / 0 fail; `grep -n "logger\.\w+\(" src/**/*.ts` → 12 call sites across `glab.ts` / `reviewers.ts` / `review/layers.ts` / `review/store.ts` unchanged.
- **Removal risk:** `None found` for the doc edit itself (specs not imported by runtime/CI/build/release; targeted tests green). Caveat on the reconciliation, not code removal: the logger is load-bearing (12 live `logger.warn` sites + `src/index.tsx:50/94` lifecycle + on-disk JSONL) — do NOT remove logger code as part of this ticket; act only on `specs/logger/**`. The "no instrumentation" ACs (`01:23/02:24/03:23`) are already violated by live code, so marking them done would be wrong — open a separate instrumentation ticket or mark them superseded. Persisted output path `~/.config/mole-tools/logs` is a runtime artifact unaffected by doc edits; no config field, CLI flag, network shape, or installer path is touched.

## Removal process

- [x] Add temporary `test/dead-code/logger-spec-implementation-drift.test.ts` asserting stale logger premises/statuses are absent while focused-test and instrumentation gaps remain; `bun test test/dead-code/logger-spec-implementation-drift.test.ts` was RED before edits (1 failing test) and GREEN after edits (1 pass, 11 expectations). Deleted after GREEN.
- [x] Update `specs/logger/logger.md` to describe the implemented structured singleton, sanitization, injected sink, run ID, JSONL writer, flush/close, no-op fallback, normal-command lifecycle, and help-route bypass.
- [x] Reconcile `specs/logger/tickets/01-safe-structured-logger-core.md`, `02-durable-per-run-jsonl-log-sink.md`, and `03-initialize-logger-for-normal-cli-commands.md`: each now says implementation exists in source, leaves focused logger test coverage open, and records the pre-existing instrumentation boundary without claiming violated criteria are complete. Updated generated `specs/logger/tickets/README.md` to remove its stale context-logger statement.
- [x] Preserve the instrumentation boundary: no production source or logger calls changed. Final search confirms 12 existing `logger.warn(...)` call sites in `glab.ts` (5), `reviewers.ts` (1), `review/layers.ts` (5), and `review/store.ts` (1).
- [x] Retained behavior baseline and final focused tests: `bun test src/core/context.test.ts src/features/help/format.test.ts src/features/worktree-prune/` — 43 pass, 0 fail.
- [x] Baseline and final project gates: `bun run build` and `bun run lint` passed; final `bun test` passed 441 tests / 0 failures. One initial final full-test run had an unrelated flaky `review routes > cancels one chat without stopping another` failure (440/1); immediate rerun passed 441/0.
- [x] Surface smoke: isolated `HOME` `bun run src/index.tsx help` and `bun run src/index.tsx help commit` exited 0 and created no JSONL; isolated `HOME` `bun run src/index.tsx init` wrote config and created exactly one JSONL log file.
- [x] Final stale-claim scan found no `Context.log`, `console-backed`, `ready-for-agent`, Draft-status, or future-lifecycle claims under `specs/logger`. Specs have no production/runtime, build, release, installer, config, or CI consumer; the temporary proof reader was deleted.
- [x] Execution: 2026-08-28 — committed `03113e6` — reconciled logger spec/ticket status with implemented source, preserved focused-test and instrumentation-boundary gaps, and changed no runtime code.
