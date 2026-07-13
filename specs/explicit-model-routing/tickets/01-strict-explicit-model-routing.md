# 01 — Strict explicit model routing for commit and merge requests

## What to build

Make explicit `{ provider, name }` model routes the only configuration contract for commit and merge-request generation. Fresh `mole-tools init` writes complete `providers` and `models` defaults; incomplete or invalid routes fail at config validation rather than silently selecting a fallback.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] Config accepts required `models.commit` and `models.mergeRequest` objects with non-empty `provider` and `name`, and no longer accepts `llm`, `models.default`, legacy `ollama.commitModel`/`mrModel`, or `@model:` routing syntax.
- [ ] Every model route is validated against `providers` at load/boot time; an unknown route reports its model path and missing provider key.
- [ ] `mole-tools init` writes Ollama and Pi connection defaults plus the commit, merge-request, and all three Ralph defaults required by the source spec.
- [ ] Commit and merge-request calls use their configured provider and model name with no hardcoded model fallback.
- [ ] README and ADR configuration guidance describe the explicit model shape; ADR 0003’s config decision is marked superseded while its capability-port decision remains valid.

## Test approach

**Test type:** Unit and feature-flow
**Test file/area:** `src/adapters/config/loader.test.ts`, schema resolver tests, `test/features/commit.test.ts`, and merge-request generation coverage
**Validate with:** `bun test src/adapters/config/loader.test.ts test/features/commit.test.ts src/features/merge-request`

### Red-Green strategy

1. **Red**: Add loader/schema cases for valid explicit routes, each prohibited legacy shape, and a missing provider reference; add fake-LLM assertions that commit/MR send the configured name.
2. **Green**: Replace legacy schema, migration, prefix parsing, and defaults with strict explicit route validation; update routing/context and feature generation call sites.
3. **Refactor**: Centralize typed route lookup so feature flows do not duplicate validation or fallback logic.

## Implementation notes

- Relevant seams: `src/adapters/config/schema.ts`, `src/adapters/config/loader.ts`, `src/core/context.ts`, `src/features/commit/index.ts`, and `src/features/merge-request/generate.ts`.
- Provider adapters are composed by `buildAdapterMap`; preserve the capability-aware `Llm` port.
- Current provider profile objects use an in-object discriminator, while the approved config examples identify providers by map key. Align the schema and template with the source specification.

## Out of scope

Ralph state persistence, runtime phase routing, and interactive phase-selection UX.

## Open questions

None.
