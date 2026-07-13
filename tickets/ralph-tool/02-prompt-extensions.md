# 02 — Prompt extensions for Ralph prompts

## What to build

Extend the existing prompt loader (`src/adapters/prompts/loader.ts`) to support three new prompt types: `ralph-init-system`, `ralph-implement-system`, and `ralph-reflection-system`. Each default is seeded once when missing, never overwritten if user-edited, matching the existing loader convention.

## Blocked by

None — can start immediately. This module only touches the prompt file system, sharing conventions with ticket 01's types but no code dependency.

## Status

done

## Acceptance criteria

- [x] `PromptName` type in `src/adapters/prompts/loader.ts` is extended to include `"ralph-init-system"`, `"ralph-implement-system"`, `"ralph-reflection-system"`
- [x] Default prompt text for `ralph-init-system` is seeded from spec §4.1: instructs the agent to read source + repo, produce task-file Markdown with exact required headings (Goal, Deliverable, Task checklist, Stale-prompt guard, Completion gate, Iteration protocol), return only the Markdown
- [x] Default prompt text for `ralph-implement-system` is seeded from spec §7.2: "Implement the work described by the ticket. Use TDD where possible..." — instructs the agent to do TDD at pre-agreed seams, run typechecks and tests
- [x] Default prompt text for `ralph-reflection-system` is seeded from spec §4.2: asks 5 review questions (accomplished, working well, blocking, adjust approach, next priorities), instructs comparing task file + repo state + verification evidence, unchecking tasks when work is inadequate
- [x] When a `.md` file for any Ralph prompt already exists in the prompts directory and contains user-edited content, it is returned unchanged without being overwritten
- [x] Existing tests in `loader.test.ts` continue to pass; add test coverage for all three new prompt seeding scenarios

## Test approach

**Test type:** unit (filesystem-based, matching existing `loader.test.ts` pattern)
**Test file/area:** Extend `src/adapters/prompts/loader.test.ts` with Ralph prompt tests
**Validate with:** `bun test src/adapters/prompts/loader.test.ts`

### Red-Green strategy

1. **Red**: Write tests that call `loadPrompt("ralph-init-system", dir)` on an empty temp directory and assert the seeded content contains key phrases (e.g., "Task checklist", "Stale-prompt guard"); also test user-edited file is preferred
2. **Green**: Update `DEFAULT_PROMPTS` with the three new entries and extend `PromptName`; verify content matches spec wording
3. **Refactor**: Trim prompt text to be concise; ensure no state JSON is affected by prompt seeding (per spec §6.2: "No reflection prompt text is persisted")

## Implementation notes

- The existing `loadPrompt` function already handles seed-on-missing and return-existing — only `DEFAULT_PROMPTS` and `PromptName` need changes
- Prompt file naming: existing convention is `<name>.md` (e.g., `commit-system.md`) → `ralph-init-system.md`, `ralph-implement-system.md`, `ralph-reflection-system.md`
- The init prompt defaults must specify the exact section headings listed in §4.1 so downstream validation (ticket 03) has a deterministic contract
- Do not add any new functions to the loader — reuse the existing load/seed pattern

## Out of scope

- Loading prompts from non-default directories via config overrides
- Prompt content generation at runtime (that's the configured agent provider's job in ticket 05)

## Open questions

- None
