# 02 — Add base-directory configuration and command entry

## What to build

Expose the top-level `mole-tools worktree-prune` command and resolve its scan directory in the promised order: `--baseDir`, then `worktreePrune.baseDir`, then an interactive prompt whose accepted value is saved for later runs. A command with no pruneable items exits cleanly and explains that there is nothing to prune.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] `ConfigSchema` and the default config template support optional `worktreePrune.baseDir`.
- [ ] `worktree-prune --baseDir <path>` uses the supplied value only for the current invocation and does not rewrite saved config.
- [ ] Without the flag, a saved `worktreePrune.baseDir` is used without an input prompt.
- [ ] With neither source available, the command prompts using `UiPort.editText`, persists the chosen base directory, and uses it for the current invocation.
- [ ] The command is registered with documented `baseDir` option metadata and reports an empty/no-prunable result without attempting deletion.

## Test approach

**Test type:** feature and config integration tests with fakes
**Test file/area:** new `src/features/worktree-prune/index.test.ts`; `src/adapters/config/loader.test.ts`; `src/features/help/format.test.ts`
**Validate with:** `bun test src/features/worktree-prune/index.test.ts src/adapters/config/loader.test.ts src/features/help/format.test.ts`

### Red-Green strategy

1. **Red**: Write feature tests for all three resolution priorities, asserting prompt transcript and persisted-config behavior, plus an empty-result command run.
2. **Green**: Add the config field/template, a narrowly testable config update seam, and register a minimal `Feature` with a Zod `baseDir` argument.
3. **Refactor**: Keep resolution independent from discovery/removal orchestration so later tickets can call it without reimplementing precedence rules.

## Implementation notes

- Features are registered in `src/core/registry.ts`; `src/index.tsx` derives command options from the feature Zod schema.
- Config currently loads through `src/adapters/config/loader.ts`; it has no update operation, so introduce the smallest testable persistence seam rather than writing configuration ad hoc in the feature.
- `UiPort.editText()` and `FakeUiPort` are established prompt seams.
- Help tests already contain a synthetic `worktree-prune` example using the `baseDir` camel-case option; preserve the CLI's existing option naming convention.

## Out of scope

- Recursive repository discovery and real worktree deletion.
- Force-delete prompts and LLM summaries.

## Open questions

None.
