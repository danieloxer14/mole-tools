# mole-tools — File Logger Spec

**Status:** Implemented foundation; focused logger test coverage remains open
**Date:** 2026-07-13
**Scope:** Logger infrastructure is implemented. Existing feature and adapter instrumentation is documented as a separate boundary.

## 1. Problem

`mole-tools` now has a process-wide structured logger for durable internal diagnostics. Existing logger calls use the singleton directly; console and Ink output remain user-facing contracts and are not replaced by log output.

## 2. Goals

- Provide one process-wide logger for each non-help CLI invocation.
- Persist structured JSON Lines (`.jsonl`) diagnostics to a file under the user's mole-tools configuration directory.
- Enable file logging for every normal command without a flag or config setting.
- Expose a small inline API for intentional instrumentation:
  - `logger.debug(event, data?)`
  - `logger.info(event, data?)`
  - `logger.warn(event, data?)`
  - `logger.error(event, data?)`
- Make local-state and external-response snapshots possible through structured `data`, without spans, decorators, proxies, or automatic function tracing.
- Centralize recursive secret redaction, circular-value handling, and output-size limits.
- Never let logging failures affect a feature's result, error handling, UI output, or exit code.
- Make the singleton replaceable with an in-memory sink in tests.

## 3. Non-goals

- No new feature, adapter, or reviewer-flow instrumentation as part of this logger foundation; existing calls are documented as an instrumentation boundary.
- No migration of a context logger; the current `Context` interface has no logger property or production logging consumer.
- No logger output in Ink, stdout, or stderr.
- No command-line logging flags, configuration schema changes, log viewer, retention scheduler, upload, telemetry, or remote service.
- No spans, correlation trees, `AsyncLocalStorage`, method decorators, proxies, or source transforms.
- No guarantee that arbitrary runtime objects are reproduced losslessly; logged data is a safe diagnostic representation.

## 4. User-visible behavior

### 4.1 Log location and lifecycle

Every command that follows the normal feature execution path creates one log file in:

```text
~/.config/mole-tools/logs/
```

The filename includes an ISO-safe start timestamp, process ID, and random suffix, so concurrent processes never append to the same file. The logger is initialized before configuration loading, enabling diagnostics for config/bootstrap failures. It is flushed and closed before the command completes.

The special `mole-tools help` path remains plain stdout/stderr only: it does not initialize the logger or create a log file.

### 4.2 Event format

Each line is one JSON object. Every event includes:

```ts
{
  timestamp: string; // ISO-8601 UTC
  level: "debug" | "info" | "warn" | "error";
  event: string;
  runId: string;
  pid: number;
  data?: unknown;
}
```

`event` is a stable dotted identifier such as `reviewers.members-resolved` or `glab.resolve-handle.response`; it is not a rendered sentence. `data` contains structured diagnostic state.

Example:

```json
{"timestamp":"2026-07-13T16:00:00.000Z","level":"debug","event":"reviewers.members-resolved","runId":"…","pid":1234,"data":{"members":[{"id":"42","handle":"alex"}]}}
```

### 4.3 Safe value representation

Before data reaches disk, the logger must:

- recursively redact values whose keys are case-insensitive matches for secret-bearing names, including `apiKey`, `token`, `authorization`, `cookie`, `password`, and `secret`;
- render `Error` instances with name, message, stack, and recursively safe `cause`;
- tolerate circular references and unsupported values without throwing;
- bound nesting, collection size, individual string size, and total event size;
- replace omitted/truncated content with an explicit marker so the reader can distinguish it from absent application data.

This policy applies equally to manual snapshots and future raw HTTP/subprocess response logging. It must preserve useful API bodies and command output within the documented bounds while preventing credentials and unbounded output from being written.

### 4.4 Failure handling

If the log directory cannot be created, a file cannot be written, serialization fails, or flush fails, the logger becomes a no-op for that operation. It must not throw, print, alter an existing error, or change the process exit code.

## 5. API and ownership

`src/core/logger.ts` is the sole owner of event types, data sanitization, file sink lifecycle, and singleton access. This foundation is implemented.

Normal application code imports the singleton directly:

```ts
import { logger } from "../../core/logger";

logger.debug("reviewers.handles-parsed", { handles });
```

Initialization is owned by `src/index.tsx`, around the normal feature-command execution path. The initialization/reset seam accepts an in-memory sink; tests must not depend on the developer's home directory.

The current `Context` interface has no logger property. Existing instrumentation imports the new singleton directly rather than coupling logging to context.

### 5.1 Current implementation status

`src/core/logger.ts` implements the structured singleton, recursive sanitization, injectable sink, per-run ID, JSONL writer, flush/close lifecycle, and no-op failure fallback. `src/index.tsx` initializes logging before normal-command config loading and closes it in `finally`; the help route bypasses config, Ink, and logger initialization.

Focused logger test coverage remains open: no `src/core/logger.test.ts` exists yet, so event-shape, sanitization, sink-failure, and lifecycle criteria requiring focused assertions remain unverified. Existing logger calls already cross the instrumentation boundary in `src/adapters/git-host/glab.ts`, `src/features/merge-request/reviewers.ts`, `src/features/review/layers.ts`, and `src/features/review/store.ts`; this ticket does not change them.

## 6. Acceptance criteria

- [ ] A normal feature command creates exactly one JSONL file in `~/.config/mole-tools/logs`.
- [ ] `mole-tools help` creates no log file and retains its current stdout/stderr behavior.
- [ ] A logger event is a single valid JSON line containing timestamp, level, event, run ID, PID, and optional safe data.
- [ ] `debug`, `info`, `warn`, and `error` preserve their supplied level and event name.
- [ ] Objects, arrays, `Error` values, circular data, and unsupported values can be logged without a thrown serialization error.
- [ ] Configured secret-bearing keys are redacted at every nesting level.
- [ ] Oversized/deep data is bounded and visibly marked as truncated.
- [ ] Sink initialization, write, serialization, and flush failures do not change feature execution, CLI output, or process exit behavior.
- [ ] Tests can replace/reset the singleton and assert events without writing to the real user log directory.
- [ ] This work adds no logger calls to `selectReviewers`, adapters, or other product flows.

## 7. Implementation constraints and seams

- `src/index.tsx` owns CLI routing. Its `help` command intentionally bypasses config loading and Ink; preserve that special path.
- The current `Context` interface has no logger property; do not couple the singleton to context.
- Bun is the project runtime; use Bun-supported file APIs and validate with `bun test`.
- Existing tests use `bun:test`, with fakes under `test/fakes/` and colocated adapter/feature tests. Logger infrastructure tests should be colocated with `src/core/logger.ts`.
- Logging must be fire-and-forget for callers, but application shutdown needs a deterministic flush seam.

## 8. Follow-up work

A later feature can add sparse inline `logger.debug` events to workflows such as `selectReviewers` and to adapters where raw API/subprocess responses are available. Existing logger calls are already present in those areas; future work must choose event names and data fields case by case without treating this foundation ticket as authorization to change instrumentation.
