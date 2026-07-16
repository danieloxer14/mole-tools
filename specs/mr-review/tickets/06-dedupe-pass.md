
# 06 — Dedupe pass (built-in LLM-driven agent)

## What to build

A built-in deduplication pass that runs after all selected reviewer agents complete. When total findings across agents ≥ 2, route all findings as JSON to the `mrReview` model with the `mr-review-dedupe-system` prompt. Parse output defensively. If ≤ 1 finding, skip the LLM entirely and return input unchanged. On unparseable or empty output, throw a fatal error (aborts before publish). Records cost via `CostTracker`.

## Blocked by

01 (config scaffolding with `mrReview` purpose), 04 (findings type + parser)

## Status

ready-for-agent

## Acceptance criteria

- [ ] When `dedupeFindings(ctx, findings)` receives ≤ 1 finding, it returns the input unchanged without any LLM call (assert `FakeLlm.requests.length === 0`)
- [ ] When ≥ 2 findings, it calls `ctx.getLlmFor("mrReview")` with the loaded `mr-review-dedupe-system` prompt and all findings as JSON payload
- [ ] Valid LLM output parsed back via `parseFindingsJson` → returned as deduped array
- [ ] Unparseable or empty LLM output → throws fatal error (run aborts before confirm/publish)
- [ ] Cost entry recorded with `task: "mr-review-dedupe"` regardless of skip vs. call

## Test approach

**Test type:** unit (fake-backed)
**Test file/area:** `src/features/mr-review/dedupe.test.ts`
**Validate with:** `bun test src/features/mr-review/dedupe.test.ts`

### Red-Green strategy

1. **Red**: Write a test using `fakeContext({ llm: new FakeLlm() })` that calls `dedupeFindings(ctx, [finding1])`. Assert exactly zero LLM requests and output equals input. Fails because function doesn't exist yet.
2. **Green**: Implement the ≤ 1 finding early return path. Test passes.
3. **Red (LLM call)**: Write test with 2 findings asserting that `FakeLlm.requests.length === 1` after dedupe, and that the prompt contains both findings' descriptions. Fails because LLM call path not implemented yet.
4. **Green**: Implement LLM call with loaded system prompt + JSON payload of all findings tagged by agent category. Parse output via import from `findings.ts`. Cost record with task `"mr-review-dedupe"`. Test passes.
5. **Red (fatal)**: Write test where `FakeLlm` returns garbage. Assert that dedupe throws. Fails because fatal error path not implemented yet.
6. **Green**: Add fatal check — if parsed output is empty or non-array, throw with clear message. Fatal test passes. Regress full suite.
7. **Refactor**: N/A — implementation is the refactor target

## Implementation notes

- Load the prompt via `loadPrompt("mr-review-dedupe-system")` from `src/adapters/prompts/loader.ts`.
- The LLM call uses `generate` (not `runAgent`) — it's a simple text-in/text-out transformation.
- Input format: all findings as a JSON array where each item has its `category` field set to the agent id that produced it. The system prompt instructs the model to merge near-duplicate clusters, prefer more specific/actionable wording, collapse same-line-same-problem findings, and return one clean JSON array.
- Cost recording: build the `CostEntry` from whatever usage data the LLM adapter returns (or estimate via catalog if provider-native not available). This follows existing patterns in `cost-accounting.ts`.

## Out of scope

- Agent scheduling (ticket 03)
- Publishing findings (ticket 08)
- Reviewer file parsing (ticket 02)

## Open questions

None
