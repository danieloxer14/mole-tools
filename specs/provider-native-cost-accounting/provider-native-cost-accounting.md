# Provider-native cost accounting — implementation plan

**Status:** Grilled / agreed. Not yet implemented.  
**Date:** 2026-07-14  
**ADR:** [0006](../../docs/adr/0006-provider-native-cost-accounting.md)

## Goal

Replace token heuristics and machine-specific Pi assumptions with provider-native, normalized LLM accounting. Pi must use the same final totals that its `/session` command shows, while the resulting contract supports future Claude and Codex adapters.

## Verified spike findings

1. `pi --mode json` begins with a session header containing the session `id`.
2. Pi session JSONL assistant messages contain final `usage` values including input, output, cache read/write, and an itemized USD cost.
3. Parsing the supplied remote Pi session reproduced its `/session` total exactly: `$0.197037`, with 44,172 uncached input tokens, 250,368 cache-read tokens, and 1,601 output tokens.
4. Pi supports `--session-dir`, so mole-tools can avoid the default `~/.pi/...` location.
5. The current `PiAdapter` looks for token usage on the event root, whereas Pi JSON events provide it in nested assistant messages. The completed session JSONL is therefore the selected authority, not streamed usage aggregation.

## Scope

- A breaking, LLM-only generic cost-entry/history schema.
- Provider-neutral normalized usage, USD provenance, provider/model, provider session ID, and sanitized accounting failures.
- A shared built-in price catalog.
- Pi temporary-session lifecycle and JSONL parsing for both `generate()` and `runAgent()`.
- Ralph ledger integration and its fail-closed accounting policy.
- Preserve the existing `cost-breakdown` UI as-is.

## Non-goals

- Retaining raw Pi JSONLs, building a recovery queue, or persisting session paths.
- Migrating or rendering legacy `cost-history.jsonl` entries.
- User/project pricing overrides or remotely fetched pricing.
- Treating Jira, git-host, filesystem, or tool activity as LLM cost.
- Redesigning the hypothetical Claude-comparison tables in `cost-breakdown`.

## Normalized model

Introduce one provider-neutral result/value model, shared by generic history and Ralph:

```ts
type CostSource = "actual" | "estimated" | "zero" | "unavailable";

interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  source: "reported" | "estimated";
}

interface UsdCost {
  source: CostSource;
  amount?: number; // required except unavailable
}

interface CostEntry {
  type: "llm";
  task: string;
  provider: string;
  model: string;
  providerSessionId?: string;
  usage?: Usage;
  usdCost: UsdCost;
  accountingDiagnostic?: string;
}
```

Rules:

- Every normal LLM operation records one entry after it settles.
- A provider-native charge wins and is `actual`.
- Otherwise, the shared catalog derives `estimated` USD from all available usage dimensions.
- A local provider is `$0` with `zero` provenance.
- An unlisted cloud model is `unavailable`, not a generic-rate guess.
- A non-Ralph accounting failure writes an `unavailable` entry with no invented usage/cost and a bounded, sanitized diagnostic.
- A Ralph record carries the same result plus Ralph phase/iteration attribution.

## Design and implementation sequence

### 1. Create shared accounting primitives

**Files:** `src/ports/llm.ts`, `src/core/cost-tracker.ts`, new `src/shared/cost/*` modules.

- Move `LlmUsage`/USD result into a reusable normalized accounting result, including unavailable USD and optional provider session ID.
- Replace token-only `CostEntry` with the breaking LLM-only schema above.
- Make `CostTracker` accept only normalized LLM entries.
- Extract `RALPH_MODEL_PRICING` and `deriveRalphUsdCost` from `src/shared/ralph-cost.ts` into one shared provider/model price catalog and derivation helper.
- Keep Ralph aggregation/formatting Ralph-specific, but make it consume the shared cost types/helper.

### 2. Make generic history strict and breaking

**Files:** `src/adapters/cost-history/file.ts`, `src/index.tsx`, `src/features/cost-breakdown/format.ts`.

- Add a strict versioned/current-session schema at write and read boundaries. Legacy rows fail rather than being coerced or migrated.
- Persist the richer entries after every feature run as today.
- Leave `formatSessionBreakdown`, `formatCostSavingsTable`, and their visible tables unchanged. Adapt their input access only enough to compile against the richer entry; they intentionally ignore provider-native metadata for now.

### 3. Remove non-LLM pseudo-costs

**Files:** `src/adapters/issue-tracker/jira.ts`, `src/adapters/git-host/glab.ts`, dependency construction/tests in `src/core/context.ts`.

- Remove `CostTracker` dependencies and `record()` calls from Jira and glab.
- Keep their normal diagnostics and feature behavior unchanged.

### 4. Add Pi authoritative-session accounting

**Files:** `src/adapters/llm/pi.ts`, new focused parser/session helper module and fixtures.

- Refactor `generate()` and `runAgent()` to share Pi process/session management.
- Create an OS temporary directory with `mkdtemp(join(tmpdir(), "mole-tools-pi-"))`.
- Launch Pi with `--mode json --session-dir <temporary directory>`.
- Parse the first JSON header and retain only its session ID.
- After process settlement, locate the file in that directory whose session header ID matches. Parse assistant-message usage across the completed session exactly as Pi `/session` does.
- Build normalized usage and `actual` USD from the JSONL; use shared pricing only if the completed JSONL lacks USD.
- Remove the temporary directory in `finally` on success, cancellation, parsing failure, and process failure. Never persist its path or raw contents.
- Raise a typed, sanitized `CostAccountingError` for missing/malformed header, missing/mismatched/incomplete JSONL, invalid usage, or failed cost persistence. Do not fall back to text token estimates for these defects.

### 5. Preserve adapter neutrality

**Files:** `src/adapters/llm/ollama.ts`, `src/ports/llm.ts`, `test/fakes/FakeLlm.ts`.

- Have Ollama record the same normalized entry using reported evaluation counts when available; use explicit estimated usage only when counts are absent, and derive local zero USD through the shared catalog.
- Ensure future Claude/Codex adapters only need to supply their provider-native accounting result; no feature-level provider branches.
- Update fake results to provide session IDs/usage/USD outcomes where tests need them.

### 6. Integrate Ralph and enforce its failure boundary

**Files:** `src/features/ralph/schema.ts`, `init.ts`, `run.ts`, `persistence.ts`, `src/shared/ralph-cost.ts`.

- Add `providerSessionId` and the normalized USD/diagnostic shape to Ralph cost-record Zod schemas.
- Replace Ralph-specific pricing calls with shared accounting derivation.
- On a settled Ralph accounting failure, atomically persist an unavailable record and state `paused` with `cost_accounting_failed`; preserve worker changes and do not start reflection/another worker.
- Ensure init, worker, and reflection paths all follow this rule and terminal summary output still comes from persisted state.
- Do not introduce session-file retention or a recovery command.

## Test plan

### Unit tests

- Shared catalog: actual wins, estimate includes input/output/cache rates, local zero, unknown cloud unavailable.
- Cost schema: rejects legacy/token-only rows; accepts actual, estimated, zero, and unavailable entries.
- Sanitizer: strips temporary paths, prompt/session content, credentials, stacks, and unbounded text from diagnostics.
- Ralph aggregation: preserves actual/estimated/zero/unavailable provenance and session IDs.

### Pi adapter fixtures

- Header session ID is captured.
- Matching JSONL is authoritative when stream usage is contradictory.
- JSONL totals match input/output/cache/USD aggregation.
- Actual USD, catalog estimate, local zero, and unknown cloud cases.
- Missing header, missing JSONL, malformed JSONL, ID mismatch, invalid usage, process failure, and cancellation all clean the temporary directory.

### Feature/integration tests

- Pi-backed commit/MR generation continues on accounting failure and appends one unavailable normalized history entry.
- Ralph init/worker/reflection accounting failures persist `cost_accounting_failed`, preserve state/worker edits, and launch no later session.
- Ralph ledger persists provider session IDs.
- Jira and glab create no cost entries.
- Cost history rejects legacy rows; newly written sessions round-trip.
- Existing `cost-breakdown` rendered output remains unchanged for valid new entries.

## Acceptance criteria

1. Pi accounting matches the completed Pi session JSONL, not text estimates or root-level stream-event guesses.
2. No implementation relies on `~/.pi`, `HOME`, or a persisted session-file path.
3. Pi temporary session files are deleted after every operation outcome.
4. Every persisted cost entry represents exactly one LLM provider operation.
5. New entries carry provider/model and, when available, provider session ID.
6. Actual, estimated, zero, and unavailable USD are unambiguous in persisted data.
7. All estimates use one built-in shared catalog; local providers are zero.
8. Non-Ralph accounting errors do not change feature success and are persisted as unavailable with sanitized diagnostics.
9. Ralph accounting errors pause with `cost_accounting_failed` and prevent later sessions.
10. Legacy generic cost history is rejected; no migration exists.
11. The existing generic cost-breakdown UI remains visually/semantically unchanged.
