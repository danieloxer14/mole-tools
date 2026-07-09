# worktree-prune — Worktree Prune Spec

Status: Draft
Date: 2026-07-09
Author: Pi Agent
Companions: None

A new top-level command for `mole-tools` designed to help users clean up git worktrees by scanning a directory of repositories and identifying extra (non-main) worktrees for removal.

## Product Framing

As developers working with multiple git worktrees, it can become difficult to keep track of which ones are active or temporary. This tool provides a centralized way to scan a base directory, see all available worktrees grouped by repository, and quickly prune them. It prioritsizes safety by:
- Only showing "extra" worktrees (never the main repository checkout).
- Providing an optional summary of potentially lost changes via LLM before force-deleting failed removals.

## Invocation / UX Flow

### 1. Base Directory Resolution
The command first determines the base directory to scan using the following priority:
1. `--base-dir <path>` flag (provided at runtime; does not mutate config).
2. Stored `worktreePrune.baseDir` in `config.json`.
3. If neither is present, prompt the user for a directory and persist it to `config.json`.

### 2. Discovery & Grouped Selection
The tool scans all git repositories under the resolved base directory.
- For each repository found:
  - It identifies all worktrees.
  - It filters out the main worktree (the one containing the `.git` folder or identified as primary).
  - It presents a multi-select prompt to the user, grouping these extra worktrees by their parent repository.

### 3. Deletion Flow
- **Normal Removal**: Any worktree selected in the multi-select prompts is subject to standard removal via `git worktree remove <path>`. Selection itself acts as the confirmation for this stage.
- **Force-Delete Fallback**: If a standard removal fails (e.g., due to unstaged changes), the user is prompted individually for that specific worktree:
  - Before the prompt, the tool attempts a "best-effort" summary of potentially lost changes using an LLM (Ollama). This includes `git status --short` and `git diff --stat`.
  - If the summary fails or Ollama is unavailable, it proceeds directly to the prompt.
  - The user must explicitly confirm (`y/n`) for each failed worktree to perform a force-removal.

## Configuration

### JSON Schema (`src/adapters/config/schema.ts`)

| Key | Type | Description |
| :--- | :--- | :--- |
| `worktreePrune.baseDir` | `string` | The default directory used for scanning repositories. |

## Resolved Behavior

### CLI Arguments
- `--base-dir <path>`: Overrides the configured base directory for the current session only.

### Discovery Logic
- Scans filesystem for directories containing `.git`.
- Uses `git rev-parse --show-toplevel` to normalize repository roots.
- Filters worktrees by checking the presence of the main repo's `.git` entry or matching the primary path.

### Deletion Failure Handling
- Failures in a batch do not halt the entire process; the tool attempts to process all selected items.
- A failure triggers the "Force-Delete" sub-flow for that specific item.

## Implementation Stages

### Stage 1: Config & Command Plumbing
- Add `worktreePrune` config section with `baseDir` in schema and loader.
- Implement base directory resolution logic (flag > config > prompt).
- Register the `worktree-prune` command in the registry.

### Stage 2: Repository & Worktree Discovery
- Implement filesystem scanning for git repositories.
- Implement filtering logic to exclude main worktrees.
- Normalize results by repository root.

### Stage 3: UI & Deletion Flow
- Implement grouped multi-select prompting per repository.
- Implement batch removal logic using `git worktree remove`.
- Implement the force-delete fallback flow, including the best-effort LLM summary helper.


| Given | When | Then |
| :--- | :--- | :--- |
| No `--base-dir` flag and no saved config | The command starts | It prompts for a base dir and saves it to `config.json`. |
| A saved config `baseDir` exists | The command starts without a flag | It uses the saved path and does not prompt. |
| `--base-dir /tmp/x` is provided | Config has a different path | It uses `/tmp/x` for the session and does not update config. |
| A repository has a main worktree and two extra ones | Discovery runs | Only the two extra worktrees are presented for selection. |
| Two repositories have pruneable worktrees | The command runs | The tool prompts the user repo-by-repo with grouped lists. |
| A selected worktree is removed successfully | Deletion runs | It is removed without further confirmation. |
| A `git worktree remove` fails | Fallback flow triggers | The user receives a personal yes/no prompt for that specific worktree. |
| An LLM summary generator fails or Ollama is offline | Force-delete starts | The tool skips the summary and goes straight to the manual confirmation prompt. |
| No git repos are found under the base dir | The command runs | It reports no items to prune and exits cleanly. |

## Open Items

- [ ] Decide exact UI/UX for grouped selection if list is long (though repo-by-repo prompting mitig-gates this).
- [ ] Finalize prompt text for force-delete confirmation.
