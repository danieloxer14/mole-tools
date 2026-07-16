# Ralph iteration handoff summary

**Status:** Draft
**Date:** 2026-07-14

## 1. Problem

Each Ralph worker starts from the task file and current repository, but loses the
previous worker's concise account of completed work, verification, blockers, and
next focus. Add durable handoff context between worker iterations.

## 2. Terminology

A **Ralph iteration** is one worker attempt and keeps the existing iteration
counter semantics. Reflections are separate sessions and do not produce or
replace iteration handoff summaries.

An **iteration handoff summary** is advisory quick-reference context. The task
file, repository, and verification evidence remain authoritative.

## 3. Durable state

Add this required field to `.ralph/<name>.state.json`:

```json
{
  "iterationSummary": ""
}
```

- `ralph init` stores an empty string.
- After each successful worker attempt, store that worker's parsed summary.
- Store only the latest summary; do not retain summary history.
- Persist the field across pauses, process exits, and resumed runs.
- Do not impose a schema maximum length.

## 4. Worker response contract

The implementation prompt must require each worker to end its response with:

```text
RALPH_ITERATION_SUMMARY
Done: ...
Verification: ...
Blockers: ...
Next: ...
END_RALPH_ITERATION_SUMMARY
```

The summary should be concise, with approximately 2,000 characters as soft
 guidance. Ralph trims parsed summaries to 2,000 characters before persisting
and passing them forward. This is an output policy, not schema validation.

The summary should cover:

- work completed in this iteration;
- tests, typechecks, or other verification run;
- blockers or known gaps;
- next useful focus for the following worker.

## 5. Worker input

Every worker prompt includes a stable, labelled section before the task file:

```text
Previous Ralph iteration handoff summary (advisory quick reference):
(none — first iteration)
```

Later iterations replace the placeholder with the latest persisted summary.
Workers must verify the summary against the task file, repository, and tests.
The summary must not override task-file instructions or current repository state.

## 6. Parsing and fallback

Ralph extracts the content between the first valid
`RALPH_ITERATION_SUMMARY` and `END_RALPH_ITERATION_SUMMARY` markers. Persist the
trimmed, capped content without the markers.

If a worker succeeds and makes a valid checklist change but its response has no
valid summary block, preserve the worker's repository and task-file changes and
persist an empty `iterationSummary`. Missing or malformed summary is not a
worker-attempt failure and does not trigger task snapshot restoration.

Existing worker failure behavior remains unchanged: provider failure, invalid
task Markdown, or invalid checklist change restores the task snapshot, consumes
an iteration, and retries. Summary parsing must not alter cost accounting.

## 7. Reflections and lifecycle

Reflection sessions receive the persisted summary only as optional advisory
context if useful, but they do not emit, parse, or replace it. Periodic and
final reflection behavior remains unchanged.

The latest summary remains available after max-iteration, interruption, cost
accounting, or reflection pauses and is supplied when the loop resumes.

## 8. Acceptance criteria

1. New loops initialize `iterationSummary` to `""`.
2. First worker prompt contains explicit `(none — first iteration)` context.
3. A worker response with a valid tagged block persists its content in state.
4. The next worker prompt contains the persisted prior summary.
5. Resumed runs pass the persisted summary to their next worker.
6. Summary content is capped at 2,000 characters before persistence.
7. State schema accepts summaries longer than 2,000 characters if written by
   other tooling; Ralph's own output path trims them.
8. Missing or malformed summary leaves valid worker changes intact and stores
   an empty summary.
9. Invalid worker/task behavior keeps existing snapshot restoration and retry
   semantics.
10. Reflection sessions do not replace the worker summary.
11. Tests cover state initialization, prompt inclusion, marker parsing, trimming,
    empty fallback, resume behavior, and preservation of valid worker changes.

## 9. Likely implementation seams

- `src/features/ralph/schema.ts`: add `iterationSummary: z.string()`.
- `src/features/ralph/init.ts`: initialize the field.
- `src/features/ralph/run.ts`: build handoff input, parse worker output, and
  persist the summary after worker validation.
- `src/features/ralph` test files: cover parser, state, prompt, resume, and
  fallback behavior.
- `specs/ralph/ralph-tool.md`: link this behavior from the Ralph run contract.
