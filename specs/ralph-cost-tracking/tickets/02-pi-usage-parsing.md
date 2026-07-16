# 02 — Parse Pi JSON usage events and estimate missing usage

## What to build

The Pi adapter extracts real token counts from provider-reported JSON lifecycle events when they are present. When the provider omits usage data, it falls back to estimating input tokens from the actual agent prompt text and output tokens from captured assistant output. A provider-reported actual USD charge (when available) is preserved in `usdCost` with source `"actual"` and is never overwritten.

Every resolved `AgentResult` from `PiAdapter.runAgent()` carries correct `usage.source` (`"reported"` when extracted, `"estimated"` when estimated) and the optional `usdCost`.

## Blocked by

01 — requires the `LlmUsage`/`UsdCost` types to exist on `AgentResult`

## Status

ready-for-agent

## Acceptance criteria

- [ ] When Pi JSON events contain token usage data, `usage.source` is `"reported"` and counts reflect provider values
- [ ] When Pi JSON events omit usage data, `usage.source` is `"estimated"` and counts are derived from the actual input/output text using `estimateTokens()`
- [ ] Provider-reported actual USD charges (if present in JSON events) are carried through as `usdCost` with source `"actual"` and never replaced by an estimate
- [ ] Cache read/write tokens are captured when provider reports them; absent when provider doesn't report
- [ ] All token counts are non-negative integers regardless of source

## Test approach

**Test type:** unit
**Test file/area:** `src/adapters/llm/pi.test.ts` — add fixtures for both reported and missing-usage scenarios
**Validate with:** `bun test src/adapters/llm/pi.test.ts`

### Red-Green strategy

1. **Red**: Write two unit tests: (a) feed simulated Pi JSON event lines that include token usage and assert the returned `AgentResult.usage.source` is `"reported"` with correct counts; (b) feed event lines without usage data and assert `usage.source` is `"estimated"`. Both will fail because extraction logic isn't implemented yet.
2. **Green**: In `PiAdapter.runAgent()`, accumulate token counts from parsed JSON events in `handleEvent()` — look for a usage/event type that carries token data. After the child closes, if no provider usage was found, estimate from the input text (the built agent prompt) and the captured assistant output. Attach `usdCost` from provider when present.
3. **Refactor**: Extract usage-parsing logic into a small helper method so `runAgent()` stays focused on subprocess management.

## Implementation notes

- File: `src/adapters/llm/pi.ts` — main work is in the `handleEvent()` callback and result assembly at `child.on("close")`. The Pi JSON mode (`--mode json`) emits structured events; look for a usage or metadata event type that carries token counts.
- The existing `estimateTokens()` from `src/shared/text.ts` provides the fallback. Input length is the text sent to stdin (`buildAgentInput(result)`). Output length is the accumulated assistant response text in `output`.
- Provider USD reporting: Pi may include a usage cost in its JSON events. If present, attach it as `{ amount: …, source: "actual" }`. Do NOT calculate an estimate here — that's ticket 03's job on the shared layer.
- Test fixtures: create arrays of JSON-like strings simulating Pi output (e.g., `{"type":"usage","inputTokens":1234,"outputTokens":567}` and events without such fields).

## Out of scope

- Model-price catalog or USD estimation from token counts — that's ticket 03
- Ralph ledger persistence — that's tickets 04-06
- Terminal summary output — that's tickets 05-06

## Open questions

None
