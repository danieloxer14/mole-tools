# 00 — Capability-aware LLM port and provider routing

## What to build

Extend the existing `Llm` abstraction so every feature can select a configured provider without importing a concrete adapter. Text-only flows use generation; workspace-agent flows use the agent operation. Unsupported capabilities fail at feature preflight with a clear error.

## Blocked by

None. This ticket blocks Ralph tickets 05–07.

## Status

completed (reviewed 2026-07-13)

## Acceptance criteria

- [ ] `src/ports/llm.ts` defines provider-neutral `GenerateRequest` and `AgentRequest` contracts plus `LlmCapability` values including `text-generation` and `agentic-workspace`.
- [ ] The `Llm` port exposes text generation and agent execution, reports supported capabilities, and rejects unsupported operations with a typed `UnsupportedCapabilityError`.
- [ ] `AgentRequest` is semantic: purpose, optional persisted provider selection, model, workspace, permission policy, system-prompt replacement/append mode, prompt, and cancellation signal. It contains no Pi CLI flags or provider-specific paths.
- [ ] Config selects a provider and model per feature: `commit`, `mergeRequest`, and `ralph`; provider connection settings live under `providers`.
- [ ] `buildContext` routes each request to its configured provider, or resolves an opaque persisted provider selection for a resumed Ralph loop. Features select their purpose (`commit`, `mergeRequest`, or `ralph`) but never import, branch on, or construct a provider.
- [ ] `OllamaAdapter` supports `text-generation` and rejects `agentic-workspace` before any network request.
- [ ] Add `PiAdapter` under `src/adapters/llm/`. It translates semantic generation/agent requests to Pi's non-interactive subprocess protocol, captures output and diagnostics, maps failures to `PortError`, and forwards cancellation to the child process.
- [ ] `PiAdapter` maps the semantic auto-approve permission policy to Pi's `--approve`; that flag does not leak into the port or feature layers.
- [ ] `FakeLlm` scripts both text and agent responses, including unsupported-capability and failure paths.
- [ ] Existing commit and merge-request flows retain their behavior with Ollama defaults; changing their configured provider requires no flow changes.

## Test approach

**Test type:** port/adapter unit tests plus feature e2e tests using `FakeLlm`.

**Test file/area:** `src/ports/llm.test.ts`, `src/adapters/llm/pi.test.ts`, `src/adapters/config/{schema,loader}.test.ts`, `test/fakes/FakeLlm.ts`, and existing commit/MR feature tests.

**Validate with:** `bun test src/ports/llm.test.ts src/adapters/llm/pi.test.ts src/adapters/config test/features/commit.test.ts src/features/merge-request`

## Implementation notes

- Keep the existing streaming `generate()` behavior for text flows so `UiPort.stream()` remains unchanged.
- `runAgent()` should return enough structured lifecycle data for Ralph: collected output, stderr/diagnostics, and successful completion. The adapter owns subprocess mechanics.
- Ralph's `--model` remains required and overrides/supplies the model for its `ralph` provider profile. Persist both provider and model in loop state so a resumed loop is deterministic.
- Provider profiles are a discriminated Zod union. A minimal default config uses Ollama for commit and merge-request and Pi for Ralph.

## Out of scope

- Implementing Claude or Codex adapters. The capability contract and provider routing are the extension seam.
- Provider fallback or automatic provider selection.
