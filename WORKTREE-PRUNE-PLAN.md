# Worktree Prune Implementation Plan

## Proposed files

### New feature module
- `src/features/worktree-prune/index.ts`
  - Orchestrates the full command flow
  - Resolves base dir
  - Calls discovery
  - Prompts per repo with grouped multi-select
  - Runs delete / force-delete flow

- `src/features/worktree-prune/discovery.ts`
  - Finds git repos under a base dir
  - Reads worktree lists for each repo
  - Filters out main worktrees
  - Normalizes data into `RepoWorktrees` / `WorktreeInfo` structures

- `src/features/worktree-prune/summary.ts`
  - Best-effort Ollama summary helper for “changes that might be lost”
  - Takes a worktree path + git diff/status snapshot and returns a short summary
  - Must never block force-delete if summarization fails

- `src/features/worktree-prune/types.ts` (optional)
  - Shared types for repo/worktree records

### Tests
- `src/features/worktree-prune/index.test.ts`
  - End-to-end feature behavior with mocked UI/VCS/LLM
- `src/features/worktree-prune/discovery.test.ts`
  - Repo/worktree parsing and filtering
- `src/features/worktree-prune/summary.test.ts`
  - Summary helper best-effort behavior

### Existing files likely to change
- `src/core/registry.ts`
  - Register `worktree-prune`
- `src/adapters/config/schema.ts`
  - Add `worktreePrune.baseDir`
- `src/adapters/config/loader.ts`
  - Update template/config defaults
- `src/ports/vcs.ts`
  - Add worktree methods if we want to keep git execution behind the VCS port
- `src/adapters/vcs/git.ts`
  - Implement worktree listing/removal
- `src/adapters/vcs/git.test.ts`
  - Add GitAdapter coverage
- `src/index.tsx`
  - Likely no direct change beyond registry/feature args wiring

---

## Stage-by-stage plan

### Stage 1 — Config + command plumbing
- Add `worktreePrune` config section with `baseDir`
- Add `--base-dir <path>` flag to the feature args schema
- Resolve base dir in priority order:
  1. CLI flag
  2. config value
  3. prompt user and persist
- Keep CLI flag runtime-only

**Implementation detail**
- Follow the same feature pattern as `commit` and `init`
- Use existing `UiPort.editText()` for prompting the base dir

---

### Stage 2 — Repo/worktree discovery
- Scan the base dir for git repos
- Deduplicate by canonical repo root
- For each repo, query `git worktree list --porcelain`
- Remove the main worktree from the selectable list
- Group results by repo for UI presentation

**Implementation detail**
- Detect repos by filesystem scan for `.git`
- Normalize to repo root with `git rev-parse --show-toplevel`
- Parse worktrees deterministically and sort them for stable UI

---

### Stage 3 — Grouped multi-select UX
- Prompt once per repo, not one giant flat list
- Each prompt shows only that repo’s extra worktrees
- Selection itself counts as confirmation for normal delete

**Implementation detail**
- Existing `UiPort.multiSelect()` is enough
- No new UI API needed
- Repo-by-repo prompting keeps the grouped UX clear without redesigning Ink controls

---

### Stage 4 — Normal delete flow
- For each selected worktree:
  - try `git worktree remove <path>`
  - record success/failure
- Continue processing the batch even if one removal fails
- Summarize partial failures at the end

**Implementation detail**
- Use a result object per worktree:
  - `removed`
  - `failed`
  - `needsForce`
- Keep the flow simple and batch-oriented

---

### Stage 5 — Force-delete fallback
- For each failed worktree:
  - optionally generate “changes that might be lost” summary
  - show a separate confirm prompt
  - if user agrees, force-remove that specific worktree
- Best-effort only: summary failure must not stop deletion

**Implementation detail**
- Summary should be lightweight:
  - collect `git status --short`
  - maybe `git diff --stat` / `git diff --name-only`
  - feed that into Ollama with a short prompt
- If Ollama is unavailable, skip straight to prompt

---

### Stage 6 — Polish and error handling
- Handle:
  - no config + no flag
  - no repos found
  - repos found but no prunable worktrees
  - partial failures
  - force-delete declines
- Emit clear UI messages for each state

---

## BDD test coverage

### 1) Base dir resolution
**Given** no `--base-dir` flag and no saved config  
**When** the command starts  
**Then** it prompts for a base dir and saves it to config

**Given** a saved config base dir  
**When** the command starts without a flag  
**Then** it uses config and does not prompt

**Given** `--base-dir /tmp/x` and config has another path  
**When** the command runs  
**Then** it uses `/tmp/x` and does not update config

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
