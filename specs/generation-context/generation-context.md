# User-Supplied Generation Context

**Status:** Grilled / agreed. Not implemented.
**Date:** 2026-07-14
**Companions:** [../../CONTEXT.md](../../CONTEXT.md), [../commit/commit-tool.md](../commit/commit-tool.md), [../merge-request/merge-request-tool.md](../merge-request/merge-request-tool.md)

## Goal

Add an optional `--context <text>` option to both `mole-tools commit` and
`mole-tools merge-request`. It supplies invocation-scoped user guidance to the
LLM so callers can influence the generated commit message or merge-request
title and description without changing configured prompt files.

Examples:

```sh
mole-tools commit --context "This is the final step of the billing migration."
mole-tools merge-request --context "Emphasize the rollout plan and customer impact."
```

## Resolved decisions

| Decision | Outcome |
|---|---|
| Commands | Both `commit` and `merge-request` expose the same single-value `--context <text>` option. |
| Input validation | The option is optional; when supplied it must contain non-whitespace text. Internal whitespace is preserved. There is no tool-level length cap. |
| Lifetime | Context is used only for the current command invocation. It is not written to config, Git, cost history, or other persistent state. |
| Prompt semantics | The prompt builder renders a clearly labelled `Additional user context` section immediately after the feature prompt. It is guiding instruction, not source evidence. Jira, commit, and diff evidence follow it. |
| MR commit detour | If `merge-request --context` finds staged changes, the exact same context is forwarded to `runCommitFlow` and guides the generated commit message as well as the later MR generation. |
| Retries | Every LLM retry receives the same fully built prompt, including the supplied context. |
| Non-LLM paths | The flag does not change preflight, branch/existing-MR guards, Git/Jira collection, reviewer selection, editing, confirmation, or creation. If generation is never reached, context has no effect. |
| Edited output | User edits remain trusted as-is; context does not cause another generation or format-validation pass. |

No ADR is needed: this is a reversible, local command-input extension with no architectural trade-off.

## Design

### Arguments and help

Replace each feature's empty Zod argument object with a shared-compatible shape:

```ts
const args = z.object({
  context: z
    .string()
    .trim()
    .min(1, "--context must not be blank")
    .optional()
    .describe("Extra guidance for the generated output")
    .meta({ examples: ["Emphasize the migration risk and rollout plan."] }),
});
```

Use the parsed value for prompt construction. The CLI already derives options
from feature Zod schemas in `src/index.tsx`, and the help formatter already
renders descriptions and examples from schema metadata. Update each feature's
usage and examples to visibly document `--context`.

`trim()` is solely validation normalization: prompt rendering receives the
validated string value. The implementation must not impose a maximum length or
persist it.

### Prompt rendering

Introduce an optional `context?: string` parameter to both prompt-builder
inputs. Preserve the existing sections and insert this section directly after
the loaded feature prompt:

```text
Additional user context:
<verbatim supplied text>
```

Commit ordering:

1. loaded `commit-system` prompt;
2. optional additional user context;
3. optional Jira work-item details;
4. staged changelog.

Merge-request ordering:

1. loaded `mr-system` prompt;
2. optional additional user context;
3. optional Jira work-item details;
4. commits ahead of the base;
5. merge-base diff;
6. existing title/body output contract.

The label distinguishes caller guidance from repository-derived evidence while
letting it influence the LLM result as requested.

### Flow propagation

Extend the reusable commit flow options:

```ts
export interface CommitFlowOptions {
  askToPush?: boolean;
  context?: string;
}
```

`commit.run(ctx, args)` passes `args.context` to `runCommitFlow`. The flow
passes it to `buildCommitPrompt` before `generateValid`; no change is needed in
`generateValid`, so each retry automatically uses the same prompt.

Extend the MR flow to accept its parsed optional context, pass it in the
`GenerateMergeRequestInput`, and forward it to `runCommitFlow` when staged
changes require the commit detour. `generateMergeRequest` passes it to
`buildMergeRequestPrompt`; its existing retry loop retains the resulting prompt
for every attempt.

## Implementation plan

1. **Commit arguments and flow** — `src/features/commit/index.ts`
   - Define the optional validated `context` argument with help metadata.
   - Add `context?: string` to `CommitFlowOptions`.
   - Pass it from the feature entry point through `runCommitFlow` to
     `buildCommitPrompt`.
   - Add a help note/example describing context as temporary generation
     guidance.

2. **Commit prompt** — `src/features/commit/prompt.ts`
   - Add `context?: string` to `buildCommitPrompt`.
   - Render the labelled context section after `system` and before Jira/diff
     sections only when it is supplied.

3. **MR arguments and flow** — `src/features/merge-request/index.ts`
   - Define the matching optional validated `context` argument and help
     metadata.
   - Change `runMergeRequestFlow(ctx)` to accept options (or a dedicated typed
     input) containing `context?: string`.
   - Forward it to the staged-change `runCommitFlow` call and to
     `generateMergeRequest`.
   - Pass `args.context` from `mergeRequest.run`.

4. **MR generation and prompt** — `src/features/merge-request/generate.ts`,
   `src/features/merge-request/prompt.ts`
   - Add `context?: string` to `GenerateMergeRequestInput` and
     `MergeRequestPromptInput`.
   - Render the same labelled context section after `system` and before Jira,
     commits, diff, and output-contract sections.

5. **Tests and help**
   - Extend `src/features/commit/prompt.test.ts` and
     `src/features/merge-request/prompt.test.ts` to assert presence and exact
     ordering of context, plus unchanged output when omitted.
   - Extend `test/features/commit.test.ts` to confirm feature-level context
     reaches the LLM prompt.
   - Extend `src/features/merge-request/index.test.ts` to confirm context
     reaches the MR prompt and is inherited by a staged-change commit detour.
   - Add feature/help formatter tests as needed to verify both commands show
     `--context`, its description, and example.
   - Add validation tests for whitespace-only context and valid multi-word
     context.

## Acceptance criteria

1. `mole-tools commit --context "Explain the compatibility reason"` includes a
   labelled `Additional user context` section before Jira and diff evidence in
   the commit LLM prompt.
2. `mole-tools merge-request --context "Focus on operational impact"` includes
   that section before Jira, commits, diff, and the output contract in the MR
   LLM prompt.
3. Calling either command without `--context` produces the existing prompt
   structure with no empty context section.
4. A whitespace-only `--context` fails schema validation and does not enter the
   feature flow.
5. Context with internal newlines or repeated spaces is accepted and rendered
   without a tool-imposed size limit.
6. An MR invocation with staged changes forwards its context to both the
   generated commit message and the MR generation.
7. Invalid generated commit/MR titles retain context on all existing retry
   attempts.
8. Context affects no persistence or non-LLM behavior.
9. `mole-tools help commit` and `mole-tools help merge-request` document the
   option and show an example.

## Validation

```sh
bun test
bun run lint
bun run build
```

## Open questions

None.
