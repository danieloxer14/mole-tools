# mole-tools — Spec

**Status:** Ideation / product-grilled. No implementation yet.
**Date:** 2026-07-08
**Author:** Daniel Oxer

`mole-tools` is a standalone global CLI holding common repeating git/dev
workflows. Two tools planned: **commit** and **merge request**. This document
specs the **commit** tool in full and captures the shared foundation
(install, config) that the merge-request tool will build on.

---

## 1. Product framing

### Why it exists

The team already has Claude Code skills (`create-merge-request`,
`fix-mr-comments`) that generate commits/MRs with heavy repo-context awareness
(reads CODEOWNERS, commitlint config, Jira ticket, asks clarifying questions).

`mole-tools` is deliberately **the fast/lite path**. Core driver:

- **Speed + zero token cost.** Local Ollama = instant, free, offline. No Claude
  round-trip.

Consequence: accept lower output quality for everyday commits. Stay lean. Do
**not** reimplement the heavy repo-context machinery the skills already own.

### Design stance (decided during grill)

- Fail-fast and deterministic over clever recovery.
- Minimal config surface; sensible defaults.
- The user's system prompt owns message *content*; the tool owns *structure*
  and *flow*.

---

## 2. Install & distribution

- Global CLI named `mole-tools`.
- Installed to a location on `PATH` so it runs from any git directory.
- Primary source control: `git`.
- Invocation: `mole-tools --commit` (merge-request tool: separate flag/subcommand, TBD next session).

---

## 3. Configuration

**Location:** `~/.config/mole-tools/config.json`

**Bootstrap:** On first run with no config file, the tool **auto-creates a
template** (default Ollama model, Jira disabled), tells the user where it is,
then proceeds if possible.

**Secrets:** Stored **plaintext** in `config.json`. Keep the file out of any
synced/committed repo (it lives in `~/.config`, not a project dir).

### Schema

| Key | Purpose | Tool |
|-----|---------|------|
| `ollama.commitModel` | Model for commit messages | commit |
| `ollama.mrModel` | Model for MR descriptions | MR |
| `ollama.baseUrl` | Ollama endpoint (default `http://localhost:11434`) | shared |
| `commitSystemPrompt` | System prompt for commit generation | commit |
| `mrSystemPrompt` | System prompt for MR generation | MR |
| `jira.enabled` | Toggle Jira integration | shared |
| `jira.url` | Jira base URL | shared |
| `jira.apiKey` | Plaintext API token | shared |
| `jira.branchPattern` | Override regex for ticket key (default `[A-Z]+-[0-9]+`) | shared |
| `diff.ignore` | Noise globs excluded from full diff (lockfiles, `*.snap`, generated) | commit |
| `dynamicEnvRepos` | Repos offered the "create dynamic env" option | MR |
| `autoReviewer.username` | Auto-reviewer handle; presence enables the "add auto-reviewer?" question | MR |

> `dynamicEnvRepos` and `autoReviewer` belong to the merge-request tool —
> parked for the next session.

---

## 4. Commit tool — UX flow

1. Run `mole-tools --commit` from within a git directory.
2. If Jira configured **and** branch matches the ticket pattern → fetch the
   Jira ticket summary + description.
3. Grab the diff of **staged** changes (with noise filtering, §5.2).
4. Send `commitSystemPrompt` + Jira info (if any) + diff → configured Ollama
   model.
5. Model produces a candidate commit message.
6. Run the format check (§5.5). On failure, auto-regenerate up to N times, then
   abort.
7. Show the message → user **accepts / edits (inline) / rejects**.
8. Accept → `git commit`.
9. Ask whether to push. Yes → push (set upstream if needed).

---

## 5. Commit tool — resolved behaviour

### 5.1 Input source
- Uses **staged** diff only.
- Empty stage → print `No staged changes`, exit non-zero, no commit.
- No unstaged/working-tree fallback.

### 5.2 Diff noise filtering
- Exclude configurable noise (lockfiles, `*.snap`, generated files — `diff.ignore`)
  from the full diff.
- For excluded files, include **filename/stat only**, not the patch body.
- Keeps context small and the message focused.

### 5.3 Jira integration
- Trigger: `jira.enabled` **and** branch name matches the key pattern.
- Pattern: default `[A-Z]+-[0-9]+` against branch name; overridable via
  `jira.branchPattern`.
- On match: fetch ticket summary + description, pass to the model.
- **Fetch failure (network / auth / 404) → abort.** Commit blocked on Jira health.
- No match, or Jira disabled → proceed diff-only, no error.
- Ticket key placement in the message: **trust the prompt** — no deterministic
  injection by the tool.

### 5.4 Ollama
- Endpoint from `ollama.baseUrl`, model from `ollama.commitModel`.
- Daemon unreachable → error with the URL, exit non-zero.
- Model not pulled → error with `ollama pull <model>` hint, exit non-zero.
- No auto-pull, no manual-editor fallback on Ollama failure.

### 5.5 Format check (fixed rules, not configurable)
Applied to model output:
- **Conventional Commits prefix** — subject matches `type(scope)?: description`
  with an allowed type.
- **Subject length ≤ 72**.
- **Blank line before body** (when a body exists).

On failure: **auto-regenerate up to N (≈3)**. If still failing → abort and
print the violations.

### 5.6 Present / accept / edit / reject
- Show the candidate message.
- **Accept** → `git commit` with the message.
- **Edit** → inline (readline) prefilled edit. Edited text is **trusted**:
  committed as-is, **not** re-run through the format check (manual override).
- **Reject** → abort, no commit, no regenerate loop. User re-runs manually.

### 5.7 Push
- After a successful commit, ask whether to push.
- Yes + upstream set → push.
- Yes + **no upstream** → `git push -u origin <branch>` (assumes `origin`, sets
  upstream).
- Push rejected by remote (needs pull, protected branch, etc.) → print git's
  error **verbatim**, exit non-zero. No auto-pull.

---

## 6. Scope

### In
- Global CLI on PATH; `--commit` tool.
- Auto-created config template on first run.
- Staged-diff commit-message generation via local Ollama.
- Noise filtering with stat fallback.
- Optional Jira context (branch-pattern gated, fail-fast).
- Fixed format enforcement with bounded auto-regenerate.
- Accept / inline-edit / reject; commit; optional push with upstream setup.

### Out (this phase)
- Merge-request tool (next session).
- GitHub / GitLab MR logic.
- Deterministic ticket injection.
- Repo-context awareness (CODEOWNERS, commitlint detection, clarifying questions).
- Regenerate-on-user-reject, feedback loops, re-prompt-to-adjust.
- Unstaged / working-tree fallback.
- Configurable format rule set.

---

## 7. Acceptance criteria

| # | Given | Then |
|---|-------|------|
| 1 | No config file present | Template written to `~/.config/mole-tools/config.json`; run continues |
| 2 | Nothing staged | Prints "No staged changes", exits non-zero, no commit |
| 3 | Ollama daemon down | Prints unreachable error w/ URL, exits non-zero |
| 4 | Configured model not pulled | Prints `ollama pull <model>` hint, exits non-zero |
| 5 | Branch matches Jira pattern + Jira configured | Ticket summary + description included in model input |
| 6 | Jira configured + branch matches + fetch fails | Aborts, no commit |
| 7 | Branch doesn't match pattern, or Jira disabled | Proceeds diff-only, no error |
| 8 | Lockfile / generated file staged | Excluded from full diff; appears as stat/filename only |
| 9 | Output missing prefix OR subject >72 OR no blank line before body | Auto-regenerates; after N failures aborts + prints violations |
| 10 | Valid message generated | Shown with accept / edit / reject |
| 11 | User rejects | Exits, no commit |
| 12 | User edits | Inline-editable; edited text committed as-is (no re-check) |
| 13 | User accepts | `git commit` with the message |
| 14 | Post-commit push, yes, no upstream | `git push -u origin <branch>` sets upstream |
| 15 | Push rejected by remote | Git error printed verbatim, exit non-zero |

---

## 8. Open items for next session (merge-request tool)

- GitLab **and** GitHub support (`glab` / `gh` equivalents).
- Reviewer suggestion — how much of the existing skill's CODEOWNERS +
  touch-score logic to reuse vs. skip for lean/fast.
- `dynamicEnvRepos` — the "create dynamic env" option per-repo.
- `autoReviewer.username` — presence enables the "add auto-reviewer?" prompt.
- `mrSystemPrompt` + `ollama.mrModel` wiring.
- MR title/body template and Jira linkage.
