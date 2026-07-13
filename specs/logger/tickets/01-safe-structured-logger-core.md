# 01 — Safe structured logger core

## What to build

Provide the process-wide logger API that future mole-tools workflows can import directly and use for sparse, structured diagnostics. The API accepts a stable event name and optional diagnostic data, writes to an injectable in-memory sink for now, and never throws because supplied data cannot be serialized.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] `src/core/logger.ts` exports the singleton logger with `debug`, `info`, `warn`, and `error` methods accepting an event name and optional structured data.
- [ ] Events contain an ISO UTC timestamp, level, event name, run ID, PID, and optional sanitized data.
- [ ] Test setup can initialize/reset the singleton with an in-memory sink without using the real user configuration directory.
- [ ] Nested secret-bearing keys, including `apiKey`, `token`, `authorization`, `cookie`, `password`, and `secret`, are redacted case-insensitively.
- [ ] `Error` values, circular references, unsupported values, deep objects, large collections, and long strings are represented safely and visibly truncated where bounded.
- [ ] Serializing or writing an event failure does not throw to the caller.
- [ ] This ticket adds no logger calls to features, adapters, or reviewer selection.

## Test approach

**Test type:** Unit
**Test file/area:** `src/core/logger.test.ts`
**Validate with:** `bun test src/core/logger.test.ts`

### Red-Green strategy

1. **Red:** Add failing tests for event shape and levels, nested redaction, errors/cycles, explicit truncation markers, singleton reset, and a throwing test sink.
2. **Green:** Implement the event model, safe data representation, injectable sink, and no-throw logger methods in `src/core/logger.ts`.
3. **Refactor:** Consolidate recursive sanitization and event construction while all logger tests remain green.

## Implementation notes

- The source spec is `specs/logger/logger.md`.
- Use structured event names rather than rendered debug strings.
- The logger is a direct import, not a new `Context` dependency. `src/core/context.ts` currently has a separate console-backed `Logger` interface/property; leave it unchanged in this ticket.
- Bun is the runtime and `bun:test` is the test runner.
- Define bounded safe representation in the logger core so all later sinks receive only sanitized data.

## Out of scope

- Filesystem persistence and CLI lifecycle wiring.
- Feature or adapter instrumentation.
- Replacing `Context.log`.

## Open questions

None
