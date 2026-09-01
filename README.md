# mole-tools

Global CLI for common git/dev workflows. AI-powered commit messages and merge requests — running fast against your local Ollama or any configured provider.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/danieloxer14/mole-tools/main/install.sh | bash
```

Installs the `mole-tools` binary to `/usr/local/bin` (macOS arm64 only).

---

## Init

### Generation Prerequisites

`commit` and `merge-request` use a model route from `models`, which defaults to
local Ollama. Install and start Ollama, then pull the route's configured model:

```bash
brew install ollama                   # or download from https://ollama.com
ollama pull gemma4:12b
```

The default Ollama URL is `http://localhost:11434`. Start the server before
using generation features.

`review` does **not** use `models` or Ollama. It uses its separately configured
OMP or Claude review agent; see [Review-agent setup](#review-agent-setup).

### Bootstrap Configuration

```bash
mole-tools init
```

Writes a default config template to `~/.config/mole-tools/config.json`. If a config already exists you are prompted before overwriting. This command does not require any prior configuration — it is the entry point for first-time setup. On first run of any other feature, a default template is also created automatically if one is missing.

### Configuration Reference

Location: `~/.config/mole-tools/config.json`
JSONC (JSON with `//` comments) is supported natively.

#### Providers — Where AI Runs

```jsonc
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434"
    },
    "pi": {
      "binary": "pi",
      "projectRoot": "../../optional/path"   // optional — defaults to current dir
    }
  }
}
```

Each provider is given a key (e.g. `ollama`, `pi`) referenced later by model routes. Unknown or legacy fields are rejected at load time.

#### Models — What Each Feature Uses

```jsonc
{
  "models": {
    "commit":       { "provider": "ollama", "name": "gemma3:12b" },
    "mergeRequest": { "provider": "ollama", "name": "gemma3:12b" }
  }
}
```

Every route is **required** and must reference an existing provider key. If a route is missing, the tool fails at startup.

#### Review — Agent and Model Selection

Review-agent selection is independent of `models`. `review.model` is passed to
the selected review agent as `<agent> --model <name>`; it does not configure
Ollama. Omit `review` to use OMP, its default `omp` binary, and OMP's own
default model.

```jsonc
// OMP: choose an OMP-visible model name.
{
  "review": {
    "agent": "omp",
    "model": "openai/gpt-5.2",
    "layerTimeoutSeconds": 600,
    "largeFileLineThreshold": 800
  }
}
```

```jsonc
// Claude: choose a Claude Code model name.
{
  "review": {
    "agent": "claude",
    "binary": "claude",
    "model": "sonnet",
    "layerTimeoutSeconds": 600,
    "largeFileLineThreshold": 800
  }
}
```

`review.binary` replaces only the executable name or path. It is useful for a
non-default installation. `review.model` selects the model for either review
agent: mole-tools forwards it as `omp --model <name>` or
`claude --model <name>`.

The selected model is used for both layer generation and chat. Omit
`review.model` to retain the selected agent's configured default. Both agents
are started with read-only inspection tools (`read`, `grep`, `glob`, `bash`) for
chat; Bash is limited by prompt policy to read-only commands, and prompt edits
cannot grant write access to code under review.

#### Optional Sections

```jsonc
{
  "jira": {
    "enabled": true,
    "branchPattern": "[A-Z]+-[0-9]+",
    "url": "https://your-domain.atlassian.net",    // required when enabled
    "email": "you@example.com",                     // for Jira Cloud (Basic auth)
    "apiKey": "your-api-token"                      // API token
  },
  "diff": {
    "ignore": ["*.lock", "bun.lockb", "package-lock.json", "*.snap"]
  },
  "autoReviewer": { "username": "your-handle" },
  "dynamicEnvRepos": ["org/repo"],
  "dynamicEnvScript": "hack/local/dynamic-env.sh",
  "worktreePrune": {
    "baseDir": "~/repos"
  },
  "review": {
    "agent": "omp",                          // "omp" or "claude"
    "binary": "omp",                         // optional binary override
    "model": "review-model",                 // optional OMP model
    "layerTimeoutSeconds": 600,
    "largeFileLineThreshold": 800
  },
  "reviewBabysitter": {
    "intervalSeconds": 900,
    "assignees": ["review-owner"],
    "aiReviewerUsername": "ai-reviewer",
    "promptFile": "~/.config/mole-tools/prompts/review-babysitter.md",
    "model": "review-model",
    "webhookUrlEnv": "SLACK_WEBHOOK_URL",
    "maxChangedLines": 250,
    "maxChangedFiles": 10,
    "denyPathsByProject": {
      "group/repo": ["src/auth/**", "infra/**"]
    }
  }
}
```

| `reviewBabysitter.intervalSeconds` | Seconds between completed scans; defaults to `900`, minimum `60`. |
| `reviewBabysitter.assignees` | Required GitLab handles; every opened MR is retained when any assignee matches case-insensitively. |
| `reviewBabysitter.aiReviewerUsername` | Non-system note author proving AI review completion after `ai-review` label is absent. |
| `reviewBabysitter.promptFile` + `model` | Prompt file and required OMP model used for isolated, read-only risk assessment. |
| `reviewBabysitter.webhookUrlEnv` | Environment-variable name containing one Slack incoming webhook URL; URL never belongs in config. |
| `reviewBabysitter.maxChangedLines` / `maxChangedFiles` | Strict upper bounds (defaults `250` / `10`); equality is allowed. |
| `reviewBabysitter.denyPathsByProject` | Exact GitLab project-path map. Every project needs an entry; `[]` explicitly allows no denied paths, while matching any glob blocks approval. |

| Field | Purpose |
|---|---|
| `jira.enabled` + creds | Auto-fetches Jira issue details when a ticket key (e.g. `PROJ-123`) is found in the branch name. Used by both `commit` and `merge-request`. |
| `jira.branchPattern` | Regex to extract ticket keys. Default: `[A-Z]+-[0-9]+` |
| `diff.ignore` | File globs excluded from diffs shown to the LLM before generating messages or MR descriptions. |
| `autoReviewer.username` | Enables the "add auto-reviewer?" prompt during merge-request generation. |
| `dynamicEnvRepos` + `dynamicEnvScript` | After creating an MR, repos listed here get an optional dynamic-environment handoff. |
| `worktreePrune.baseDir` | Persisted default base directory scanned by `worktree-prune`. |
| `review.agent` | Selects the independent review adapter (`omp` or `claude`); defaults to `omp`. |
| `review.binary` | Optional executable name/path. Defaults to selected agent name. |
| `review.model` | Optional model name for OMP or Claude, forwarded as `<agent> --model <name>`. |
| `review.layerTimeoutSeconds` | Maximum seconds for one layer-guide run; default `600`. |
| `review.largeFileLineThreshold` | Diff-line count above which a file starts collapsed; default `800`. |

`reviewBabysitter` is optional for other commands, but the babysitter command
rejects startup when its block is absent. Unknown nested keys and invalid limits
are rejected while loading config.

### Prompt File Overrides

Prompt files live beside `config.json`:

```text
~/.config/mole-tools/
├── config.json
└── prompts/
    ├── commit-system.md
    ├── mr-code.md
    ├── mr-plan.md
    ├── mr-system.md
    ├── review-layers-code.md
    ├── review-layers-plan.md
    └── review-chat.md
```

Each prompt is loaded in full. On first use of a missing prompt slot,
`mole-tools` writes its built-in default to that path without overwriting
existing content. Code-mode merge requests use `mr-code.md`, then retain
`mr-system.md` as a legacy fallback; when neither exists, `mr-code.md` is
seeded. Plan-mode merge requests use and seed only `mr-plan.md`. You may instead
create these files before first use. Edit a file, then start a new command or
review-agent turn; no `config.json` change is needed.

| File | Used by | Customise for |
|---|---|---|
| `commit-system.md` | `commit` | Commit-message tone and repository conventions. |
| `mr-code.md` | `merge-request` default `--mode code` | Code-change MR title/description format and repository conventions. |
| `mr-plan.md` | `merge-request --mode plan` | Implementation-plan purpose, scope, and decisions. |
| `mr-system.md` | `merge-request` code-mode legacy fallback | Existing code-change prompt customizations. |
| `review-layers-code.md` | `review` default `--mode code` | Review-layer coverage, priorities, and code-review focus. |
| `review-layers-plan.md` | `review --mode plan` | Requirements, risks, assumptions, and acceptance-criteria review. |
| `review-chat.md` | Review UI chat | Chat-review behavior and response format. |

Review layers are cached per MR. After changing either layer prompt, use
**Regenerate** in the review UI to apply it to existing cached layers. A chat
prompt edit applies to the next newly started chat turn. The review runtime
still enforces read-only tool allowlists and output schemas; prompt text cannot
relax those constraints.

#### Upgrading

Configs written by earlier versions must remove `models.mrReview`, `models.ralph`, and the top-level `mrReview` block. Otherwise startup fails with `Invalid config at <path>`.

---

## Features

Every feature supports the `help` command:

```bash
mole-tools help                     # list all commands with short descriptions
mole-tools help <command>           # detailed help for a specific command (usage, options, notes)
```

### `commit` — Generate Commit Messages

Generates a Conventional Commits message from your staged git changes and runs the commit.

```bash
mole-tools commit                           # interactive: review → accept / edit / reject → push?
mole-tools commit --context "short note"    # extra inline guidance for the LLM
mole-tools commit --auto                    # non-interactive local commit, no prompts, no push
```

| Option | Description |
|---|---|
| `--context <text>` | Invocation-scoped guidance sent to the LLM alongside the diff. Does not change your stored prompts. |
| `--auto` | Skips all interactive prompts and never pushes. Useful in scripts or CI. |

**How it works.** Fetches staged diff → optionally fetches Jira issue details from branch name → sends everything (diff + context + prompt override) to the configured model → formats the message → you accept / edit / reject → committed locally → optional push. If your branch name matches the configured Jira pattern, issue title and description are included in the generation prompt automatically.

**Configuration.** Uses the `commit` model route from config.json. Customise the system prompt via `~/.config/mole-tools/prompts/commit-system.md`.

---

### `merge-request` — Generate GitLab Merge Requests

Creates a merge-request candidate from the current branch, commits any staged changes first (reusing `commit` under the hood), then pushes and opens the MR in GitLab.

```bash
mole-tools merge-request                              # code-description flow (default)
mole-tools merge-request --mode plan                  # implementation-plan description
mole-tools merge-request --context "migration risk"   # extra inline guidance
```

| Option | Description |
|---|---|
| `--mode <code|plan>` | Description prompt mode. Defaults to `code`; `plan` frames an implementation plan by purpose, scope, and decisions. |
| `--context <text>` | Extra guidance for both the commit-phase and MR-description generation. |

**How it works.** Preflight GitLab connection → if staged changes exist, commits them first → pushes branch → collects diff against default branch → fetches Jira issue if present → generates title + description → interactive reviewer selection (with optional auto-reviewer from config) → draft toggle → confirm and create. For repos listed in `dynamicEnvRepos`, an optional dynamic-environment handoff script is offered after creation.

**Configuration.** Uses the `mergeRequest` model route. Customise code descriptions via `~/.config/mole-tools/prompts/mr-code.md`, with `mr-system.md` retained as its legacy fallback. Customise implementation-plan descriptions via `~/.config/mole-tools/prompts/mr-plan.md`. Requires a GitLab host to be reachable (configured through the `pi` provider or environment).

---

### `review` — Interactive GitLab Merge-Request Review

Opens a local, three-column review surface for one GitLab merge request. The
left column tracks generated review layers and coverage, the centre column
shows the changed-file diff, and the right column provides persistent,
read-only agent chat. Comments stay local drafts until you explicitly send
each one as a positioned GitLab discussion.

```bash
mole-tools review https://gitlab.com/acme/api/-/merge_requests/42
mole-tools review https://gitlab.com/acme/api/-/merge_requests/42 --mode plan
mole-tools review https://gitlab.com/acme/api/-/merge_requests/42 --no-open
mole-tools review https://gitlab.com/acme/api/-/merge_requests/42 --refresh
```

| Option | Description |
|---|---|
| `--mode code\|plan` | Review lens; defaults to `code`. Plan mode changes the layer prompt only. |
| `--no-open` | Print the local URL without opening a browser. |
| `--refresh` | Re-fetch the MR head and rebuild the detached review worktree before serving. |

#### Review-agent setup

All review agents need GitLab access, a local Git checkout (or permission to
clone the MR project), and one agent binary. Authenticate GitLab first:

```bash
brew install glab
glab auth login
glab auth status
```

`glab` must be authenticated for the GitLab host in the MR URL. It fetches MR
metadata and discussions, and sends any comments or approval changes you make
in the UI.

**OMP**

```bash
omp --version
omp models                         # list model names available to OMP
omp models find gpt                # optional: search available names
```

Configure OMP's provider credentials through OMP before running a review.
Choose one displayed model name and set it in `review.model`; OMP receives that
selection for both layer generation and chat. Omit the field to retain OMP's
configured default model.

**Claude Code**

```bash
claude --version
claude auth login
claude auth status
```

Set `"agent": "claude"` in `review`. Set `review.model` to any model name
accepted by `claude --model`; mole-tools forwards it for both layer generation
and chat. Omit it to use Claude Code's normal default model.

**Local URL and token.** The CLI binds the server to `127.0.0.1` on an
ephemeral port and prints a URL like
`http://127.0.0.1:<port>/?t=<random-token>`. Token is minted per run and is
not persisted. Every `/api/*` request must send it as `?t=<token>` or the
`X-Mole-Token` header; requests without it receive `401`. Server exists only
while CLI runs. Press Enter in terminal to stop server. `--no-open` only
suppresses browser launch; it does not change server or token behavior.

**Safe worktree lifecycle.** Review prefers current directory when its
`origin` matches MR. Otherwise it reuses or creates a cache clone under
`~/.config/mole-tools/repos/`, then creates detached worktree under
`~/.config/mole-tools/worktrees/<host>/<project>/mr-<iid>/` at MR head. Chat
agent can read only; layer agent writes only review output outside worktree.
Review never edits code under review and never auto-removes worktree when CLI
exits. Worktree persists for restart and can be cleaned deliberately with
`mole-tools worktree-prune` after checking path and any local work.

**Configuration.** `review.agent` selects `omp` (default) or `claude`; set
`review.binary` for a non-default executable and `review.model` for OMP.
Layer output and chat state persist per MR below
`~/.config/mole-tools/reviews/`. Requires authenticated `glab` and selected
agent binary on `PATH`. See
[the interactive review spec](specs/review/interactive-review.md) and
[ADR 0005](docs/adr/0005-review-agent-port.md) for contracts.

### `review-babysitter` — Periodic Safe Merge-Request Approval

Runs a serial monitor over every opened GitLab merge request visible to
authenticated `glab`, retaining requests assigned to one of the configured
handles. It starts one scan immediately, then waits until that scan finishes
before sleeping for `reviewBabysitter.intervalSeconds` (default `900` seconds,
minimum `60`). `SIGINT` or `SIGTERM` finishes the active request and report,
then stops without starting another scan.

```bash
export SLACK_WEBHOOK_URL='https://hooks.slack.com/services/…'
mole-tools review-babysitter
```

Startup requires `reviewBabysitter`, authenticated `glab`, an available OMP
binary/model, and the environment variable named by `webhookUrlEnv`. The
webhook URL is never written to config or reports. Each scan sends one Slack
message with a summary header plus one readable two-line entry per checked
merge request; notifier failure is logged and does not stop later scans. No
matching requests produce a zero-count summary and `ℹ️ No matching open MRs.`.

AI review lifecycle is label-driven: a missing completion note queues exactly
one additive `ai-review` label; a present label reports that review is in
progress; completion requires the label to be absent and a non-system note from
`aiReviewerUsername`. Standalone global MR notes (`individual_note`) do not
count as open threads; only unresolved threaded discussions with non-system
notes block approval. Draft requests, conflicts, unsafe mergeability,
failed/pending/manual/unknown pipelines,
unreadable diffs, configured change/file limits, missing deny-list entries, or
denied paths block approval. An MR with no configured pipeline is not treated
as a failing or pending pipeline. Limits default to `250` changed lines and
`10` files, and equality is allowed. Every project needs an exact
`denyPathsByProject` entry; use `[]` to explicitly deny no paths.
`diff.ignore` does not weaken these checks. If authenticated auto-approver
approval already exists, or GitLab reports `approvals_left: 0`, diff,
deny-list, and AI gates are skipped; merge blockers and remaining approval
requirements are still reported.

Risk assessment runs OMP with the configured prompt/model in a transient
detached MR-head worktree, without write tools. Only an exact final
`VERDICT: LOW — <reason>` permits the current authenticated GitLab user to
approve. Medium/high, malformed, unavailable, timeout, or GitLab approval
failures never claim approval. When approval succeeds but additional required
approvals remain, the report states how many remain. Report entries use
first-match precedence:

```text
*PR Babysitter — Scan summary*
Checked: <count> PRs | Approved: <count> | Blocked: <count> | Waiting: <count>

<url|project!iid> — @<assignee>[, @<assignee>...] — <title>
<emoji> <friendly instruction>
```

Global rows are mutually exclusive. Per-MR rows are evaluated in numbered
order; only the first matching row is rendered.

| Priority | First matching input MR state | Result line |
|---:|---|---|
| Global | No matching MRs | `ℹ️ No matching open MRs.` |
| Global | Global GitLab discovery failure | `❌ GitLab scan failed: <safe error>. Check GitLab access.` |
| 1 | Draft | `⏭️ This MR is draft. Mark it ready when work is ready.` |
| 2 | Merge conflict | `⛔ GitLab reports merge conflicts. Resolve them.` |
| 3 | GitLab reports unresolved discussions | `💬 GitLab reports unresolved discussions. Resolve open discussions.` |
| 4 | Unsafe or unknown merge status | `⛔ GitLab reports unresolved mergeability status.` |
| 5 | CI failed | `❌ Head pipeline is failing. Fix failing jobs.` |
| 6 | CI pending, running, manual, or unknown | `⏳ Head pipeline is not successful yet.` |
| 7 | No configured-AI note and no `ai-review` label | `🏷️ AI review requested.` |
| 8 | `ai-review` label present | `⏳ AI review is in progress.` |
| 9 | Unresolved non-system threaded discussion | `💬 Open discussion needs resolution.` |
| 10 | Author is authenticated approver | `⏭️ Authenticated approver is MR author.` |
| 11 | Existing approval state | `⏳ <count> required approvals remain before merge.` or `✅ Required approvals are satisfied; no auto-approval needed.` |
| 12 | Binary/unknown diff stats, malformed path, or unreadable diff | `⚠️ Not eligible for auto-approval: diff cannot be safely evaluated.` |
| 13 | Total changes exceed limit | `⚠️ Not eligible for auto-approval: total changes exceed <maxChangedLines>.` |
| 14 | File count exceeds limit | `⚠️ Not eligible for auto-approval: changed files exceed <maxChangedFiles>.` |
| 15 | No deny-list entry for project | `⚠️ Not eligible for auto-approval: no deny-list config exists for this project.` |
| 16 | Changed path matches deny glob | `⚠️ Not eligible for auto-approval: changed path <path> matches denied glob <glob>.` |
| 17 | OMP verdict `MEDIUM` or `HIGH` | `⚠️ Not eligible for auto-approval: AI assessed <risk> risk: <safe reason>.` |
| 18 | OMP timeout, error, or invalid verdict | `⚠️ Not eligible for auto-approval: AI assessment is inconclusive.` |
| 19 | GitLab approval rejected or head changed | `❌ Approval was not applied.` |
| 20 | GitLab approval succeeds | `✅ Auto-approved after low-risk AI assessment.` If more approvals remain, the line states the count. |
| Error | Exception while obtaining next required input | `❌ Check could not complete: <safe error>.` |

The babysitter does not post review comments, add a “requires review” label,
remove labels, change assignees, rerun CI, merge requests, retry prompts or
approvals, or replace the interactive one-MR `review` surface. It does not
provide project/group filters, Slack Bot OAuth, arbitrary channel routing, or
literal webhook secrets.

---
### `worktree-prune` — Clean Up Stale Git Worktrees

Scans a directory tree for Git repositories, identifies extra (non-primary) worktrees, and lets you remove them interactively. Failed removals are summarised and can be force-deleted.

```bash
mole-tools worktree-prune                           # uses config or prompts for base dir
mole-tools worktree-prune --baseDir ~/my-repos      # explicit scan root
```

| Option | Description |
|---|---|
| `--baseDir <path>` | Override the scanned directory. Resolution order: flag → `worktreePrune.baseDir` in config → interactive prompt (persisted on first use). |

**How it works.** Discovers all Git repos under base directory → lists extra worktrees per repo → interactive multi-select to choose which ones to prune → normal removal attempted → failures get an LLM-generated summary of potential loss → force-delete offered per item.

---

### `help` — Built-in Help (All Commands)

```bash
mole-tools help                      # list all commands
mole-tools help commit               # detailed usage, options, examples, notes for a command
```

Every feature exposes its CLI options with descriptions and examples directly through this system. Run it whenever you need a quick reference.

---

## Development

### Prerequisites

- [Bun](https://bun.sh) runtime
- A clean working directory clone of the repo

### Building

```bash
bun install                          # install dependencies
bun run build                        # compile to standalone binary (macOS arm64)
./mole-tools --version               # verify binary works
```

Produces `mole-tools` — a standalone compiled binary with no external `node_modules` requirement at runtime.

### Running from Source

```bash
bun run dev <command> [args...]       # e.g. bun run dev commit, bun run dev help
```

Runs the CLI directly against TypeScript sources without building.

### Testing

```bash
bun test                             # run all tests (unit + adapter + e2e)
bun test --coverage                  # with coverage output
```

Tests live alongside source under `src/` (`*.test.ts`) and in a top-level `test/` directory for integration scenarios.

### Linting

```bash
bun run lint                         # biome check (formatting + linting)
```

### Releasing

From a **clean** working tree:

```bash
gh auth login                        # one-time setup if not already authenticated
bun run release patch                # or: minor, major
```

Bumps `package.json`, builds the binary, commits and tags `v<version>`, pushes the commit/tag to origin, and creates a GitHub release with the compiled macOS arm64 asset. A dirty working tree will abort the release automatically.

### Project Structure (Quick Reference)

| Path | Description |
|---|---|
| `src/index.tsx` | CLI entry point — command registration, config loading, Ink UI bootstrap |
| `src/core/` | Context, error handling, feature interface |
| `src/features/` | One directory per surviving feature (commit, merge-request, worktree-prune, init) |
| `src/adapters/` | Config loader, prompt loader, provider adapters, VCS/host implementations |
| `specs/` | Design docs and architecture notes |
