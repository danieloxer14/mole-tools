# mole-tools Context

This glossary captures domain language for the single `mole-tools` bounded context.

## Terms

### Feature
A user-facing tool capability represented by a `Feature` object in `src/core/feature.ts` and registered in `src/core/registry.ts`. A feature has a command name, one-line description, zod argument schema, and a `run(ctx, args)` flow.

### Registered command
A CLI command exposed to users. Most registered commands come directly from the feature registry. The `help` command is intentionally special-cased because it must run without config loading or Ink.

### Help feature
The discoverability capability that lists available tools and explains how to call each one. It is registry-backed so newly registered features appear automatically.

### Ralph orchestrator
The capability that prepares and later executes named, durable Ralph implementation loops. Its commands are `mole-tools ralph init` and `mole-tools ralph run`; initialization is invoked as `mole-tools ralph init <name> <source> --model <model>`. This is distinct from the existing top-level `mole-tools init` configuration bootstrap command.

### Ralph loop
A named implementation workflow represented by a task prompt and durable state under the target repository’s `.ralph/` directory. Its name is a lowercase kebab-case filename stem. The planned `init` mode prepares these artifacts; its execution semantics belong to the future `run` mode. Initialization refuses to replace an existing loop’s task or state artifacts; users deliberately delete them before recreating the loop.

### Ralph source
The single user-supplied work reference passed to Ralph initialization. It may be a local path, URL, or inline natural-language request; initialization classifies and supplies it to the configured provider's prompt-generation session.

### Ralph agent session
A non-interactive workspace-agent operation that generates a Ralph task file or later carries out a worker/reflection iteration. Ralph requests semantic auto-approval; the configured provider adapter maps that policy to its mechanism (PiAdapter uses `--approve`). A single `ralph run` continuously launches fresh agent sessions until the loop completes or reaches its iteration cap. A failed worker attempt consumes one iteration from the same cap, records its error, and is retried through the normal next-iteration path against the same unchecked task. Its CLI UI shows a current-iteration spinner plus concise lifecycle log entries, not raw provider output.

### Ralph loop settings
The iteration limit and reflection cadence captured in a loop’s state at initialization. They come from `ralph init` CLI flags, with defaults of 20 maximum iterations and reflection every five iterations. Each iteration always processes exactly one task; no items-per-iteration setting exists. `ralph run <name> --maxIterations <total>` raises the persisted total cap before resuming. Reflection instructions are not persisted in state.

### Ralph reflection prompt
The user-configurable prompt loaded at reflection time from the mole-tools prompts directory. Its seeded default contains the five reflection questions and frames the response as an implementation review. The review instructions live in this configured loop prompt, not in an external `code-review` skill. A reflection runs every configured number of iterations and once more as the final review when the loop reaches `completed`; a cadence of zero skips only periodic reflections, not that final review. If it discovers unfinished or insufficiently verified work, it unchecks the relevant task-file items and reopens the state as `in_progress` so later iterations continue. A failed or structurally invalid reflection pauses the loop with reason `reflection_failed`; it never silently completes the loop.

### Ralph implementation prompt
The user-configurable prompt appended to the selected provider's system prompt for every worker session. Its seeded default directs the worker to implement the selected Ralph task with TDD where feasible, run regular typechecks and focused tests, run the full suite at completion, and self-review the resulting work according to the loop instructions.

### Ralph task file
The generated Markdown instructions at `.ralph/<name>.md` that guide a loop worker. Init validates the required `Goal`, `Deliverable`, `Task checklist`, `Stale-prompt guard`, `Completion gate`, and `Iteration protocol` headings, then persists the task file and its initial state immediately rather than requesting user review. Every iteration rereads it, selects one unchecked task, inspects the current repository, implements and verifies that task, then marks it checked before ending the iteration. It declares loop completion only when no tasks remain unchecked and the full validation suite passes.

### Ralph state file
The machine-readable state at `.ralph/<name>.state.json` that persists a Ralph loop’s iteration count, lifecycle status, settings, selected provider/model, worker metadata, completion information, and cumulative Ralph cost data. Its required cost ledger is introduced as a breaking state-schema change; old state files without it are out of scope. Ralph prints its persisted cost summary after successful initialization and after every terminal run outcome, including completion, pauses, failures, and interruption. A run summary lists the full loop’s iteration-cost history, not only the invocation’s new iterations. mole-tools, rather than an agent worker, owns all of its updates. It retains runtime diagnostics: an orchestrator-generated worker run ID, the current/most recent worker item, timestamps, and the most recent error. Its `phase` supplies live UI detail and is one of `ready`, `implementing`, `reflecting`, `paused`, or `completed`; `status` remains the authoritative lifecycle field. A newly initialized state is `ready` at iteration zero; it becomes `in_progress` while continuing implementation (including after a failed attempt, which records its error and consumes an iteration), `paused` with reason `max_iterations_reached` when its cap is reached, and `completed` only after the completion gate and final review pass. Its provider is selected from the Ralph feature profile during initialization; its required model is supplied by the CLI. Both are persisted and reused by later worker and reflection sessions. Worker and timestamp fields begin only when `ralph run` executes. The “state iteration file” refers to this file; it is distinct from the Markdown task file.

### Ralph cost record
Provider-reported token usage and, when available, actual USD spend for one Ralph agent session. When the provider cannot report USD, mole-tools estimates it from the session’s usage and applicable model pricing, marking that value as estimated. Model prices come from a built-in catalog; cataloged local/self-hosted models have a USD cost of zero, while an unlisted cloud model retains token usage but has no USD estimate. A durable session ledger in the Ralph state stores one typed record for initialization, every worker attempt, and every reflection, linked to its worker iteration when applicable. From that ledger mole-tools derives cost subtotals without double-counting across initialization, worker attempts (including failures), periodic reflections, and the final reflection. A worker attempt plus its immediately following periodic reflection forms that iteration’s displayed subtotal; the full-loop total includes initialization and every later session across resumed `run` commands. Pi session JSONL files are the authoritative cost input for Pi agent sessions. mole-tools captures the session ID from Pi's JSON stream, reads the matching JSONL from a mole-tools-controlled temporary directory when the operation ends, then deletes it. A failure to parse or persist Ralph's normalized cost pauses the Ralph loop with `cost_accounting_failed`, preserving completed worker changes but launching no later Pi sessions; its diagnostic must be fixed before a later run. Non-Ralph features continue despite an accounting failure. mole-tools does not retain session files or implement cost-recovery workflows.

### Ralph run lock
The exclusive `.ralph/<name>.lock` file held while a continuous Ralph run owns a loop. It records the owning process so a later command can reject a live concurrent run or reclaim a stale lock after checking its PID. On Ctrl+C, Ralph cancels its active agent operation through the LLM port, waits for it to settle, preserves task changes already written, sets state to `paused` with reason `interrupted`, clears `active`, and removes the lock.

### Commit auto mode
A strictly non-interactive commit invocation enabled by `mole-tools commit --auto`. It accepts the generated, format-valid message and creates the local commit without showing the message selection. It deliberately never pushes; staged-change validation, Jira lookup, diff collection, generation, and failure handling remain unchanged. A future commit-flow decision that cannot be safely automated fails rather than prompting or silently choosing a default.

### LLM provider profile
A feature-owned provider/model selection in global configuration, for example `commit: { provider: "ollama", model: "qwen3" }` or `ralph: { provider: "pi" }`. Provider connection details are stored separately under `providers`. Changing a profile changes no feature flow.

### LLM capability
An explicit operation an LLM provider supports. `text-generation` serves commit and merge-request; `agentic-workspace` serves Ralph. A provider that lacks a requested capability fails at preflight before external work. `Context.llm` routes a feature purpose to its configured provider without exposing provider names to feature code.

### LLM usage result
The provider-neutral structured usage returned by an LLM operation: token counts, cache metrics, and any provider-reported USD charge. Each provider adapter obtains this from its authoritative provider-native source; for Pi, that source is its completed session JSONL. Pi is an implementation of the contract, not a special case in the persisted cost schema. Agent results always carry this usage; adapters preserve reported values, while shared cost code derives a clearly marked USD estimate from the shared price catalog when no actual charge is available.

### Model price catalog
The built-in, provider/model-specific rate table shared by all cost accounting paths. It prices input, output, and where applicable cache-read and cache-write tokens only when a provider-native USD charge is absent. Local providers are zero-cost; unknown cloud models retain usage with unavailable USD. The catalog is versioned with mole-tools, not user or project configured.

### User-supplied generation context
Optional, invocation-scoped, non-blank free text supplied through the `--context` CLI option to guide an LLM-generated commit message or merge-request title and description. Its internal whitespace is preserved; it has no tool-level length limit and is not persisted. Prompt builders render it immediately after the feature prompt as a clearly labelled guiding-instruction section, before Jira, commit, and diff evidence. For a merge-request invocation that commits staged changes, the same context guides the internal commit generation as well as merge-request generation.

### Cost entry
One persisted accounting observation in generic cost history. It carries the provider session ID, provider-neutral usage plus provider/model provenance, actual, estimated, zero, or unavailable USD status, and may carry a sanitized accounting diagnostic. An unavailable entry is an explicit failed accounting observation, never a zero-cost entry. The cost ledger contains LLM provider operations only; Jira, git-host, and other context measurements are not cost entries.

### Cost breakdown
The existing generic `cost-breakdown` history and its hypothetical Claude-comparison presentation. Its current user-facing tables remain unchanged while provider adapters move to authoritative provider-native accounting; any stored actual provider cost is not yet displayed there. Its richer cost-entry schema is a breaking change: legacy history is unsupported and is neither migrated nor displayed.

### Feature help metadata
Optional command-level documentation colocated on a feature. It may include usage, examples, and notes. It does not replace generated data from the feature's name, description, or zod args.

### Zod argument metadata
Descriptions and examples attached to individual zod argument schemas with `.describe(...)` and `.meta({ examples: [...] })`. This is the canonical place for option-level help text.

### Plain stdout help
Deterministic text printed directly to stdout, without mounting Ink and without loading config. Used for `mole-tools help` and `mole-tools help <command>`.
