# 01 — Define `LlmUsage`/`UsdCost` types and make `AgentResult.usage` required

## What to build

The abstract LLM usage contract from the spec is defined on the ports side and wired through every adapter. After this ticket, every call to `runAgent()` on any `Llm` implementation returns an `AgentResult` that carries structured token usage (`usage: LlmUsage`) and an optional USD cost (`usdCost?: UsdCost`).

This is foundational — all downstream cost-tracking code receives its input from these types.

## Blocked by

None — can start immediately.

## Status

ready-for-agent

## Acceptance criteria

- [ ] `src/ports/llm.ts` exports `LlmUsage` interface with `inputTokens`, `outputTokens`, optional `cacheReadTokens`/`cacheWriteTokens`, and `source: "reported" | "estimated"`
- [ ] `src/ports/llm.ts` exports `UsdCost` interface with `amount: number` and `source: "actual" | "estimated" | "zero"`
- [ ] `AgentResult.usage` is a **required** field of type `LlmUsage`
- [ ] `AgentResult.usdCost` is an optional field of type `UsdCost`
- [ ] `PiAdapter.runAgent()` returns a result with non-negative integer token counts and correct `usage.source`
- [ ] `OllamaAdapter.runAgent()` still throws `UnsupportedCapabilityError` (capability not supported) — no new usage obligation for the unsupported path
- [ ] `FakeLlm` returns valid `usage` in every scripted agent result so existing tests continue to pass

## Test approach

**Test type:** unit
**Test file/area:** `src/adapters/llm/pi.test.ts`, `src/adapters/llm/ollama.test.ts`, new or updated tests near the port definitions
**Validate with:** `bun test src/adapters/llm/pi.test.ts` and `bun test src/adapters/llm/ollama.test.ts`

### Red-Green strategy

1. **Red**: Write a unit test asserting that calling `runAgent()` on `PiAdapter` returns an `AgentResult` with a `usage` field of type `LlmUsage`. The types don't exist yet, so this won't compile or will fail at runtime.
2. **Green**: Add `LlmUsage` and `UsdCost` to `src/ports/llm.ts`; make `usage` required on `AgentResult`; update `PiAdapter.runAgent()` to return default usage (estimated from the actual input/output length); update `OllamaAdapter` if needed; update `FakeLlm` to include usage in its default result.
3. **Refactor**: Ensure the types are DRY — no duplicate interfaces between port and adapter files. Use `estimateTokens()` from `src/shared/text.ts` for defaults.

## Implementation notes

- File: `src/ports/llm.ts` — add the new interfaces and update `AgentResult`
- File: `src/adapters/llm/pi.ts` — after parsing JSON events in `handleEvent`, accumulate usage into local vars and attach them to the resolved result. Default to estimated counts from input/output text when provider events don't carry usage data.
- File: `src/adapters/llm/ollama.ts` — `runAgent()` throws, so no usage obligation. Only `generate()` is used today; that method's return type doesn't change (it yields strings).
- File: `test/fakes/FakeLlm.ts` — every `AgentResult` in `agentResultsList` must carry `usage`. Set sensible defaults like `{ inputTokens: 100, outputTokens: 50, source: "estimated" }`.
- Token estimation already exists via `estimateTokens()` in `src/shared/text.ts` (4 char/token approximation).
- All token counts must be non-negative integers — assert or coerce on construction.

## Out of scope

- Parsing provider-reported usage from Pi JSON events — that's ticket 02
- USD cost calculation or pricing catalog — that's ticket 03
- Ralph state ledger integration — that's tickets 04-06
- Terminal cost-summary output — that's tickets 05-06

## Open questions

None
