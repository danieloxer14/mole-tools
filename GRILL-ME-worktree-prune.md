# Grill Me Results

Generated: 2026-07-09T14:37:46.407Z

## Plan

I want to build a feature, similar to commit that perform what this skill does /Users/danieloxer/.claude/skills/worktree-prune

## Shared Understanding

We are adding a new top-level `mole-tools worktree-prune` subcommand. It scans all git repos under a base dir and lists only extra worktrees (never main worktrees). The user selects deletable worktrees via grouped multi-select by repo. Normal removal is a direct confirmation through selection; if removal fails, each worktree gets its own separate force-delete y/n prompt. Force-delete is best-effort: an Ollama-generated summary of potentially lost changes may be shown, but failure to summarize must not block the prompt. The base dir is provided by `--base-dir` or, if absent, prompted once and persisted to `config.json` under `worktreePrune.baseDir`. The CLI flag is runtime-only and must not update config.

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

## Agreed Decisions

- New top-level subcommand: `worktree-prune`
- Scan across all repos under a base dir
- Only extra worktrees are listed; main worktrees are excluded
- Selection uses grouped multi-select per repo
- Multi-select selection is the confirmation for normal removal
- If removal fails, prompt separately for force-delete per worktree
- Force-delete summary is best-effort only
- Explicit base dir uses `--base-dir <path>`
- If config is missing and no flag is supplied, prompt once and persist the base dir
- `--base-dir` does not mutate config

## Open Risks

- Need to decide the exact grouped multi-select UX in Ink
- Need to decide whether Ollama summary should be wired through existing LLM abstractions or added as a small one-off helper
- Need to update config schema/template/load/save flow for `worktreePrune.baseDir`

## Next Decision Needed

Implement grouped selection and the delete/force-delete flow in code.
