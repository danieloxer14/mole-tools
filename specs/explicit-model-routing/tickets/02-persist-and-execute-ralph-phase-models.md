# 02 — Persist and execute Ralph phase models

## What to build

Make a newly initialized Ralph loop durable and deterministic across all phases: it records configured `init`, `implement`, and `reflect` provider/model selections, generates its task plan with `init`, and later runs worker and reflection sessions with the corresponding persisted selections—even after global config changes.

## Blocked by

01 — Strict explicit model routing for commit and merge requests

## Status

ready-for-agent

## Acceptance criteria

- [ ] `RalphStateFileSchema` requires `models.init`, `models.implement`, and `models.reflect`, each containing non-empty `provider` and `name`; flat state `provider` and `model` are removed.
- [ ] `ralph init <name> <source>` no longer requires or persists `--model`; it resolves the three configured Ralph defaults, uses `models.init` for task generation, and persists all three selections atomically with the task file.
- [ ] Ralph worker calls use persisted `models.implement`, and reflection/final-review calls use persisted `models.reflect`; no Ralph run-time call consults live model routing.
- [ ] Invalid phase-state artifacts fail validation cleanly, and Ralph verifies the configured adapter supports workspace-agent capability before external work.
- [ ] Ralph CLI help and usage no longer require or show `--model`.

## Test approach

**Test type:** State-schema/persistence unit and fake-port feature-flow
**Test file/area:** `src/features/ralph/schema.test.ts`, `src/features/ralph/persistence.test.ts`, plus new Ralph init/run flow coverage using `test/fakes/FakeLlm.ts`
**Validate with:** `bun test src/features/ralph test/features/ralph*.test.ts`

### Red-Green strategy

1. **Red**: Change state fixtures to phase maps and write init/run flow tests that record three distinct phase requests, including a config change after init.
2. **Green**: Replace flat state fields and route init, implementation, and reflection calls through their persisted phase selection.
3. **Refactor**: Share the phase-model shape and request construction without reintroducing config fallback logic.

## Implementation notes

- Relevant files: `src/features/ralph/schema.ts`, `init.ts`, `run.ts`, `persistence.ts`, and `index.ts`.
- The existing `UiPort` and `FakeUiPort` already provide `editText`, but this ticket uses configured defaults only; interactive overrides belong to ticket 03.
- State/schema, init, and run must move together: removing flat fields otherwise leaves TypeScript/runtime references broken.

## Out of scope

Letting a user edit the three defaults during init.

## Open questions

None.
