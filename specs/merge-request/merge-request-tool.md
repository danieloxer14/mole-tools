# mole-tools — Merge-Request Tool Spec

**Status:** Ideation / product-grilled. No implementation yet.
**Date:** 2026-07-08
**Author:** Daniel Oxer
**Companions:** [commit-tool.md](./commit-tool.md), [architecture/architecture.md](./architecture/architecture.md)

The **merge-request** tool. Second tool in `mole-tools`. Builds on the shared
foundation (install, config, Ollama, Jira) specced in
[commit-tool.md](./commit-tool.md) and reuses the `--commit` flow as a sub-step.

---

## 1. Product framing

### Why it exists

Fast/lite path for opening a GitLab MR from the current branch — local Ollama
authors the title + description, no Claude round-trip, no token cost. Mirrors
the existing `create-merge-request` Claude skill but trimmed for speed.

### Design stance (carried from commit tool)

- Fail-fast and deterministic over clever recovery.
- The user's `mrSystemPrompt` owns message **content**; the tool owns
  **structure** and **flow**.
- Minimal config; sensible defaults; zero prompts on the happy path where a
  default is safe.

### Deliberate exception to "stay lean"

The commit spec said *don't* reimplement heavy repo-context machinery. For the
**reviewer suggestion** the decision went the other way: the full CODEOWNERS +
touch-score port is worth the cost because good reviewer suggestions are the
main value-add of the MR flow. This is a conscious, scoped exception — see §5.7.

---

## 2. Invocation

- `mole-tools --merge-request`, run from within a git directory.
- GitLab only for v1 (`glab`). GitHub (`gh`) is **out of scope** — the provider
  config slot is reserved but no `gh` path is built (see §6).

---

## 3. Configuration (keys used by this tool)

Shared schema lives in [commit-tool.md](./commit-tool.md) §3. Keys this tool
reads:

| Key | Purpose |
|-----|---------|
| `ollama.mrModel` | Model for MR title + description |
| `ollama.baseUrl` | Ollama endpoint (shared) |
| `mrSystemPrompt` | System prompt owning MR message content/structure |
| `jira.*` | Optional ticket context (shared, branch-pattern gated) |
| `diff.ignore` | Noise globs excluded from the diff body (shared with commit) |
| `dynamicEnvRepos` | Repos offered the "create dynamic env" step (§5.11) |
| `autoReviewer.username` | Auto-reviewer handle; presence enables the y/n prompt (§5.9) |
| `dynamicEnvScript` | Path to the in-repo dynamic-env script (default `hack/local/dynamic-env.sh`) |

---

## 4. UX flow (ordered)

1. **Preflight.** Verify `glab` installed + authenticated → abort with a clear
   message if not. Resolve repo + current branch.
2. **On-default-branch guard.** If current branch is the resolved default
   branch → `Cannot open MR from <default>`, exit non-zero.
3. **Existing-MR guard.** `glab mr list --source-branch <branch>` — if an open
   MR exists, print its URL and exit 0 (don't burn Ollama tokens or re-create).
4. **Pending changes.** If the working tree has **staged** changes → run the
   `--commit` flow, then return here. Unstaged changes do not block the flow;
   the merge-request diff is collected from committed changes only (no auto
   `git add`).
5. **Push.** If the branch has no upstream → `git push -u origin <branch>`. If
   it has an upstream but local is ahead → `git push`. Push errors printed
   verbatim, exit non-zero (no auto-pull). Clean + up-to-date → skip.
6. **Base branch.** Auto-detect `origin`'s default branch (main/master/…).
   **Nothing-to-merge guard:** no commits ahead of base → `Nothing to merge`,
   exit non-zero.
7. **Jira.** If `jira.enabled` and branch matches the key pattern → fetch ticket
   summary + description. Fetch failure → abort (same as commit spec).
8. **Collect.** All commit messages on `base..HEAD`, and the diff
   `origin/<base>...HEAD` with `diff.ignore` noise filtering (stat/filename only
   for excluded files — same rule as commit §5.2).
9. **Generate.** Send `mrSystemPrompt` + Jira info (if any) + commit messages +
   diff → `ollama.mrModel`, streamed live.
10. **Title format check.** Enforce `type(scope)?: description` + subject ≤72
    (same rules as commit §5.5). Auto-regenerate up to ~3, then abort + print
    violations. **Body is free-form** — no format check.
11. **Present.** Show title + body → **accept / edit / reject**.
    - Edit → inline multi-line editing in the Ink UI. Edited text trusted
      as-is, **not** re-run through the title check.
    - Reject → abort, no MR, no regenerate loop.
12. **Reviewers** (on accept). Full CODEOWNERS + touch-score suggestion (§5.7).
    Present top matches as a multi-select; user picks 1+ or types their own.
13. **Auto-reviewer.** If `autoReviewer.username` set → ask y/n → add as an
    extra reviewer (§5.9).
14. **Final summary.** Show title, body, assignee (self), reviewers, and a
    **draft y/n** toggle → **confirm / reject**.
15. **Create.** On confirm → `glab mr create` (§5.10). On failure print glab's
    stderr verbatim, exit non-zero. On success print the MR URL.
16. **Dynamic env.** If the repo is in `dynamicEnvRepos` → ask y/n → hand off to
    the in-repo dynamic-env script (§5.11).

---

## 5. Resolved behaviour

### 5.1 Provider
- GitLab only. `glab mr create`. No `gh` path in v1.

### 5.2 Preflight / auth
- `glab` missing or unauthenticated → abort up front with a clear message,
  before any Ollama or git work.

### 5.3 Pending changes → commit detour
- Staged changes present → invoke the `--commit` flow (staged-only, per commit
  spec), return on completion, continue the MR flow.
- Unstaged changes do not block the flow and are never included in the MR diff.
  No `git add -A`.
- Clean tree → skip straight to push check.

### 5.4 Push
- No upstream → `git push -u origin <branch>` (assumes `origin`, sets upstream).
- Upstream set + local ahead → `git push`.
- Push rejected (protected branch, needs pull, …) → git error verbatim, exit
  non-zero. No auto-pull.

### 5.5 Base branch + range
- Base = `origin`'s default branch, auto-detected.
- Commit messages: `base..HEAD`. Diff: `origin/<base>...HEAD`.
- No commits ahead of base → `Nothing to merge`, exit non-zero.

### 5.6 Jira
- Same trigger + fail-fast contract as commit §5.3: enabled + branch match →
  fetch; fetch failure → abort; no match / disabled → proceed without it.

### 5.7 Reviewer suggestion (full touch-score port)
Ported from the `create-merge-request` skill's `suggest_reviewers.py`:
- Find `CODEOWNERS` (search up to a few levels deep). None found / none resolve
  → skip the reviewer step entirely.
- Extract `@handle` tokens; resolve each via `glab api` — `/` in the handle →
  **group** (`/groups/<enc>/members`, paginated), else **user**
  (`/users?username=<h>`).
- **Touch score:** changed files (`git diff base...HEAD --diff-filter=M
  --name-only`) → `git log --max-count=200 --name-only` over those files →
  per-author tally of touched files. Sorted descending.
- Tiered author→member name matching (exact → first-initial → last-initial →
  prefix, first rule wins).
- Fallback pool: recent repo authors (`git log --max-count=100 --format=%an`)
  not already scored.
- Suggest top 4 (diff-touch authors → fallback-by-recency → remaining raw
  CODEOWNERS members to pad), excluding the current user.
- Present via multi-select (label: display name + `@username · N commits`).
  User may also type their own handle(s).

### 5.8 Assignee vs reviewer
- **Assignee** = the current authenticated glab user (self), single
  `--assignee`. Omitted if the `glab api /user` lookup fails (never blocks).
- **Reviewers** = the selected CODEOWNERS/touch-score set, one `--reviewer` per
  handle. Independent of the assignee.

### 5.9 Auto-reviewer
- Only when `autoReviewer.username` is set → ask y/n.
- Yes → add as an **additional** `--reviewer`. User vs group auto-detected
  (`/` → group), same resolution as §5.7. Never an assignee.
- Generalizes the skill's hardcoded "Merge Mole" concept into config.

### 5.10 MR creation
- `glab mr create --title <t> --description <body> --assignee <self>
  --reviewer <r1> [--reviewer <r2> …] [--draft]`.
- No `--target-branch` (glab defaults to the repo default; §5.5 base is used for
  the diff range, not passed as a flag).
- Draft flag from the final-summary y/n (§4.14).
- glab create failure → stderr verbatim, exit non-zero. No retry.

### 5.11 Dynamic env
- Only when the repo is in `dynamicEnvRepos`, and only **after** the MR is
  created → ask y/n.
- Yes → shell out to the repo's own script at `dynamicEnvScript` (default
  `hack/local/dynamic-env.sh`), inheriting the TTY so the script's own prompts
  (service, env name, E2E, mocks) drive directly. mole-tools adds nothing and
  re-prompts nothing.
- The script force-pushes a `dynamic-<name>` git tag with CI variables — it is
  **independent of the MR** (not an MR comment/label). mole-tools just runs it.
- Script missing at the path → warn, skip (don't abort a successful MR).

### 5.12 Ollama
- Same contract as commit §5.4: daemon unreachable → error w/ URL; model not
  pulled → `ollama pull <model>` hint; both exit non-zero. No auto-pull.

---

## 6. Scope

### In
- `mole-tools --merge-request`, GitLab-only, from a git directory.
- glab preflight (installed + authenticated).
- On-default-branch, existing-MR, and nothing-to-merge guards.
- Commit detour (staged-only) + push (upstream setup) before creating.
- Auto-detected base branch; commit-messages + noise-filtered diff collection.
- Optional Jira context (fail-fast).
- Ollama-generated title + body (live-streamed); enforced title format with
  bounded auto-regenerate; free-form body.
- Accept / inline multi-line edit / reject.
- Full CODEOWNERS + touch-score reviewer suggestion (multi-select + own).
- Self as assignee.
- Auto-reviewer prompt (config-gated).
- Final summary with draft toggle + confirm/reject.
- `glab mr create`; MR URL printed; glab errors verbatim.
- Dynamic-env hand-off to the in-repo script (config-gated repos).

### Out (this phase)
- GitHub / `gh` support (provider slot reserved only).
- Hardcoded body template (content lives in `mrSystemPrompt`).
- Reject-triggered regenerate / feedback loops.
- Re-running title format check on hand-edited text.
- Updating an existing MR (existing MR → print URL + exit; that's
  `fix-mr-comments` territory).
- Auto-pull on rejected push.
- Reimplementing the dynamic-env service table (shell out to the script).
- `--target-branch` selection / cross-fork MRs.

---

## 7. Acceptance criteria

| # | Given | Then |
|---|-------|------|
| 1 | `glab` missing or unauthenticated | Clear abort message up front, exit non-zero, no Ollama/git work |
| 2 | Run while on the default branch | `Cannot open MR from <default>`, exit non-zero |
| 3 | An open MR already exists for the branch | Its URL printed, exit 0, no generation |
| 4 | Working tree has staged changes | `--commit` flow runs, then MR flow resumes |
| 5 | Tree has unstaged changes | MR flow proceeds; unstaged changes are excluded from the diff, no `git add` |
| 6 | Branch has no upstream | `git push -u origin <branch>` sets upstream before creating |
| 7 | Local ahead of remote | `git push` before creating |
| 8 | Push rejected by remote | git error verbatim, exit non-zero, no auto-pull |
| 9 | No commits ahead of base | `Nothing to merge`, exit non-zero |
| 10 | Jira enabled + branch matches + fetch fails | Aborts, no MR |
| 11 | Jira disabled or branch no-match | Proceeds without ticket context, no error |
| 12 | Lockfile / generated file changed | Excluded from diff body; stat/filename only |
| 13 | Ollama down / model not pulled | Error w/ URL or `ollama pull` hint, exit non-zero |
| 14 | Title missing prefix OR subject >72 | Auto-regenerates; after N failures aborts + prints violations |
| 15 | Body content | Free-form, no format check applied |
| 16 | Candidate shown | Accept / edit / reject offered |
| 17 | User edits | Inline multi-line; edited text used as-is (no re-check) |
| 18 | User rejects | Exits, no MR, no regenerate |
| 19 | CODEOWNERS present | Reviewers suggested via touch-score; multi-select + own entry |
| 20 | No CODEOWNERS / none resolve | Reviewer step skipped, flow continues |
| 21 | `glab api /user` lookup ok | Self set as `--assignee` |
| 22 | `glab api /user` lookup fails | Assignee omitted, flow continues |
| 23 | `autoReviewer.username` set | y/n asked; yes → added as extra `--reviewer` (user/group auto-detected) |
| 24 | `autoReviewer.username` unset | No auto-reviewer prompt |
| 25 | Final summary | Shows title/body/assignee/reviewers + draft toggle + confirm/reject |
| 26 | Draft toggled yes | `--draft` passed to `glab mr create` |
| 27 | User confirms | `glab mr create` runs; MR URL printed |
| 28 | glab create fails | glab stderr verbatim, exit non-zero, no retry |
| 29 | Repo in `dynamicEnvRepos`, MR created | y/n asked; yes → hands off to `dynamicEnvScript` with inherited TTY |
| 30 | Repo not in `dynamicEnvRepos` | No dynamic-env prompt |
| 31 | `dynamicEnvScript` missing at path | Warn + skip; MR success preserved |

---

## 8. Open items / follow-ups

- GitHub (`gh`) support — provider detection + command mapping (parked).
- Whether `dynamicEnvScript` should ever be parameterized (pre-fill env name
  from branch/ticket) — needs the script to accept args; deferred.
- `diff.ignore` reuse: confirm the same noise set fits MR-sized diffs, or if MR
  needs its own larger ignore set.
