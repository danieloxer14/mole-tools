# Worktree Prune Implementation Record

**Status:** Implemented

## Implemented files

### Feature module
- `src/features/worktree-prune/index.ts`
  - Orchestrates base-directory resolution, discovery, grouped selection, normal removal, and force-removal fallback.
- `src/features/worktree-prune/discovery.ts`
  - Finds Git repositories, reads worktrees, filters main worktrees, and normalizes grouped results.
- `src/features/worktree-prune/summary.ts`
  - Provides best-effort summaries of changes that might be lost; summary failure never blocks confirmation.

### Tests
- `src/features/worktree-prune/index.test.ts`
  - Covers end-to-end feature behavior with mocked UI/VCS/LLM.
- `src/features/worktree-prune/discovery.test.ts`
  - Covers repository/worktree parsing and filtering.
- `src/features/worktree-prune/summary.test.ts`
  - Covers best-effort summary behavior.

### Existing integration points
- `src/core/registry.ts` registers `worktree-prune`.
- `src/adapters/config/schema.ts` and `src/adapters/config/loader.ts` provide `worktreePrune.baseDir`.
- `src/ports/vcs.ts` and `src/adapters/vcs/git.ts` provide worktree listing/removal operations.
- `src/index.tsx` wires feature arguments through the generic registry path.

The former staged plan is represented below as an implementation record, with
shipped behavior described in present tense.

---

## Historical implementation plan

### Implemented Stage 1 — Config and command plumbing
- The `worktreePrune` config section contains `baseDir`.
- The `--baseDir <path>` flag is available at runtime and remains runtime-only.
- Base-directory resolution uses flag, config, then prompt priority.
- Prompted values persist to config.

### Implemented Stage 2 — Repository and worktree discovery
- The command scans the base directory for Git repositories.
- Repository roots are normalized and duplicate paths are deduplicated.
- `git worktree list --porcelain` data is parsed and main worktrees are excluded.
- Results are sorted and grouped by repository.

### Implemented Stage 3 — Grouped selection
- The command prompts once per repository with a grouped multi-select list.
- Each list contains only that repository's extra worktrees.
- Selection acts as confirmation for normal removal.

### Implemented Stage 4 — Normal deletion
- Each selected worktree is processed with `git worktree remove`.
- A failure does not stop processing of other selected worktrees.
- Each result records removed or failed status for later handling.

### Implemented Stage 5 — Force-delete fallback
- Failed worktrees receive an optional status/LLM summary.
- Summary failure is best-effort and does not stop the confirmation prompt.
- Each failed worktree receives a separate force-delete confirmation.
- Accepted confirmations force-remove that worktree; declined items remain.

### Implemented Stage 6 — Empty states and error handling
- No config and no flag prompts for a base directory and persists a non-blank answer.
- No repositories and no extra worktrees report clean empty states.
- Partial failures are summarized after all selected worktrees are processed.

## BDD test coverage

### 1) Base dir resolution
**Given** no `--baseDir` flag and no saved config
**When** the command starts  
**Then** it prompts for a base dir and saves it to config

**Given** a saved config base dir  
**When** the command starts without a flag  
**Then** it uses config and does not prompt

**Given** `--baseDir /tmp/x` is provided and config has another path
**When** the command runs  
**Then** it uses `/tmp/x` and does not update config

The compatibility spelling `--base-dir` is also accepted by CAC and normalizes
to the registered `baseDir` option.

---

### 2) Discovery
**Given** a base dir with multiple git repos  
**When** discovery runs  
**Then** it returns one grouped record per repo

**Given** a repo with main worktree + extra worktrees  
**When** discovery runs  
**Then** only the extra worktrees are selectable

**Given** nested or duplicate repo paths  
**When** discovery runs  
**Then** the same repo is not listed twice

---

### 3) Grouped selection
**Given** two repos with pruneable worktrees  
**When** the command prompts  
**Then** it asks repo-by-repo with grouped multi-select lists

**Given** the user selects nothing for a repo  
**When** the prompt completes  
**Then** no deletes happen for that repo

**Given** the user selects some worktrees  
**When** the prompt completes  
**Then** those selections are treated as confirmation

---

### 4) Normal deletion
**Given** a selected worktree removes cleanly  
**When** deletion runs  
**Then** it is removed without extra confirmation

**Given** three selected worktrees and one fails  
**When** deletion runs  
**Then** the other two still proceed

---

### 5) Force-delete fallback
**Given** a worktree removal fails  
**When** fallback runs  
**Then** the user gets a separate yes/no prompt for that specific worktree

**Given** the user declines force-delete  
**When** fallback runs  
**Then** that worktree remains untouched

**Given** the user accepts force-delete  
**When** fallback runs  
**Then** the worktree is force-removed

---

### 6) Ollama summary
**Given** a failed worktree with local changes  
**When** force-delete fallback runs and Ollama works  
**Then** the summary is shown before the prompt

**Given** Ollama errors or is unavailable  
**When** force-delete fallback runs  
**Then** the prompt still appears

**Given** the summary generator throws  
**When** force-delete fallback runs  
**Then** deletion flow still continues

---

### 7) Empty states
**Given** no git repos under the base dir  
**When** the command runs  
**Then** it reports nothing to prune and exits cleanly

**Given** repos exist but no extra worktrees  
**When** the command runs  
**Then** it reports nothing to prune and exits cleanly
