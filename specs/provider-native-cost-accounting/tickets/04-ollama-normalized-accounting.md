# 04 — Normalize Ollama results and LLM test fakes

## What to build

Have Ollama and test fakes produce the same provider-neutral accounting result as Pi, using reported evaluation counts when present and explicit estimated usage only when absent. Local-provider USD comes from shared zero pricing.

## Blocked by

01 — Establish normalized LLM accounting foundation

## Status

ready-for-agent

## Acceptance criteria

- [x] Ollama maps reported evaluation counts to normalized usage and only marks usage estimated when counts are absent.
- [x] Ollama receives a `zero` USD outcome through the shared catalog, not a feature-specific branch.
- [x] Fake LLM results can provide usage, USD provenance, and provider session IDs required by consumer tests.
- [x] No feature-level accounting branch distinguishes Pi from Ollama.

## Test approach

**Test type:** adapter/unit  
**Test file/area:** `src/adapters/llm/ollama.test.ts`, `test/fakes/FakeLlm.ts`  
**Validate with:** `bun test src/adapters/llm/ollama.test.ts`

### Red-Green strategy

1. **Red:** Add reported/missing-count, zero-provenance, and fake-result consumer cases.
2. **Green:** Map Ollama and fakes to the normalized contract.
3. **Refactor:** Remove obsolete adapter-specific accounting assumptions.

## Implementation notes

- Adapter contract: `src/ports/llm.ts`; implementation: `src/adapters/llm/ollama.ts`.

## Out of scope

Adding Claude or Codex adapters.

## Open questions

None.
