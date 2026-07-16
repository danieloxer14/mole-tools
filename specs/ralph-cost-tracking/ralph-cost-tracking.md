# Ralph Cost Tracking

## Goal

Make every Ralph agent session cost attributable, durable, and visible: show the cost of each implementation iteration and the full-loop total after `ralph init` and every terminal `ralph run` outcome.

## Scope

- Provider-neutral agent usage and cost data on the abstract LLM interface.
- Durable Ralph cost ledger in `.ralph/<name>.state.json`.
- Per-iteration and full-loop aggregation.
- Terminal cost-summary output for Ralph init and run.
- Built-in model pricing catalog and explicit estimate provenance.

## Non-goals

- Altering the existing generic `cost-breakdown` feature or its historical JSONL format.
- Retrospectively estimating cost for existing Ralph state files.
- Adding remotely fetched or user-configured model pricing.
- Charging non-LLM work such as filesystem, Git, or tool operations.

## Terminology

| Term | Meaning |
| --- | --- |
| **Agent session** | One `runAgent` invocation for Ralph init, a worker attempt, or a reflection. |
| **Cost record** | The durable state entry for one agent session, including usage, USD result, and attribution. |
| **Iteration subtotal** | A worker attempt plus its immediately following periodic reflection, if any. |
| **Full-loop total** | Init plus all worker attempts, periodic reflections, and final reflections across every resume. |
| **Actual USD** | A provider-reported charge. |
| **Estimated USD** | A shared calculation from usage and a built-in model-price catalog. |
| **Unavailable USD** | No provider charge and no applicable catalog price; token usage is still recorded. |

## Requirements

### 1. Abstract LLM usage contract

`AgentResult` must carry structured usage for every completed agent operation.

```ts
interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  source: "reported" | "estimated";
}

interface UsdCost {
  amount: number;
  source: "actual" | "estimated" | "zero";
}

interface AgentResult {
  output: string;
  stderr?: string;
  ok: boolean;
  usage: LlmUsage;
  usdCost?: UsdCost;
}
```

- All token counts are non-negative integers.
- An adapter uses provider-reported usage when available.
- If the provider omits usage, the adapter estimates input tokens from the actual agent input and output tokens from captured assistant output. It sets `usage.source` to `estimated`.
- An adapter may return a provider-reported actual charge as `usdCost` with source `actual`.
- Ralph must not inspect raw provider events or estimate tokens itself.

### 2. Shared pricing

Shared cost code receives an `LlmUsage`, provider key, and model name.

1. Keep an existing actual `usdCost` unchanged.
2. For a cataloged local/self-hosted model, return `{ amount: 0, source: "zero" }`.
3. For a cataloged priced model, calculate USD from its input/output/cache rates and return source `estimated`.
4. For an unlisted model, return no USD value.

The price catalog must be model-specific. It must not reuse the existing Claude comparison table as an actual Ralph price or apply a generic fallback rate.

### 3. Ralph state ledger

`RalphStateFile` gains a required `costLedger` array. State files without it are invalid; migration is out of scope.

```ts
interface RalphCostRecord {
  id: string; // UUID
  phase: "init" | "implement" | "reflect";
  iteration?: number; // worker and its periodic reflection only
  provider: string;
  model: string;
  startedAt: number;
  completedAt: number;
  ok: boolean;
  usage: LlmUsage;
  usdCost?: UsdCost;
}

interface RalphStateFile {
  // existing fields
  costLedger: RalphCostRecord[];
}
```

Rules:

- Init uses `phase: "init"` and has no `iteration`.
- A worker uses `phase: "implement"` and the iteration it consumes, including a failed worker attempt.
- A periodic reflection uses `phase: "reflect"` and the just-completed worker iteration.
- A final reflection uses `phase: "reflect"` with no `iteration`.
- Write a record immediately after an agent result settles, before later task-file validation or state transitions can fail.
- Persist every ledger mutation via the existing atomic `writeState` path.
- An aborted process that cannot receive an agent result has no new record; records already persisted remain intact.

### 4. Aggregation

Aggregation is pure and derives views from the ledger; it must not store duplicate totals.

- Group records by `iteration` to calculate each displayed iteration subtotal.
- Keep init and final reflection as separately labelled rows.
- Full-loop token totals sum every ledger record exactly once.
- Full-loop USD total is shown only when every included record has USD. Otherwise show a partial/unknown USD indicator while retaining all token totals.
- A total that contains one or more estimated USD values is labelled **estimated**.
- A total containing only actual values is labelled **actual**.
- A total containing zero local cost and actual values follows the non-zero values' provenance.

### 5. Console output

After successful `ralph init`, print a summary containing the init record and current loop total.

After every terminal `ralph run` outcome, print the full persisted history before returning or rethrowing the terminal error. This includes:

- normal completion;
- max-iteration pause;
- reflection failure;
- worker validation failure that terminates the command;
- Ctrl+C interruption after the active operation settles.

The output contains:

1. loop name and terminal status;
2. init cost;
3. one row for every iteration subtotal in numerical order;
4. a separate final-reflection row when present;
5. aggregate input, output, cache (when available), and USD values;
6. a full-loop total with actual/estimated/zero/unavailable labeling.

Example when all USD values are available:

```text
Ralph cost — refactor-auth — paused
Init                 1,240 in     890 out   $0.01 estimated
Iteration 1          8,103 in   2,401 out   $0.08 actual
Iteration 2          9,411 in   3,022 out   $0.09 estimated
Final reflection     1,802 in     650 out   $0.02 estimated
Total               20,556 in   6,963 out   $0.20 estimated
```

Example with an unlisted cloud model:

```text
Ralph cost — refactor-auth — completed
Init                 1,240 in     890 out   USD unavailable
Iteration 1          8,103 in   2,401 out   USD unavailable
Total                9,343 in   3,291 out   USD unavailable
```

## Change areas

| Area | Change |
| --- | --- |
| `src/ports/llm.ts` | Define `LlmUsage` and USD-cost types; make `AgentResult.usage` required. |
| `src/adapters/llm/pi.ts` | Parse Pi JSON usage events; estimate usage from actual input/output when absent; preserve actual provider charges when available. |
| `src/shared/` | Add catalog lookup, cost derivation, aggregation, and Ralph summary formatting as pure functions. |
| `src/features/ralph/schema.ts` | Add strict Zod schemas for ledger records and require `costLedger`. |
| `src/features/ralph/init.ts` | Create and persist init cost record before printing its summary. |
| `src/features/ralph/run.ts` | Capture worker/reflection results, append records atomically, and print terminal summaries on all defined paths. |
| `test/fakes/FakeLlm.ts` | Return usage in default and scripted agent results. |

## Acceptance criteria

1. Every successful or failed Ralph agent result has a durable, attributed ledger record.
2. A provider-reported token count is retained unchanged and marked `reported`.
3. Missing provider usage is estimated by the adapter and marked `estimated`.
4. Actual provider USD is not replaced by an estimate.
5. A cataloged local model has exact `$0` USD cost.
6. An unlisted model shows token usage and USD unavailable, never a generic-rate estimate.
7. Worker failures consume an iteration and are included in the full-loop total.
8. A periodic reflection is included exactly once in that iteration subtotal.
9. A final reflection is included exactly once as a separate row and in the full-loop total.
10. Resumed runs preserve and aggregate all previously persisted ledger entries.
11. Init and every terminal run outcome print the complete loop-cost history and total.
12. A Ralph state missing `costLedger` fails schema validation.

## Test plan

- Unit-test token and USD provenance, price catalog lookup, unavailable pricing, and aggregation without I/O.
- Unit-test state parsing rejects missing/malformed ledger entries and accepts valid records.
- Test Pi event parsing with recorded JSON lines for reported usage and a no-usage fallback fixture.
- Test init writes one init ledger entry and renders its summary.
- Test worker success, worker failure, periodic reflection, final reflection, max-cap pause, reflection failure, and interruption paths in the Ralph runner.
- Assert every terminal summary reads from persisted state and includes historical iterations from a previous run.
