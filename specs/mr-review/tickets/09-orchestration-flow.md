
# 09 — Full mr-review orchestration flow

## What to build

Wire together the complete §5 UX flow: `mole-tools mr-review <mr-url>` runs preflight → parse URL → discover+validate reviewers → interactive multi-select → fetch context → prune story-only agents when no Jira match → run agents via scheduler → parse findings + record per-agent cost → dedupe pass → summary + confirm prompt → publish on confirm → per-agent Ralph-style cost table. Registers as a `Feature` in the registry. Handles: zero selection, branch mismatch warning, agent failure isolation, user rejection of confirm.

## Blocked by

ALL of 01–08 — this is the glue that imports every other module

## Status

ready-for-agent

## Acceptance criteria

- [ ] Command parses a full GitLab MR URL positional arg; malformed URL → clear abort with exit non-zero
- [ ] Preflight (`glab` installed + authenticated) runs before any work; failure → clean abort
- [ ] Reviewer discovery from global + project dirs merges and validates; empty set → clear "no reviewers configured" error, exit non-zero
- [ ] Multi-select prompt shows each agent's name + description; user selects zero agents → exit 0 with a message, no fetch/run
- [ ] Context files fetched and written to `.mr-review/<iid>-<slug>/` before agents run
- [ ] Agents pruned: selected agents declaring `story` input but no Jira issue resolved are skipped with a warning; remaining agents proceed
- [ ] Current branch != MR source branch → warning printed, execution continues (no abort)
- [ ] Agents run under concurrency cap (`mrReview.concurrency`, default 2); at most one non-parallel agent in flight at any time
- [ ] Each completed agent has its output parsed via `parseFindingsJson` and written to `<subfolder>/<agent-id>.findings.json`; per-agent cost recorded
- [ ] Failed agents (LLM error, bad output) don't stop the run — remaining agents proceed, failed agents reported in summary
- [ ] Dedupe pass fires when ≥ 2 total findings; skipped when ≤ 1 finding or all agents failed
- [ ] Before publishing: summary shown (findings count by severity + by agent, which failed/skipped) + confirm prompt
- [ ] User rejects confirm → nothing posted; files remain on disk; cost table still printed
- [ ] User confirms publish → inline comments and global notes posted via GitHost with correct positioning (or as authored user if `authorUsername` configured)
- [ ] Cost table printed after run: per-agent rows (name, model, in/out tokens, USD + source), total row. Failed agents shown with zero/partial cost.
- [ ] Feature registered in `src/core/registry.ts` under name `"mr-review"`

## Test approach

**Test type:** integration (full flow wiring all fakes)
**Test file/area:** `src/features/mr-review/index.test.ts`
**Validate with:** `bun test src/features/mr-review/index.test.ts`, then full suite `bun test`

### Red-Green strategy

1. **Red**: Write a flow test where `FakeUiPort` returns zero agent selections. Assert the command exits cleanly without any GitHost calls or file writes. Fails because orchestrator doesn't exist yet.
2. **Green**: Implement preflight + URL parse + reviewer discovery + multi-select. Zero-selection path implemented first. Test passes.
3. **Red (full happy path)**: Write test wiring FakeGitHost, FakeLlm, FakeIssueTracker, FakeVcs, FakeUiPort for the full successful flow: one agent selected, context fetched, agent runs and returns findings, dedupe fires, confirm accepted, publish called. Assert final cost table structure. Fails because full flow not wired yet.
4. **Green**: Wire all steps in sequence. Test passes.
5. **Red (edge cases)**: Write tests for: user rejects confirm (assert no post calls); branch mismatch warning (assert log.warn but continues); agent failure isolation (one FakeLlm response returns error, another succeeds — assert both run, only success findings posted). Fails because edge paths not implemented yet.
6. **Green**: Add branch check warning, partial-failure resilience, confirm rejection handling. Tests pass. Regress full suite (`bun test`).
7. **Refactor**: Clean up flow structure while tests remain green. Extract UI summary rendering into a separate small helper if it grows past 20 lines. Run full suite and typecheck.

## Implementation notes

- Mirror `merge-request/index.ts`'s structure: a top-level function (`runMrReviewFlow`) that orchestrates steps, plus a `Feature` export with the CLI hook.
- The flow is imperative but each step delegates to a named module function: `discoverReviewers`, `fetchAndWriteContext`, scheduler's `runAgentsWithPolicy`, `dedupeFindings`, `publishFindings`. No monolith — the orchestrator sequences, modules implement.
- Agent execution: for each selected agent, build the prompt from its frontmatter inputs. If agent declares `'diff'`, read `diff.patch` and feed content to generate call. If `'story'`, feed `story.md`. If `'codebase'`, use `runAgent` on the agentic provider (already validated at load by ticket 02).
- Cost table: use `renderTable` from `src/shared/table-renderer.ts`. Columns: Agent, Model, In Tokens, Out Tokens, USD, Source. Total row at bottom. Data sourced from `ctx.costTracker.getEntries()`.
- Register in `registry.ts` after all code changes are done (keeps typecheck green throughout implementation).
- The `runMrReviewFlow` function returns the cost data so the outer CLI can format it, or renders it directly — follow whatever pattern merge-request uses.

## Out of scope

- Sub-module implementation details (covered by tickets 01–08)
- glab command implementations for new GitHost methods (handled by test fakes; real GlabAdapter wiring is part of this ticket but follows existing `_exec`/`PortError` pattern)

## Open questions

None
