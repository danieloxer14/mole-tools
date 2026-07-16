# mole-tools — MR-Review Tool Spec

**Status:** Ideation / product-grilled. No implementation yet.
**Date:** 2026-07-16
**Author:** Daniel Oxer
**Companions:** [merge-request-tool.md](../merge-request/merge-request-tool.md), [architecture/architecture.md](../architecture/architecture.md)
**Source of behaviour:** heavily based on the `mr-reviewer` Electron app
(`/Users/danieloxer/dev/mr-reviewer`), trimmed to a CLI feature and re-cast
around **file-defined review agents**.

The **mr-review** tool. Runs one or more file-defined review agents against a
GitLab MR, writes their findings to disk, and publishes them back to the MR.
Reuses mole-tools' `GitHost`/glab abstraction, `IssueTracker`/Jira adapter, LLM
routing, and cost ledger; reuses mr-reviewer's finding JSON shape and publishing
strategy.

---

## 1. Product framing

### Why it exists

An automated MR review pass, driven by review agents that are **defined by
file**, not hardcoded. Each agent is a markdown file (frontmatter + prompt) that
declares what it checks, which provider/model runs it, whether it can run in
parallel, and what context it needs. The tool fetches MR context, fans agents
out under a concurrency policy, collects structured findings, and posts them to
the MR the way `mr-reviewer` does — but as a lean CLI feature with per-agent cost
accounting, no Electron, no UI.

### Design stance (carried from the other tools)

- Fail-fast and deterministic over clever recovery.
- The reviewer `.md` files own review **content**; the tool owns **structure**,
  **context assembly**, **execution policy**, and **publishing**.
- Reuse existing mole-tools ports (`GitHost`, `IssueTracker`, `Llm`,
  `CostTracker`) rather than adding parallel machinery.

### Relationship to mr-reviewer

Reused ideas: finding JSON shape (`ParsedComment`), publishing strategy (inline
anchoring + `suggestion` blocks + grouped recommendations), Jira-key extraction,
diff-line resolution. Rebuilt: reviewers are **authored files**, not TS personas
+ DB prompt versions. Added: real per-agent cost accounting (mr-reviewer runs on
subscription billing and tracks none).

---

## 2. Invocation

- `mole-tools mr-review <mr-url>` — full GitLab MR URL as a positional arg.
- Run from **inside a checkout of the MR's source branch** (see §5.10). GitLab
  only (`glab`). GitHub is out of scope.

---

## 3. Configuration (keys used by this tool)

| Key | Purpose |
|-----|---------|
| `mrReview.concurrency` | Max number of review agents running at once (default 2). Counts **all** in-flight agents, parallel and non-parallel (§5.7). |
| `mrReview.authorUsername` | GitLab username that appears as the author of posted MR comments. Must exist in the project (validated at preflight via handle resolution). Optional — when omitted, comments post as the authenticated glab user. |
| `providers.*` | Connection settings for the providers named in reviewer files (shared). |
| `jira.*` | Optional ticket context for `story` inputs (shared, key-pattern gated). |

Reviewer files are **not** config keys — they are discovered from directories
(§4.2). Model choice is **not** a routing purpose — every reviewer names its own
provider + model (§5.3), so no new `models.mrReview` purpose is added.

---

## 4. Reviewer agent files

### 4.1 File shape

One agent per markdown file. Frontmatter + prompt body:

```markdown
---
name: Correctness
description: Flags logic errors, off-by-ones, and unhandled cases in the diff.
provider: pi            # must exist in config.providers
model: claude-opus-4-8  # must be priced in the cost catalog
parallel: true          # may overlap with other agents
inputs: [diff, codebase] # subset of: diff | story | codebase
---

You are a correctness reviewer. Review the changes for ...
(the review-lens prompt body)
```

Frontmatter fields (all **required** except where noted):

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | Human-readable agent name (shown in the picker + cost table). |
| `description` | string | One-line summary of what it checks (shown in the picker). |
| `provider` | string | Provider profile key; must exist in `config.providers`. |
| `model` | string | Model id; must be priced in the cost catalog. |
| `parallel` | boolean | `true` → may run concurrently with anything; `false` → only one non-parallel agent runs at a time (§5.7). |
| `inputs` | string[] | Context this agent needs. Subset of `diff`, `story`, `codebase`. |

The **agent id** is the filename without `.md` (e.g. `correctness.md` → id
`correctness`). Used for the output filename and dedup/override.

### 4.2 Discovery + precedence

Two directories, merged by id:

1. Global: `~/.config/mole-tools/reviewers/*.md`
2. Project: `<repo-root>/.mole-tools/reviewers/*.md`

A project file with the same id as a global file **overrides** it (project
wins). The merged set is what the picker shows. No reviewers found in either
directory → clear error, exit non-zero.

### 4.3 Validation (load time, fail fast)

Each reviewer is validated before the run starts. First failure aborts with a
message naming the offending file + field:

- Missing/invalid frontmatter field → abort.
- `provider` not in `config.providers` → abort.
- `model` not priced in the catalog → abort.
- `inputs` contains `codebase` **and** the named provider/model does **not**
  expose the `agentic-workspace` capability → abort (only agentic providers can
  traverse files; §5.4).

---

## 5. UX flow (ordered)

1. **Preflight.** Verify `glab` installed + authenticated → abort clearly if not.
2. **Parse URL.** Extract project path + MR IID from `<mr-url>`. Malformed URL →
   abort.
3. **Load + validate reviewers** (§4.2, §4.3). Empty set → abort.
4. **Select agents.** Interactive multi-select listing each agent's `name` +
   `description` (§5.1). No non-interactive flag in v1.
5. **Fetch context** (§5.5):
   a. Attempt Jira: extract keys from MR title/description, fetch the item(s).
   b. Pull MR description + existing review comments.
   c. Compute the diff of the changes via glab.
6. **Write context files** into the run subfolder (§5.6), one per context item.
7. **Prune agents.** Any selected agent that needs `story` but no Jira item was
   resolved → **skipped with a warning** (§5.5a). Remaining agents proceed.
8. **Run agents** under the concurrency policy (§5.7), each fed only its declared
   inputs, run on its own provider/model. Per-agent output parsed + written to
   `<subfolder>/<agent-id>.findings.json` (§5.8). Cost recorded per agent.
9. **Summary + confirm.** Show findings count grouped by severity and by agent,
   plus which agents failed/were skipped → `ctx.ui.confirm` before posting.
10. **Publish** (on confirm) the collected findings to the MR (§5.9).
11. **Cost table.** Render a Ralph-style per-agent cost table (§5.11).

---

## 5. Resolved behaviour

### 5.1 Agent selection
- Interactive `ctx.ui.multiSelect` only. Label = `name` — `description`.
- User selects zero → nothing to do, exit 0 with a message.

### 5.2 MR input
- Full MR URL positional arg. Project path + IID parsed from the URL and used
  for all glab calls. No current-branch fallback, no MR picker in v1.

### 5.3 Provider / model (mandatory per file)
- Every reviewer names its own `provider` + `model`. No hidden routing default;
  no `models.mrReview` purpose. Agents on the same run may use different
  providers/models. Both are validated at load (§4.3).

### 5.4 Codebase input needs an agentic provider
- `inputs: [codebase]` means the agent traverses the working tree live. Only
  providers exposing `agentic-workspace` (e.g. `pi`) can do this; they run via
  `llm.runAgent`. Agents without `codebase` run via `llm.generate`.
- A `codebase` agent pinned to a text-only provider (e.g. `ollama`) → **fail at
  load**, before any work (§4.3). No auto-routing, no pre-injection fallback.

### 5.5 Context fetch
- **a. Jira (best-effort).** Extract keys (`\b[A-Z][A-Z0-9]+-\d+\b`) from MR
  title + description; fetch each via the `IssueTracker` adapter. Not
  configured, no key, or lookup fails → treated as **no story**. Agents that
  declare `story` are then skipped (§5, step 7) with a warning; agents that
  don't declare `story` are unaffected. (Best-effort, mirrors mr-reviewer's
  Quentin-skip; not fail-fast.)
- **b. MR description + existing review comments.** Fetch via glab. Existing
  comments are both **captured to a file and fed to agents** so they avoid
  re-raising resolved points.
- **c. Diff.** The unified diff of the MR's changes via glab (`glab mr diff` /
  the changes API), including `diff_refs` (base/head/start sha) needed for inline
  anchoring (§5.9). Diff source is **glab (the MR)**, not local `git diff`.

### 5.6 Run folder + context files
- Run subfolder: `.mr-review/<iid>-<title-slug>/` under the directory the tool
  is run from. Title slugified (lowercase, non-alnum → `-`, collapsed); IID
  prefix guarantees uniqueness.
- Re-running the same MR **overwrites** the subfolder (fresh review).
- Context written as **separate files**, one per item from §5.5:
  - `story.md` — Jira item(s) (summary + description; empty/absent if none).
  - `mr.md` — MR description + existing review comments.
  - `diff.patch` — the unified diff.
- Each agent reads only the files matching its declared `inputs` (`diff` →
  `diff.patch`, `story` → `story.md`, `codebase` → live traversal of cwd).

### 5.7 Execution policy (parallel vs non-parallel)
- `mrReview.concurrency` (default 2) caps the number of agents running at any
  moment, **counting all in-flight agents** (parallel + non-parallel).
- Additional rule: **at most one `parallel: false` agent runs at a time.** A
  non-parallel agent may overlap parallel agents, but never another
  non-parallel agent.
- So the scheduler admits an agent only if: total in-flight < cap **and** (the
  agent is `parallel: true` **or** no other non-parallel agent is currently
  running).

### 5.8 Per-agent output
- Each agent produces findings as JSON. The **tool** parses the agent's final
  output (defensive parse, mr-reviewer's `parseFindingsJson` behaviour — bad
  JSON / non-array degrades to `[]`, never throws) and writes
  `.mr-review/<subfolder>/<agent-id>.findings.json`.
- Finding schema = mr-reviewer's `ParsedComment`, minus re-review fields:
  ```ts
  {
    severity: 'critical' | 'important' | 'minor' | 'recommendation'
    filePath: string | null
    lineStart: number | null
    lineEnd: number | null
    description: string
    fix: string | null
    suggestion: string | null   // literal replacement → GitLab ```suggestion``` block
    category?: string           // agent id
    funMessage?: string | null  // optional
  }
  ```
  Dropped: `followUpOf`, `followUpKind` (re-review is out of scope).
- An agent that errors (LLM failure, empty/garbage output) → **no findings file**,
  recorded as failed; the run continues (§5.12).

### 5.9 Publishing (full mr-reviewer fidelity)
- On confirm, all collected findings are deduped, then posted via the glab
  abstraction:
  - `critical` / `important` / `minor` → posted **individually**, anchored
    **inline** where the file + line resolve against the diff (diff-line
    resolver → GitLab `{new_line, old_line}` position with `base/head/start
    sha`), else fall back to a **global note**.
  - All `recommendation`-tier findings collapse into **one grouped note**,
    sub-grouped by agent.
  - A `suggestion` with a clean contiguous in-diff range renders as a GitLab
    ` ```suggestion:-0+N ``` ` block ("Apply suggestion" button).
  - When `mrReview.authorUsername` is set, comments post as that user (resolved
    via handle lookup). If resolution fails, abort before publishing with a
    clear error naming the unresolvable username.
- Posting goes through the `GitHost` port (new methods on `GlabAdapter`,
  following the injectable-exec + `PortError` pattern), not raw REST.

### 5.10 Working directory assumption
- The tool assumes cwd is a repo checked out on the MR's source branch. If the
  current branch != the MR's source branch → **warn** (agents may traverse code
  that doesn't match the diff) but continue. No worktree creation, no
  fetch/checkout (out of scope).

### 5.11 Cost accounting
- Per-agent LLM usage/cost recorded via `CostTracker.record` (provider-native
  where available, estimated via the catalog otherwise), one `CostEntry` per
  agent, `task` = agent id.
- At the end, render a **Ralph-style table** (`renderTable` /
  `formatRalphCostSummary` conventions): one row per agent (name, model, in/out
  tokens, USD + source), plus a total row. Failed agents shown with their
  (partial/zero) cost.
- No durable per-run ledger file. The existing `runWithCostAccounting` wrapper
  already appends the session to `cost-history.jsonl`.

### 5.12 Failure handling
- Agent-level failures are **isolated**: a failed agent is recorded (no findings
  file, marked failed in the cost table), remaining agents run, and the
  successful findings are still published after confirm. End-of-run report names
  which agents failed and which were skipped (missing story).
- Preflight / URL-parse / reviewer-validation / context-fetch(diff) failures are
  **fatal** (abort before running agents).

---

## 6. Scope

### In
- `mole-tools mr-review <mr-url>`, GitLab-only, run from a branch checkout.
- glab preflight; URL → project + IID parse.
- File-defined review agents from global + project dirs (project overrides),
  with frontmatter validation (provider/model/inputs/parallel).
- Interactive multi-select of agents.
- Best-effort Jira fetch; MR description + existing comments; glab diff — each
  written to a separate context file in `.mr-review/<iid>-<slug>/`.
- Existing comments fed to agents (dedup context).
- Concurrency-capped execution (cap counts all; ≤1 non-parallel at a time);
  agentic providers for `codebase` agents, text providers otherwise.
- Per-agent findings JSON (mr-reviewer `ParsedComment` shape, minus re-review
  fields; optional `funMessage`).
- Confirm-then-publish with full fidelity (inline + `suggestion` + grouped recs).
- `mrReview.authorUsername`: optional config for the GitLab user that posts
  comments. Resolved ahead of publish; abort if unresolvable.
- Per-agent cost table (Ralph-style) + auto cost-history append.
- Partial-publish resilience: failed/skipped agents don't stop the run.

### Out (this phase)
- Knowledge base.
- Auto-fixes.
- Auto MR fetching / polling / MR picker / current-branch fallback.
- Any UI beyond the existing Ink prompts (select/confirm).
- Comment replies + thread resolution.
- Worktree creation / branch fetch-checkout.
- Re-review / follow-up verdicts (`followUpOf`/`followUpKind`).
- Non-interactive `--reviewers` flag.
- Auto-routing or pre-injection fallback for `codebase` agents on text-only
  providers (these fail at load instead).
- GitHub / `gh`.
- Durable per-run cost ledger file.

---

## 7. Acceptance criteria

| # | Given | Then |
|---|-------|------|
| 1 | `glab` missing or unauthenticated | Clear abort up front, exit non-zero, no work |
| 2 | Malformed MR URL | Abort with parse error, exit non-zero |
| 3 | No reviewer files in either dir | Clear "no reviewers configured" error, exit non-zero |
| 4 | Global + project file share an id | Project file wins (overrides global) |
| 5 | Reviewer names a provider not in config | Abort at load naming file + field |
| 6 | Reviewer names a model not in the cost catalog | Abort at load naming file + field |
| 7 | Reviewer declares `codebase` on a text-only provider | Abort at load (agentic capability required) |
| 8 | Reviewer frontmatter missing a required field | Abort at load naming file + field |
| 9 | Agents presented | Multi-select shows each agent's name + description |
| 10 | User selects zero agents | Exit 0 with a message, no fetch/run |
| 11 | MR title/description contains a Jira key | Item fetched and written to `story.md` |
| 12 | No Jira key / unconfigured / lookup fails | `story.md` empty; `story` agents skipped with a warning; others run |
| 13 | Context fetched | `story.md`, `mr.md`, `diff.patch` written under `.mr-review/<iid>-<slug>/` |
| 14 | Existing MR comments present | Captured to `mr.md` **and** fed into agent prompts |
| 15 | Re-run on same MR | Subfolder overwritten (fresh review) |
| 16 | Diff needed | Sourced from glab (the MR), incl. base/head/start sha; not local `git diff` |
| 17 | Current branch != MR source branch | Warn, continue |
| 18 | Agent declares only `diff` | Fed `diff.patch`, run via `generate`; no code traversal |
| 19 | Agent declares `codebase` | Run via `runAgent` on an agentic provider; traverses cwd |
| 20 | `mrReview.concurrency` = N | Never more than N agents in flight at once |
| 21 | Two non-parallel agents both ready | Only one runs at a time (may overlap parallel agents) |
| 22 | Agent completes | `<agent-id>.findings.json` written with `ParsedComment`-shaped findings |
| 23 | Agent emits bad/non-array JSON | Degrades to no findings, agent marked failed, run continues |
| 24 | Any agent fails | Remaining agents run; failure reported; successful findings still publishable |
| 25 | Before publishing | Summary (by severity + agent, incl. failed/skipped) shown + confirm prompt |
| 26 | User rejects the confirm | Nothing posted; files remain on disk; cost table still shown |
| 27 | Critical/important/minor finding with resolvable line | Posted inline at the correct diff position |
| 28 | Finding line not resolvable | Posted as a global note (fallback) |
| 29 | Recommendation-tier findings | Collapsed into one grouped note, sub-grouped by agent |
| 30 | Finding has a clean in-diff `suggestion` | Rendered as a GitLab ```suggestion``` block |
| 31 | `mrReview.authorUsername` set to valid user | All posted comments appear authored by that user. On unresolvable username, abort before publishing with clear error naming the username. |
| 32 | `mrReview.authorUsername` absent | Comments post as the authenticated glab user (current behavior) |
| 33 | Run completes | Ralph-style per-agent cost table (name/model/in/out/USD) + total printed |
| 34 | Run completes | Session appended to `cost-history.jsonl` (existing wrapper) |

---

## 8. Open items / follow-ups

- Non-interactive `--reviewers a,b,c` flag for scripted runs (parked; picker-only
  in v1).
- Whether `mrReview.concurrency` should default off (serial) vs 2.
- New `GitHost` methods for reading an MR by URL and posting inline/global notes
  + editing a progress note — likely warrants an ADR (GitLab discussion-posting
  abstraction) and a `FakeGitHost` extension.
- Confirm the diff-line resolver port from mr-reviewer (`diffLineResolver.ts`)
  fits mole-tools' glab-sourced diff format unchanged.
- Prior-comment dedup is context-only (fed to agents); no structured
  reconstruction of prior findings from note markers (that's mr-reviewer
  re-review territory, out of scope).
```