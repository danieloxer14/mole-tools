
# 01 — Config & port scaffolding for mr-review

## What to build

Extend the mole-tools config schema, GitHost port interface, prompt loader, and Context with all new shapes required by every downstream ticket. Lands green on `main` alone — existing features unaffected because no code calls the new paths yet.

## Blocked by

None — can start immediately

## Status

ready-for-agent

## Acceptance criteria

- [ ] `ModelsConfigSchema` includes optional `mrReview: ModelRouteSchema`
- [ ] `ConfigSchema` includes optional `mrReview: z.object({ concurrency: ..., authorUsername: ... })`
- [ ] `RoutingPurpose` union includes `"mrReview"`
- [ ] `validateModelProviders` checks `models.mrReview` when present
- [ ] `GitHost` interface declares six new methods: `parseMrUrl`, `fetchMr`, `fetchMrDiff`, `fetchDiscussions`, `postInlineComment`, `postNote` (plus any new types like `MrRef`, `MrDetails`, etc.)
- [ ] `PromptName` union includes `"mr-review-dedupe-system"` with default prompt text
- [ ] `Context.getLlmFor` accepts `"mrReview"` purpose and caches an `mrReviewProxy`
- [ ] `FakeGitHost` implements stubs for all six new methods
- [ ] `fakeContext.ts` widens `getLlmFor` type to include `"mrReview"`
- [ ] `CONFIG_TEMPLATE_TEXT` includes commented example of `models.mrReview` and `mrReview.concurrency`
- [ ] All existing tests (`bun test`) still pass green

## Test approach

**Test type:** unit (existing test suite + schema validation)
**Test file/area:** `src/adapters/config/schema.test.ts`, full suite via `bun test`
**Validate with:** `bunx tsc --noEmit && bun test`

### Red-Green strategy

1. **Red**: Add a test in `schema.test.ts` that parses a config with `models.mrReview` and `mrReview.concurrency` / `mrReview.authorUsername`. Fails because the schema doesn't include these keys yet.
2. **Green**: Extend `ModelsConfigSchema`, `ConfigSchema`, `RoutingPurpose`, prompt loader, GitHost port, fake classes. Schema test passes; existing tests still green.
3. **Refactor**: N/A — implementation is the refactor target

## Implementation notes

- Follow the existing pattern: `mergeRequest` purpose already exists in all these places — add `mrReview` beside it without changing existing paths.
- The new GitHost method types should be added to `src/ports/git-host.ts`. Mirror the granularity of existing methods (one verb per capability).
- Inline posting takes a position object with `{ baseSha, headSha, startSha, oldPath, newPath, newLine?, oldLine? }` plus body and optional author id.
- For the prompt, use `mr-review-dedupe-system` as the name (consistent with existing `*-system` naming). Default text should instruct the model: given N findings as JSON tagged by agent id, return one deduped JSON array of the same shape, preferring more specific/actionable wording when merging.
- `FakeGitHost` stubs can return empty results or throw `NotImplementedError`. The exact behavior is scripted by each downstream test's overrides.

## Out of scope

- Actual glab command implementations (ticket 07/08)
- Reviewer file parsing logic itself (ticket 02)
- Scheduling, diff-resolving, findings-parsing logic (tickets 03–06)

## Open questions

None
