# 01 — Commit: add user-supplied generation context

## What to build

Make `mole-tools commit --context <text>` guide the generated commit message for
this invocation. The command must validate non-blank text, show the option in
help, render it as an `Additional user context` guiding-instruction section
before Jira and staged-diff evidence, and retain it across format retries.

Expose the same optional context on `runCommitFlow` so the merge-request flow
can later reuse it for its staged-change commit detour.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] `commit` accepts optional non-blank `context`; whitespace-only input fails Zod validation before the feature flow runs.
- [ ] The commit prompt includes `Additional user context:` immediately after the loaded commit prompt and before optional Jira details and the changelog.
- [ ] Omitting context leaves the existing prompt sections unchanged and adds no empty context label.
- [ ] Internal newlines and repeated spaces in valid context reach the prompt; no tool-level length cap or persistence is introduced.
- [ ] All commit-message format retry requests retain the same context section.
- [ ] `runCommitFlow` accepts and forwards optional context without changing existing callers' push behavior.
- [ ] `mole-tools help commit` documents `--context`, its purpose, and an example through Zod argument metadata.

## Test approach

**Test type:** Unit and feature tests
**Test file/area:** `src/features/commit/prompt.test.ts`, `test/features/commit.test.ts`; extend help-format coverage only if existing generic coverage cannot assert the feature metadata.
**Validate with:** `bun test src/features/commit/prompt.test.ts test/features/commit.test.ts && bun test && bun run lint && bun run build`

### Red-Green strategy

1. **Red:** Add prompt-builder tests for labelled section presence, ordering, and omission; add feature tests for context reaching every `FakeLlm` retry and rejecting blank parsed arguments.
2. **Green:** Add the optional Zod argument and metadata, extend `CommitFlowOptions`, and pass context from `commit.run` through `runCommitFlow` into `buildCommitPrompt`.
3. **Refactor:** Keep section assembly local to the prompt builder and preserve existing call behavior through an optional parameter.

## Implementation notes

- `src/index.tsx` derives `--<schema key> <value>` options from each feature's Zod object; no CLI parser change is required.
- `src/features/help/format.ts` renders option descriptions and examples from Zod `.describe()` and `.meta({ examples })`.
- `src/features/commit/index.ts` already owns `CommitFlowOptions`, builds the prompt once before `generateValid`, and retries generation with that prompt.
- `src/features/commit/prompt.ts` already assembles the feature prompt, optional Jira issue, and filtered staged diff in order.
- This is invocation-scoped **User-supplied generation context** as defined in `CONTEXT.md`; do not write it to config, Git, or cost history.

## Out of scope

- Merge-request command arguments and MR prompt rendering.
- Changing system prompts, provider/model routing, format rules, confirmation UX, or commit/push semantics.
- Repeated-option semantics or a custom maximum context length.

## Open questions

None.
