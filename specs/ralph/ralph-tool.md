# mole-tools — Ralph Orchestrator Spec

**Status:** Product-grilled — `ralph init` and `ralph run` scoped for implementation.
**Date:** 2026-07-12
**Author:** Daniel Oxer

The Ralph orchestrator creates durable, named implementation loops in the current
repository. It generates a task file and then continuously runs fresh agent workers
against that task until completion, pause, or the configured cap.

## 1. Product framing

### Why it exists

A spec, implementation plan, ticket set, or feature brief should become a
reusable Ralph worker prompt without hand-authoring task files. `mole-tools`
uses the configured LLM provider and a caller-selected model to produce that
prompt, then stores the prompt and its execution state beside the work.

### Design stance

- The selected LLM provider owns task decomposition and repository-aware
  wording; mole-tools owns durable artifact shape, validation, and lifecycle defaults.
- A generated task is executable only when it has a verifiable checklist and
  explicit stale-context and completion protections.
- Existing loops are never overwritten implicitly.
- Ralph requests semantic auto-approval when an agent operates in the target
  repository. The selected provider adapter maps that policy to its own safe
  mechanism (Pi uses `--approve`).

## 2. Invocation

```bash
mole-tools ralph init <name> <source> --model <model> \
  [--maxIterations <number>] \
  [--reflectEvery <number>]
```

- `<name>` names the durable loop and must match lowercase kebab case:
  `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `<source>` is exactly one argument. It can be a local path, a URL, or an
  inline natural-language brief. It is retained verbatim in state for
  traceability.
- `--model` is required. Its provider model pattern/ID is persisted with the
  selected provider and reused by future worker and reflection sessions.
- The provider comes from the `ralph` feature profile in global configuration.
  Ralph requires its provider to support `agentic-workspace`; unsupported
  providers (including Ollama) fail during preflight before external work.
- Defaults: `maxIterations=20`, `reflectEvery=5`. Every iteration processes
  exactly one task. `reflectEvery=0` suppresses periodic reflection but never
  the final review.
- The command runs from the target repository. All loop artifacts are relative
  to that working directory.

The top-level `mole-tools init` remains the configuration bootstrap command;
this feature is only available below `mole-tools ralph`.

## 3. Provider configuration

Provider/model selection is feature-owned. Global configuration has a `ralph`
profile such as `{ "provider": "pi" }`, while provider connection details live
under `providers`. The required `ralph init --model` value supplies the model
for that profile and is persisted in the loop state. The LLM router resolves
Ralph requests to that provider; Ralph feature code never imports or invokes a
provider directly.

## 4. Prompt configuration

Use the existing prompt-loader convention: files live in the mole-tools global
prompts directory adjacent to `config.json`, are seeded only when missing, and
are never overwritten after user edits.

| File | Purpose |
| --- | --- |
| `ralph-init-system.md` | System prompt for the agent session that creates a Ralph task file. |
| `ralph-implement-system.md` | Appended to the agent system prompt for every worker iteration. |
| `ralph-reflection-system.md` | Reflection/review prompt used by `ralph run`; loop state intentionally does not embed it. |

### 4.1 Default Ralph-init system prompt requirements

The seeded prompt must tell the agent to return **only** the task-file Markdown (no
fences, commentary, or implementation). It must direct the agent to:

1. gather context from the supplied source and the current repository;
2. summarize the goal and concrete deliverable;
3. decompose work into small, independently verifiable tasks that follow a
   TDD red → green approach, with each task represented by an unchecked
   `- [ ]` checkbox;
4. include a stale-prompt guard, completion gate, and loop instructions.

Its required Markdown headings are exactly:

```markdown
## Goal
## Deliverable
## Task checklist
## Stale-prompt guard
## Completion gate
## Iteration protocol
```

The task checklist must contain at least one unchecked task. Implementations
may allow ordinary prose before these sections, but each required heading must
be present once.

### 4.2 Default Ralph-reflection prompt requirements

The seeded reflection prompt is an implementation review and includes these
questions:

1. What has been accomplished so far?
2. What's working well?
3. What's not working or blocking progress?
4. Should the approach be adjusted?
5. What are the next priorities?

It additionally instructs the future worker to compare the task file, current
repository state, and verification evidence; to uncheck or add tasks for work
that is incomplete or insufficiently verified; and to reopen the loop when
that happens.

## 5. `ralph init` flow

1. **Validate arguments.** Validate the name, source, required model, and
   positive integer settings. `reflectEvery` may be zero; `maxIterations`
   must be at least one.
2. **Refuse collisions.** If either `.ralph/<name>.md` or
   `.ralph/<name>.state.json` exists, fail before invoking the provider. There is no
   `--force`; the user must explicitly delete old artifacts to recreate a loop.
3. **Load configured prompt and provider.** Seed/load `ralph-init-system.md`
   and preflight the configured Ralph provider's `agentic-workspace`
   capability before external work.
4. **Generate task file.** Ask the injected LLM port to run an approved,
   non-interactive workspace-agent session in the current repository with the
   persisted provider, selected model, init system prompt in replacement mode,
   and the generation request. The Pi adapter translates this semantic request
   to `pi --approve -p --model <model> --system-prompt …`.

   The generation request identifies the loop name and source, asks the agent
   to inspect/fetch that source as appropriate, and repeats the output-only and
   required-structure contract. A local source path is resolved relative to
   the current directory; an existing path is described as a source to read, a
   URL as a source to retrieve, and all other values as inline briefs.
5. **Validate output.** Reject empty output, missing required headings,
   duplicated required headings, or output with no unchecked task. Do not
   create loop artifacts on provider failure or validation failure.
6. **Persist artifacts.** Create `.ralph/` if needed. Write both artifacts
   only after all validation succeeds, using temporary files and rename for
   each file. If persistence fails, clean up artifacts created by this command
   and report the failure. Print the created paths on success.

## 6. Durable artifacts

### 5.1 Task file

Path: `.ralph/<name>.md`

The file is the provider's validated Markdown output. mole-tools does not
reformat or otherwise edit the generated task plan.

Its required protocol makes later workers:

1. reread this file at the beginning of every iteration, rather than trusting
   prior session context;
2. select only the next unchecked checklist task;
3. inspect current code and state before changing code;
4. implement that one task with TDD red → green verification;
5. check that task only after its relevant verification passes;
6. update state and end that iteration;
7. mark the loop completed only if every task is checked and the full validation
   suite passes.

### 5.2 Initial state file

Path: `.ralph/<name>.state.json`

```json
{
  "name": "<name>",
  "source": "<source>",
  "taskFile": ".ralph/<name>.md",
  "provider": "<configured ralph provider>",
  "model": "<model>",
  "iteration": 0,
  "maxIterations": 20,
  "reflectEvery": 5,
  "active": false,
  "status": "ready",
  "lastReflectionAt": 0,
  "phase": "ready",
  "awaitingReview": false
}
```

The numeric settings reflect explicit CLI values when provided. No reflection
prompt text is persisted. `startedAt`, `completedAt`, `workerRunId`, and
`workerItem` are absent until the first `ralph run` execution.

### 5.3 Runtime state additions

On its first run, Ralph adds `startedAt`. During and after a run it retains:

```json
{
  "active": true,
  "status": "in_progress",
  "phase": "implementing",
  "workerRunId": "<orchestrator UUID>",
  "workerItem": "- [ ] <selected task>",
  "lastError": "<most recent worker/reflection failure, if any>",
  "lastReflectionAt": 5
}
```

`status` is authoritative: `ready`, `in_progress`, `paused`, or `completed`.
`phase` supplies live UI detail: `ready`, `implementing`, `reflecting`,
`paused`, or `completed`. `workerRunId` and `workerItem` retain their most
recent values after the run. `active` is false whenever this process no longer
owns the loop. `completedAt` is set only after final reflection passes.

## 7. `ralph run`

### 7.1 Invocation

```bash
mole-tools ralph run <name> [--maxIterations <total>]
```

The optional total can only raise the persisted cap. On a cap pause, the
command tells the user to rerun with a larger `--maxIterations` value.

### 7.2 Prompt configuration

The seeded `ralph-implement-system.md` reads:

> Implement the work described by the ticket. Use TDD where possible, at
> pre-agreed seams. Run typechecking regularly, single test files regularly,
> and the full test suite once at the end. Once done, review the work according
> to the instructions in the Ralph task file.

For every worker, Ralph loads this user-editable file and passes it to the LLM
port as an appended system prompt. The Ralph task file is supplied as input
along with a request to execute exactly the next unchecked task. The selected
provider adapter preserves its normal and project-local context while adding
this implementation policy.

The user-editable reflection prompt remains the source of review instructions;
it is appended for reflection sessions instead of the implementation prompt.

### 7.3 Preflight and exclusive ownership

1. Validate the name and load both task and state files. Reject a malformed
   state, mismatched name/task path, invalid task headings, or a task with no
   parseable checklist.
2. Apply a valid cap increase before starting. A lower or equal override fails.
3. If state is already `completed`, report it and exit successfully.
4. Atomically create `.ralph/<name>.lock`, containing the owning PID and run
   metadata. A live lock rejects the command. A lock whose PID is no longer
   alive is reclaimed.
5. Set `active=true`, `status=in_progress`, and `phase=implementing`; assign a
   worker run UUID and persist the selected item before launching the provider.

### 7.4 Continuous worker loop

A single invocation keeps running until it completes, pauses, is interrupted,
or reaches its cap.

For each iteration:

1. If `iteration === maxIterations`, set `active=false`, `status=paused`,
   `phase=paused`, and `pauseReason=max_iterations_reached`; remove the lock,
   print the cap-increase command, and exit nonzero.
2. Read and snapshot the task file afresh, then choose its first unchecked
   task. This is the sole task permitted to change in the worker session.
3. Run the persisted provider through the injected LLM port as a
   non-interactive, auto-approved workspace-agent session, with the persisted
   model, implementation prompt in append mode, and the task file plus
   selected-task request as input. Do not render provider output in the normal
   UI. PiAdapter translates this request to Pi CLI flags.
4. Show an Ink spinner such as `Iteration 4/20 — <task>` throughout the
   subprocess. Append concise lifecycle log entries for starts, verification,
   retries, reflections, pauses, and completion.
5. Reread the task file when the agent operation exits. A successful worker must have checked
   exactly the selected checkbox and must not have changed another checklist
   item. Mole-tools then increments `iteration`, retains worker diagnostics,
   clears `lastError`, and continues.
6. A nonzero provider exit, unchanged selected checkbox, changed wrong/multiple
   checkboxes, or invalid task structure is a failed attempt. Mole-tools
   restores the pre-worker task snapshot, increments `iteration`, records
   `lastError`, and immediately continues the normal loop. Thus retries consume
   the same pool as regular iterations without carrying an invalid checkbox
   change forward.
7. After every iteration count divisible by a nonzero `reflectEvery`, run the
   periodic reflection in §7.5. Failed attempts count toward this cadence.

When no unchecked task remains, the last worker must already have satisfied the
task-file completion gate, including its full validation suite. Ralph then
performs final reflection rather than launching another implementation worker.

### 7.5 Reflection and completion

For periodic and final review, snapshot the task file, set `phase=reflecting`,
and launch an approved, non-interactive workspace-agent session through the
persisted provider with the persisted model, task file, and
`ralph-reflection-system.md` appended to the system prompt.

- A reflection may revise checklist state by unchecking inadequate work or
  adding new unchecked tasks. Mole-tools rereads the task; if work remains, it
  returns state to `in_progress`, phase to `implementing`, and continues.
- Before final reflection, mole-tools sets `status=completed`; this makes the
  review a true completion gate. If the review reopens work, it immediately
  returns status to `in_progress` and continues the loop.
- A reflection failure or invalid task Markdown restores the pre-reflection
  task snapshot, pauses the loop with `pauseReason=reflection_failed`,
  preserves diagnostics, removes the lock, and exits nonzero. It never silently
  completes the loop.
- Only a final reflection that leaves no unchecked task finalizes
  `active=false`, `status=completed`, `phase=completed`, and `completedAt`.

### 7.6 Interruption

On Ctrl+C, forward cancellation through the active LLM agent operation and
wait for it to exit. Preserve task-file changes already written, set `active=false`,
`status=paused`, `phase=paused`, and `pauseReason=interrupted`, then remove the
lock. The next `ralph run` resumes from the task file.

## 8. Scope

### In

- `mole-tools ralph init <name> <source> --model <model>`.
- Provider-neutral task-plan generation with an approved, non-interactive workspace-agent session.
- Configurable seeded init, implementation, and reflection prompt files.
- Strict task Markdown validation.
- Collision-safe creation of task and initial state artifacts with cleanup on persistence failure.
- Persisted settings and model needed by run mode.
- Continuous one-task fresh-agent worker iterations with automatic retries that consume the cap.
- User-visible current-iteration spinner and concise lifecycle log.
- Periodic and mandatory final reflection, including reopening incomplete work.
- PID-backed exclusive run locks, graceful interruption, and cap-resume override.

### Out

- Background/detached worker handling; runs stay attached to the terminal.
- UI review/editing of generated task files before persistence.
- A force-overwrite option.
- Global Ralph configuration defaults.
- Remote ticket authentication or bespoke tracker clients; the selected agent
  retrieves URLs using its available repository tools and credentials.

## 9. Acceptance criteria

| # | Given | Then |
| --- | --- | --- |
| 1 | Valid name, source, model, agent-capable provider, and no existing artifacts | The injected LLM port runs an approved workspace-agent session using the selected model and configured init system prompt; PiAdapter maps this to `-p` and `--approve`. |
| 2 | No `ralph-init-system.md` exists | The default is seeded and then used. |
| 3 | A user-edited init prompt exists | It is used unchanged. |
| 4 | No implementation or reflection prompt exists | Both defaults are seeded without adding prompt text to state. |
| 5 | Provider returns valid required Markdown with unchecked tasks | `.ralph/<name>.md` and a `ready`, iteration-zero state file are created after validation. |
| 6 | Provider fails, exits nonzero, or returns invalid Markdown | Command exits nonzero and neither artifact is created. |
| 7 | Task file or state file already exists | Command fails before invoking the provider; no overwrite option is offered. |
| 8 | Options are omitted | State contains 20 max iterations and a reflection cadence of five. |
| 9 | `--reflectEvery 0` is supplied | State records zero; run still requires final review. |
| 10 | `ralph run <name>` starts from a valid ready state | It locks the loop, shows the current-task spinner, and continuously launches one fresh agent worker per iteration. |
| 11 | A worker succeeds | It checks exactly the selected task; mole-tools increments state and continues. |
| 12 | A worker fails or modifies invalid checklist state | Its task snapshot is restored, the attempt consumes an iteration, and the normal loop retries it. |
| 13 | Iteration reaches the cap with work left | State pauses as `max_iterations_reached`; `ralph run <name> --maxIterations <higher total>` resumes it. |
| 14 | Periodic or final reflection fails | Its task snapshot is restored and state pauses as `reflection_failed`. |
| 15 | Final reflection finds a gap | Relevant tasks are unchecked/added and state returns to `in_progress`. |
| 16 | User presses Ctrl+C | The agent operation is cancelled, state pauses as `interrupted`, and the lock is removed. |
| 17 | A second process starts the same loop | The PID-backed lock rejects it; a stale lock is reclaimed. |

## 10. Discoverability

Register the `ralph` feature in `src/core/registry.ts` so it appears in
`mole-tools help` automatically. Its feature help must document both commands:

```bash
mole-tools ralph init <name> <source> --model <model> [--maxIterations <number>] [--reflectEvery <number>]
mole-tools ralph run <name> [--maxIterations <total>]
```

Command-specific help must explain the `<source>` forms, kebab-case loop name,
state/task locations, the no-overwrite rule, and that `run` is continuous.
