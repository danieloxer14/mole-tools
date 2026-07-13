# Grill Me Results

Generated: 2026-07-09T14:52:58.388Z

## Plan

I want to build a feature, similar to commit that perform what this skill does /Users/danieloxer/.claude/skills/worktree-prune

## Shared Understanding

Merge-request tool design grilled to completion for v1. All major architectural and UX decisions resolved. Remaining items are mostly implementation-level concerns that can be handled during coding or revisited as needed.

## Questions and Answers

### 1. Should this be a new top-level `mole-tools` subcommand or folded into an existing command?

**Recommended answer:** New top-level subcommand.

**User answer:** New top level subcommand yes.

**Status:** resolved

**Notes:** Feature should be added as its own command, matching the existing CLI structure.

### 2. What should the subcommand be named?

**Recommended answer:** `worktree-prune`.

**User answer:** Yep, worktree-prune

**Status:** resolved

**Notes:** Use the skill name directly for the CLI command.

### 3. How should the scan base dir be resolved and persisted?

**Recommended answer:** Use an explicit arg if provided; otherwise prompt the user once and store it in `config.json` for future runs.

**User answer:** Yes, use explicit arg, else ask the user for input, then set it in the config.json file.

**Status:** resolved

**Notes:** This replaces the source skill's /tmp cache with persistent config storage.

### 4. What config key should store the default base dir?

**Recommended answer:** Add `worktreePrune.baseDir` to `config.json` and the template.

**User answer:** Yes, worktreePrune.baseDir is good.

**Status:** resolved

**Notes:** Feature-specific persisted setting.

### 5. MR title format validation: should we reuse commit's exact rules (conventional commit type + 72-char limit) or relax the format requirement for MRs?

**Recommended answer:** Option 2 — enforce only ≤72 char length, drop mandatory conventional commit type prefix. GitLab MR titles don't need type prefixes like git logs do.

**User answer:** Reuse the commit format rules

**Status:** resolved

**Notes:** MR titles will reuse the exact same format validation as commit messages: conventional commit type(scope)?: description + 72-char subject limit. This means GitLab MRs will look like 'feat(auth): Add OAuth2 provider support'. Consistent with spec §4.10 and existing checkFormat() in format.ts.

### 6. When MR title fails format check, should we (1) blind re-roll with same prompt, or (2) feed specific violations back into the retry prompt?

**Recommended answer:** Option 2 — feedback loop. Inject violations into retry prompt so Ollama knows what failed. Dramatically improves success rate for length/prefix issues.

**User answer:** Yes, option 2 sounds good. Can we also make a note to improve that on the commit flow

**Status:** resolved

**Notes:** MR title auto-regeneration uses feedback loop — inject specific format violations into the retry prompt. ALSO: apply this same improvement to the commit flow's generateValid(). Current commit implementation does blind re-roll (retrying with same prompt). Both should append violations like "Previous message failed: Subject exceeds 72 characters." to guide the model on retry attempts.

### 7. Should the command scan across all repos under the base dir or only the current repo?

**Recommended answer:** Scan across all repos under the configured base dir.

**User answer:** Scan across all repos.

**Status:** resolved

**Notes:** Behavior matches the source skill’s multi-repo scan.

### 8. After scanning, should the user choose a subset or should the command prune everything it finds?

**Recommended answer:** Let the user choose, with quick options for all / none.

**User answer:** Let the user choose, with multi-select. However we should group the multi-select per repo to make it clearer/easier for the user.

**Status:** resolved

**Notes:** Need per-repo grouped selection UI instead of a flat global list.

### 9. Invocation pattern: `--merge-request` flag (per spec) or `merge-request` subcommand (matching existing commit/init)?

**Recommended answer:** Subcommand `mole-tools merge-request` — matches existing commit/init pattern and scales cleanly with cac routing.

**User answer:** Use a subcommand mole-tools merge-request

**Status:** resolved

**Notes:** Aligns with existing cac routing in index.tsx (commit, init, cost-breakdown are all subcommands). The --merge-request flag in spec §2 needs to be corrected to match architecture.

### 10. Should deletion require an explicit confirm per selected worktree, or can multi-select count as the confirmation?

**Recommended answer:** Explicit confirm per selected worktree.

**User answer:** Multi-select is fine, once picked that means the user has chosen to remove it.

**Status:** resolved

**Notes:** Selection itself serves as confirmation; no extra y/n prompt for normal removal.

### 11. Should we implement the GitHost port by building a GlabAdapter that shells out to glab CLI commands?

**Recommended answer:** Yes — create src/adapters/git-host/glab.ts with GlabAdapter implementing GitHost, mirroring GitAdapter pattern. Use glab api endpoint for group/user resolution calls not covered by direct subcommands.

**User answer:** Yes use glab

**Status:** resolved

**Notes:** Create src/adapters/git-host/glab.ts with GlabAdapter class implementing GitHost port. Use glab CLI commands: auth status, mr list, mr create, and glab api for generic REST calls (user lookup, groups). Follow same spawn pattern as GitAdapter. Also need to wire this into buildContext when git host config is present.

### 12. If a normal `git worktree remove` fails, should we keep the separate force-delete yes/no prompt?

**Recommended answer:** Yes — ask before force-deleting each failed worktree.

**User answer:** Yes, ask for each work tree. But what would be helpful is to show/summarize maybe with Ollama the changes that might be lost.

**Status:** needs-codebase-check

**Notes:** Need to inspect whether the repo already has an Ollama summarization pattern and whether this feature should add a new one or stay git-only.

### 13. Should the “changes that might be lost” summary be required, or best-effort only?

**Recommended answer:** Best-effort only — if Ollama isn’t available or the summary fails, still show the normal force-delete prompt.

**User answer:** Yes, best effort is fine.

**Status:** resolved

**Notes:** Ollama summary is optional and must not block the delete flow.

### 14. Should main worktrees be excluded from the deletion list entirely?

**Recommended answer:** Yes — only show extra worktrees, never the main checkout.

**User answer:** Yes only extra worktrees.

**Status:** resolved

**Notes:** Never offer the main worktree for deletion.

### 15. When the MR flow encounters staged changes and needs to run a commit, should we refactor the commit feature into a shared core function that both tools import, keeping push prompt separate?

**Recommended answer:** Extract a reusable `runCommitFlow()` from the commit module. Both commit.run() and the MR feature will use it. In MR context, call without push prompt since MR flow handles pushing itself later.

**User answer:** Yes refactor into a shared flow that both can use

**Status:** resolved

### 16. Should the explicit base-dir input be a flag or a positional argument?

**Recommended answer:** A flag, `--base-dir <path>`.

**User answer:** Have it as a flag.

**Status:** resolved

**Notes:** CLI should expose `--base-dir` rather than a positional argument.

### 17. If the config has no `worktreePrune.baseDir` yet and the user doesn’t pass `--base-dir`, should the command prompt for a directory and then persist it?

**Recommended answer:** Yes — prompt once, then save it to config for later runs.

**User answer:** Yes, prompt only if missing.

**Status:** resolved

**Notes:** Only prompt when neither CLI flag nor stored config value exists.

### 18. Should the persisted config value be updated automatically when `--base-dir` is supplied, or only when the user is prompted?

**Recommended answer:** Only when prompted; a CLI flag should act as an override, not mutate config.

**User answer:** Only when prompted, correct the cli flag shouldn't update the config.

**Status:** resolved

**Notes:** `--base-dir` is a runtime override only.

### 19. How should GitHost (glab adapter) be wired into the Context - automatic vs config-gated?

**Recommended answer:** Hard-set GlabAdapter in buildContext by default since we're GitLab-only for v1, no provider config flag needed yet.

**User answer:** We should just hard set the GLabAdapter for now

**Status:** resolved

**Notes:** Wire GitHost adapter directly in buildContext - hard set GlabAdapter by default, no provider config flag needed yet since we're GitLab-only for v1. buildContext should instantiate and attach the glab adapter rather than leaving gitHost: null.

### 20. Should existing cost-history sessions that already contain cacheReadTokens/cacheWriteTokens be ignored/recomputed from input/output, or should we preserve those stored values when rendering?

**Recommended answer:** Recompute from input/output and ignore stored cache fields in the new reporting logic, while keeping JSONL parsing backward-compatible.

**User answer:** _(not recorded)_

**Status:** open

**Notes:** This keeps execution-time tracking out of the adapters and makes the final cost report the single source of truth.

### 21. Should we grill the dynamic env handoff edge cases now or defer?

**Recommended answer:** Defer - these are low-risk shell-out concerns that the script handles independently. Can revisit during implementation if real problems surface.

**User answer:** We can defer the dynamic env for later

**Status:** resolved

**Notes:** Defer dynamic env script handoff error handling decisions - shell inheritance, interactive scripts, script missing edge cases can be tackled in implementation or later session if issues arise.

### 22. Should we apply the title format violation feedback loop to the existing commit flow as well?

**Recommended answer:** Yes - extract the feedback-loop logic into a shared utility so both commit and MR regeneration benefit from it.

**User answer:** Yes, we should add a feedback loop to the commit flow too

**Status:** resolved

**Notes:** Apply validation feedback loop improvements to the existing commit tool's generateValid(), not just MR. Current commit tool does blind re-roll - should reuse the same violation-feedback pattern we're building for MR auto-regeneration.

### 23. Should existing cost-history sessions that already contain cacheReadTokens/cacheWriteTokens be ignored/recomputed from input/output, or should we preserve those stored values when rendering?

**Recommended answer:** Recompute from input/output and ignore stored cache fields in the new reporting logic, while keeping JSONL parsing backward-compatible.

**User answer:** We can strip backward-compatibility. We can think of it as starting from fresh.

**Status:** resolved

**Notes:** Treat cost history format as reset; reporting can rely on the new computed cache model only.

### 24. When the auto-reviewer could duplicate a user-selected reviewer, should we deduplicate or pass duplicates through to glab?

**Recommended answer:** Deduplicate before sending - filter out the auto-reviewer if already selected by user. Clean logic, avoids redundant --reviewer flags.

**User answer:** Yes, let's handle that deduplication cleanly

**Status:** resolved

**Notes:** Auto-reviewer edge case: deduplicate reviewers when auto-reviewer matches a user-selected one from multi-select. Simple filter before building glab mr create flags. Also handle / in username by trusting config value - let glab --reviewer flag resolve it rather than doing our own api lookup.

### 25. When a branch hasn't been pushed, should we run git fetch up front to ensure origin refs exist before computing diff ranges?

**Recommended answer:** Add explicit `git fetch origin` early in flow (after preflight) — ensures remote refs exist for diff range and commit-ahead check. Lightweight and no-op if fresh.

**User answer:** Good call, yes - we need that early fetch to make the diff ranges work correctly

**Status:** resolved

**Notes:** Added explicit git fetch origin early in MR flow (after preflight) to ensure remote refs exist locally. Required for the diff range origin/<base>...HEAD and commits-ahead check when branches haven't been pushed yet. Lightweight, no-op if already fresh.

### 26. Should we run `git fetch origin` early in the flow to ensure remote refs exist before computing diff ranges and commit-ahead checks?

**Recommended answer:** Yes — explicit git fetch early after preflight. Ensures remote refs exist for diff range and ahead check.

**User answer:** Yes run the git fetch origin early in the flow

**Status:** resolved

**Notes:** Confirmed: run `git fetch origin` early in MR flow after preflight, before checking commit-ahead status or building diff range via `origin/<base>...HEAD`. Ensures remote refs exist locally regardless of prior push history. Lightweight, no-op when already fresh.

## Agreed Decisions

- Subcommand invocation: mole-tools merge-request (not flag)
- git fetch origin early in flow for remote refs
- GlabAdapter hard-set in buildContext, no config gate needed for v1
- Shell out to glab CLI commands (not GitLab SDK/REST)
- Shared commit flow function extracted for both tools
- CODEOWNERS discovery: .gitlab/CODEOWNERS > CODEOWNERS root > .github/
- Batch resolve all handles upfront after parsing CODEOWNERS
- True multi-line Ink editor (no $EDITOR spawn)
- Reuse commit format rules for MR titles (type+72 chars)
- Feedback loop in auto-regenerate for both title and commit
- One-shot generation: title + body together from Ollama
- Deduplicate reviewers when auto-reviewer matches user selection
- Defer dynamic env script handoff edge cases to later

## Open Risks

- Touch-score git log performance in large repos (200 commits per changed file)
- Multi-line Ink editor complexity and testing
- Glab CLI auth status detection across different versions
- Author name → GitLab handle matching edge cases in reviewer scoring

## Next Decision Needed

Start implementation or continue grilling any remaining open risks above
