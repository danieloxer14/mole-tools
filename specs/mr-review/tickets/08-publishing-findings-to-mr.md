
# 08 — Publishing findings to the MR

## What to build

Post all collected (and deduped) findings back to the GitLab MR. For critical/important/minor findings: resolve inline position via diff-line-resolver using fetched sha refs, post as inline comment, or fall back to global note if line not resolvable. Collapse all `recommendation`-tier findings into one grouped note, sub-grouped by agent. Render eligible suggestions as GitLab `` ```suggestion:... ``` `` blocks. Resolve the optional `mrReview.authorUsername` config at publish start — if set, look up the user id and post comments as that user; if resolution fails, abort with a clear error.

## Blocked by

01 (GitHost port + stubs), 05 (diff-line resolver)

## Status

ready-for-agent

## Acceptance criteria

- [ ] Each critical/important/minor finding with a resolvable file+line is posted as an inline comment via `postInlineComment` with the correct position `{ baseSha, headSha, startSha, newPath, newLine?, oldLine? }`
- [ ] Findings whose line cannot be resolved against the diff fall back to `postNote` (global MR note)
- [ ] All recommendation-tier findings are collapsed into one grouped note body, sub-grouped by agent name (e.g., "### Correctness" + findings list under that heading), posted via `postNote`
- [ ] Findings with a clean in-diff `suggestion` field (no nested triple-backticks, contiguous range) render as a GitLab `` ```suggestion:-0+N ``` `` block in the comment body ("Apply suggestion" button)
- [ ] Findings whose suggestion contains nested triple-backticks are NOT suggestion-eligible; posted as normal description text instead
- [ ] When `mrReview.authorUsername` is configured and resolves to a valid GitLab user, all comments post with that user as author
- [ ] When `mrReview.authorUsername` is configured but resolution fails, publishing aborts with a clear error naming the unresolvable username (no partial posting)
- [ ] When `mrReview.authorUsername` is absent, comments post as the authenticated glab user

## Test approach

**Test type:** unit (fake-backed)
**Test file/area:** `src/features/mr-review/publish.test.ts`
**Validate with:** `bun test src/features/mr-review/publish.test.ts`

### Red-Green strategy

1. **Red**: Write a test using extended `FakeGitHost` that posts a critical finding. Call `publish(ctx, findings, context)`. Assert that `postInlineComment` was called with expected position and body. Fails because publish function doesn't exist yet.
2. **Green**: Implement inline posting path: iterate severity-tiered findings, resolve line via diff-line-resolver import, call `postInlineComment`. Test passes.
3. **Red (fallback)**: Write test with a finding whose filePath/line isn't in the diff. Assert `postNote` is called instead (and NOT `postInlineComment`). Fails because fallback not implemented yet.
4. **Green**: Add unresolvable-line fallback. Test passes.
5. **Red (grouped)**: Write test with multiple recommendation-tier findings across agents. Assert one `postNote` call containing sub-grouped body by agent name. Fails because grouping not implemented yet.
6. **Green**: Implement recommendation collapse + grouped note body formatting. Test passes.
7. **Red (author)**: Write test where FakeGitHost has `resolveHandle` scripted to return a user id for the configured username. Assert that `postInlineComment`/`postNote` calls include the resolved userId as author. Separately test that unresolvable username throws before any post call.
8. **Green**: Implement author resolution at publish start — resolve via `ctx.gitHost.resolveHandle(config.mrReview?.authorUsername ?? "")`, store userId, pass to each post method. Aborts if configured but unresolved. Test passes. Regress full suite.
9. **Refactor**: Extract the suggestion-eligibility check into a named helper (`isSuggestionEligible`) if it's more than two lines. Run full suite green.

## Implementation notes

- The publish function signature: `publishFindings(ctx: Context, findings: ParsedFinding[], runContext: RunContext)`. The run context includes the fetched diffRefs (shas), author userId if configured, and any metadata needed for posting.
- Inline position construction: merge resolved `{ new_line?, old_line? }` from diff-line-resolver with the fetched base/head/start sha + file path from the finding's `filePath`.
- Suggestion eligibility: mirror mr-reviewer's heuristic — suggestion must not contain nested triple-backticks, and the line range should be contiguous within a hunk. When eligible, wrap in `` ```suggestion:-oldLines+newLines ``` `` block format that GitLab renders as an "Apply suggestion" button.
- Grouped note body: Markdown headings per agent name (`### <agent-name>`), bullet list of descriptions under each heading. One `postNote` call for all recommendations.
- Author resolution: at publish start, if `config.mrReview?.authorUsername` is set, call `ctx.gitHost.resolveHandle(username)`. If it returns null or throws, abort with clear error. Otherwise extract the user id and pass it to each post method. This MUST happen before ANY comment is posted — no partial posting on author failure.
- Each post method in the extended GitHost interface takes an optional `authorId?: string | number` parameter. When absent, posts as authenticated user.

## Out of scope

- Agent scheduling and running (ticket 03/09)
- Diff fetching from GitLab (ticket 07)
- Deduplication logic (ticket 06)

## Open questions

None
