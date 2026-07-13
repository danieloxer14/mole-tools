# 04 — Handle failed removal with optional loss summary

## What to build

For every worktree whose normal removal failed, show a best-effort summary of potentially lost local changes when Ollama is available, then ask separately whether to force-remove that exact worktree. A summary failure must never prevent the user from accepting or declining the force-delete prompt.

## Blocked by

03 — Discover and normally prune selected worktrees

## Status

ready-for-agent

## Acceptance criteria

- [ ] Each normal-removal failure gets an individual `UiPort.confirm` prompt that clearly names the affected worktree.
- [ ] Before that prompt, the flow requests a summary based on the failed worktree's `git status --short` and `git diff --stat` snapshot when LLM generation succeeds.
- [ ] If the user accepts, only that worktree is removed with `git worktree remove --force`; if declined, it remains untouched.
- [ ] Ollama unavailability, snapshot failure, malformed/failed generation, or an empty summary does not block the confirmation prompt or other failed worktrees.
- [ ] The final user-visible result distinguishes normal removals, force removals, retained worktrees, and failures that remain unresolved.

## Test approach

**Test type:** feature unit tests with fake VCS, LLM, and UI ports
**Test file/area:** new `src/features/worktree-prune/summary.test.ts` and additions to `src/features/worktree-prune/index.test.ts`; `test/fakes/FakeLlm.ts`
**Validate with:** `bun test src/features/worktree-prune/summary.test.ts src/features/worktree-prune/index.test.ts`

### Red-Green strategy

1. **Red**: Write tests for summary shown, LLM/snapshot failure bypass, force acceptance, force decline, force-removal failure, and multiple independent fallback decisions.
2. **Green**: Add a small summary helper using `Context.llm` and its configured text-generation provider/model, wrapping all nonessential summary work in best-effort error handling; then connect it to ticket 03's recorded failures.
3. **Refactor**: Isolate the summary helper from destructive control flow so deletion safety is governed only by the explicit per-worktree confirmation.

## Implementation notes

- `Context` already exposes `llm` and `config.ollama`; `UiPort.stream()` is the established way to consume generated text, while `FakeLlm` supports deterministic tests.
- Ticket 01's VCS change-snapshot operation is deliberately separate from this LLM helper.
- Treat a summary as informational only: never imply that it is complete, and never automatically force-remove.
- Continue processing failures independently, matching the spec's batch resilience requirement.

## Out of scope

- Alternative LLM providers, retries, or mandatory summarization.
- Additional confirmations for normal deletion.
- Changes to repository discovery or configuration precedence.

## Open questions

None.
