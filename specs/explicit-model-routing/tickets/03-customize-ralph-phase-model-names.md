# 03 — Customize Ralph phase model names during init

## What to build

Let users customize the model name for each newly created Ralph phase without a CLI flag. Init asks task generation, implementation, and reflection questions in sequence, prefilled from the configured phase defaults; each phase retains its configured provider and the chosen names are the values persisted and subsequently executed.

## Blocked by

02 — Persist and execute Ralph phase models

## Status

ready-for-agent

## Acceptance criteria

- [ ] Ralph init asks exactly three sequential prefilled text questions: `Task generation model (init)?`, `Implementation model (implement)?`, and `Reflection model (reflect)?`.
- [ ] Each initial value comes from its corresponding `config.models.ralph` phase route, and each response must be a non-empty model name.
- [ ] The saved state preserves the configured provider for each phase and the user-entered name for that same phase.
- [ ] Task generation receives the chosen init name; a subsequent Ralph run receives the persisted chosen implementation/reflection names.
- [ ] CLI help/examples accurately describe model selection during init rather than a `--model` option.

## Test approach

**Test type:** Fake-UI and fake-LLM feature-flow
**Test file/area:** New `test/features/ralph-init.test.ts` (or colocated Ralph flow equivalent), using `FakeUiPort` transcript and `FakeLlm.agentRequests`
**Validate with:** `bun test test/features/ralph-init.test.ts src/features/ralph`

### Red-Green strategy

1. **Red**: Script three `editText` answers and assert their prompt/initial values, the generated task call’s init model, and the persisted phase map.
2. **Green**: Add the three sequential `UiPort.editText` calls and construct phase routes from configured providers plus entered model names.
3. **Refactor**: Extract the small phase-prompt sequence only if it improves readability while flow tests stay green.

## Implementation notes

- The approved prompt format is **model name only**. Do not add a provider picker or parse `provider/name` text; each phase retains its configured provider.
- `UiPort.editText(prompt, initial)` and scripted `FakeUiPort` support this without Ink component changes.
- Keep the flow linear per `specs/architecture/code-design.md` and surface blank input through existing Zod validation.

## Out of scope

Changing phase provider keys during init or adding a custom Ink multi-control screen.

## Open questions

None.
