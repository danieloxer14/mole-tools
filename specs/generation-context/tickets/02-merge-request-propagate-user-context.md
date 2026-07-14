# 02 — Merge request: propagate user-supplied generation context

## What to build

Make `mole-tools merge-request --context <text>` guide generated merge-request
title and body for the current invocation. It must render the labelled context
section after the MR feature prompt and before Jira, commits, merge-base diff,
and the output contract. When staged changes trigger the reusable commit flow,
forward the exact same context to that generated commit message.

## Blocked by

01 — Commit: add user-supplied generation context

## Status

ready-for-agent

## Acceptance criteria

- [ ] `merge-request` accepts the optional non-blank context argument and rejects whitespace-only input through its Zod schema.
- [ ] The MR LLM prompt renders `Additional user context:` immediately after the loaded MR prompt and before Jira, commit, diff, and output-contract sections.
- [ ] Omitting context preserves the existing MR prompt structure with no empty section.
- [ ] Context is retained for every MR title-format retry.
- [ ] If staged changes invoke `runCommitFlow`, the same supplied context appears in both the commit and later MR LLM prompts.
- [ ] Existing host preflight, branch/existing-MR guards, Git/Jira collection, reviewer selection, editing, confirmation, and MR creation behavior remain unchanged.
- [ ] `mole-tools help merge-request` documents `--context`, its purpose, and an example through Zod argument metadata.

## Test approach

**Test type:** Unit and feature-flow tests
**Test file/area:** `src/features/merge-request/prompt.test.ts`, `src/features/merge-request/generate.test.ts`, and `src/features/merge-request/index.test.ts` using existing fakes.
**Validate with:** `bun test src/features/merge-request && bun test && bun run lint && bun run build`

### Red-Green strategy

1. **Red:** Add prompt ordering/omission tests, a generation-retry assertion, and a staged-change flow test that inspects `FakeLlm.requests` for identical context in the commit and MR prompts.
2. **Green:** Add the MR Zod argument and help metadata; thread optional context through `runMergeRequestFlow`, `GenerateMergeRequestInput`, and `MergeRequestPromptInput`; pass it to the ticket-01 commit-flow option.
3. **Refactor:** Keep the context optional at every interface boundary and avoid duplicating commit prompt construction or generation logic.

## Implementation notes

- `src/features/merge-request/index.ts` currently has an empty args schema, calls `runCommitFlow(ctx, { askToPush: false })` for staged changes, and passes issue/commits/diff to `generateMergeRequest`.
- `src/features/merge-request/generate.ts` builds one prompt before its existing three-attempt title validation loop.
- `src/features/merge-request/prompt.ts` is the current ordered assembly point for system prompt, Jira, commits, diff, and output contract.
- `FakeLlm`, `FakeVcs`, and `FakeUiPort` already support feature-flow assertions without GitLab or provider integration.
- Use the optional `context` support delivered by ticket 01; its commit-flow forwarding is the genuine dependency.

## Out of scope

- Changing the user-supplied context contract from ticket 01.
- Persisting context, changing MR provider/model routing, or changing GitLab, reviewer, draft, or dynamic-environment behavior.
- Re-generating edited title/body output.

## Open questions

None.
