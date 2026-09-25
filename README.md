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
OMP, Claude, or Codex review agent; see [Review-agent setup](#review-agent-setup).

### Bootstrap Configuration

```bash
mole-tools init
```

Writes a default config template to `~/.config/mole-tools/config.json`. If a config already exists you are prompted before overwriting. This command does not require any prior configuration — it is the entry point for first-time setup. A configuration-backed feature also creates the default template automatically when no config exists; `help` and `--version` bypass config loading.

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

Each provider is given a key (e.g. `ollama`, `pi`) referenced later by model routes. Unknown fields are rejected at load time. The loader also normalizes supported legacy configurations during upgrade; see [Upgrading](#upgrading).

#### Models — What Each Feature Uses

```jsonc
{
  "models": {
    "commit":       { "provider": "ollama", "name": "gemma4:12b" },
    "mergeRequest": { "provider": "ollama", "name": "gemma4:12b" }
  }
}
```

Every route is **required** and must reference an existing provider key. If a route is missing, the tool fails at startup.

#### Review — Agent and Model Selection

Review-agent selection is independent of `models`. `review.model` is passed to
the selected review agent (`omp --model <name>`, `claude --model <name>`, or
`codex exec -m <name>`); it does not configure Ollama. Omit `review` to use the
default Claude agent, its default `claude` binary, and Claude's own current
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
    "largeFileLineThreshold": 800,
    "maxLayerPromptBytes": 100000
  }
}
```

```jsonc
// Codex: choose a Codex model name.
{ "review": { "agent": "codex", "model": "gpt-5.2", "layerTimeoutSeconds": 600, "largeFileLineThreshold": 800 } }
```

`review.binary` replaces only the executable name or path. It is useful for a
non-default installation. `review.model` selects the model for any review
agent: mole-tools forwards it as `omp --model <name>`,
`claude --model <name>`, or `codex exec -m <name>`.

The selected model is used for both layer generation and chat. Omit
`review.model` to retain the selected agent's configured default. OMP and
Claude are started with read-only inspection tools (`read`, `grep`, `glob`,
`bash`) for chat; Bash is limited by prompt policy to read-only commands.
Codex chat turns run in Codex's `read-only` sandbox. Every Codex invocation
also marks the review working directory as `untrusted`, so project-local
Codex configuration cannot grant reviewed code access to local MCP commands
or broader workspace/network permissions. Codex layer and comment-from-chat
turns run in `workspace-write` with the review output directory added via
`--add-dir`; in those turns the review worktree is also writable to Codex, so
prompt policy is the guard, as for OMP's `bash` tool. This write access is an
intentional exception to the read-only review boundary, limited to turns that
Claude quick picks use static names; Codex quick picks are discovered from the
selected Codex CLI's `codex debug models` catalog. You can still type any model,
or leave the model blank to use Codex's configured default.

Review agent and model can also be selected from the **Settings** dialog's
**Prompts** tab. Changes apply to the next layer run or chat turn; use
**Regenerate** to rebuild cached layers.
Prompt versions can select an agent and model independently. A version whose
agent is **Default** inherits the global Review agent/model above; a version
with an explicit agent uses that agent and its version model (or no `--model`
flag when that model is blank). Chats keep the agent/model they were bound to
when created, even after the global setting or prompt version changes. For a
non-default agent kind, mole-tools uses the `omp`, `claude`, or `codex` binary from
`PATH`; `review.binary` applies only when the selected agent is the configured
default.


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
    "ignore": ["*.lock", "pnpm-lock.yaml", "bun.lockb", "package-lock.json", "*.snap"]
  },
  "autoReviewer": { "username": "your-handle" },
  "dynamicEnvRepos": ["org/repo"],
  "dynamicEnvScript": "hack/local/dynamic-env.sh",
  "worktreePrune": {
    "baseDir": "~/repos"
  },
  "review": {
    "agent": "claude",                       // "omp", "claude", or "codex"; default "claude"
    "binary": "claude",                     // optional binary override
    "model": "review-model",                // optional model for the selected agent
    "layerTimeoutSeconds": 600,
    "largeFileLineThreshold": 800,
    "maxLayerPromptBytes": 100000
  },
  "reviewBabysitter": {
    "intervalSeconds": 900,
    "scheduleTimes": ["09:00", "12:00", "15:00"],
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

| Field | Purpose |
|---|---|
| `reviewBabysitter.intervalSeconds` | Seconds between completed scans; defaults to `900`, minimum `60`. Ignored when `scheduleTimes` is set. |
| `reviewBabysitter.scheduleTimes` | Optional list of 24-hour `HH:MM` local times (e.g. `["09:00", "12:00", "15:00"]`); scans run only at these times instead of every `intervalSeconds`, and the first scan waits for the next one. |
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
| `review.agent` | Selects the independent review adapter (`omp`, `claude`, or `codex`); defaults to `claude`. |
| `review.binary` | Optional executable name/path. Defaults to selected agent name. |
| `review.model` | Optional model name for the selected review agent, forwarded as `omp --model <name>`, `claude --model <name>`, or `codex exec -m <name>`. |
| `review.layerTimeoutSeconds` | Maximum seconds for one layer-guide run; default `600`. |
| `review.largeFileLineThreshold` | Diff-line count above which a file starts collapsed; default `800`. |
| `review.maxLayerPromptBytes` | Maximum UTF-8 bytes sent to one layer-guide run; default `100000`. |

`reviewBabysitter` is optional for other commands, but the babysitter command
rejects startup when its block is absent. Unknown nested keys and invalid limits
are rejected while loading config.

### Prompts — Presets and Versions

Prompt presets and their version history live beside `config.json`:

```text
~/.config/mole-tools/
├── config.json
└── prompts/
    └── <slot>/
        └── <preset>/
            └── NNN.md
```

The eight prompt slots are `commit-system`, `mr-code`, `mr-plan`,
`review-layers-code`, `review-layers-plan`, `review-chat`,
`review-explain-comment`, and `review-comment-from-chat`. Each slot can
have multiple named presets. The active text is the highest-numbered version
of the active preset. The shipped default seeds `default/001.md` on first
access, and `config.prompts` records the active preset per slot (a missing
entry means `default`).
The five review prompt slots are managed from the review UI's **Prompts &
Models** overlay. Saving creates a new version, **Roll back** copies an older
version forward as a new latest version, and **Reset** writes the shipped
default as a new version. This history is append-only: mole-tools never
deletes prompt versions. The `commit-system`, `mr-code`, and `mr-plan`
presets are selected in `config.json`'s `prompts` map; their text edits still
live under `~/.config/mole-tools/prompts/`.

Existing flat prompt files migrate lazily, once on first access of their slot:
`prompts/<slot>.md` becomes `<slot>/default/001.md`. The former
`prompts/mr-system.md` migrates to `mr-code/default/001.md` only when
`mr-code.md` is absent. Do not move these files manually; the first read
preserves their text in the new layout. `mr-system` is no longer a prompt slot.

Activating a preset, changing review-agent settings, or changing the color
theme persists the choice with `updateConfig`. That helper rewrites
`config.json` and does not preserve comments, so keep important notes outside
the generated config.

User-authored review skills are stored separately under
`~/.config/mole-tools/skills/<name>/`:

```text
~/.config/mole-tools/
└── skills/<name>/
    ├── skill.json
    └── NNN.md
```

`skill.json` records the active version and most recent use; each `NNN.md`
file contains one version of the skill text.

Each version file may begin with YAML-style frontmatter containing optional
agent/model metadata:

```text
---
agent: omp
model: openai/gpt-5.2
---
Review the changed code for correctness and risk.
```

When `agent` is unset, the version inherits the global Review agent and model.
When an agent is set with a blank model, the run sends no `--model` flag.
Frontmatter is ignored by the commit and MR prompts; those slots continue to
use their `models.*` LLM routes.

| Slot | Used by | Customise for |
|---|---|---|
| `commit-system` | `commit` | Commit-message tone and repository conventions. |
| `mr-code` | `merge-request` default `--mode code` | Code-change MR title, description format, and repository conventions. |
| `mr-plan` | `merge-request --mode plan` | Implementation-plan purpose, scope, and decisions. |
| `review-layers-code` | `review` default `--mode code` | Review-layer coverage, priorities, and code-review focus. |
| `review-layers-plan` | `review` default `--mode plan` | Requirements, risks, assumptions, and acceptance-criteria review. |
| `review-chat` | Review UI chat | Chat-review behavior and response format. |
| `review-explain-comment` | Review UI **Explain** on a GitLab discussion | Prompt for explaining a review comment in a new chat. |
| `review-comment-from-chat` | "Comment from chat" | Review UI |

Review layers are cached per MR. After changing either layer prompt, use
**Regenerate** in the review UI to apply it to existing cached layers. A chat
prompt edit applies to the next newly started chat turn. The review runtime
still enforces read-only tool allowlists and output schemas; prompt text cannot
relax those constraints.

#### Upgrading

Legacy flat prompt files migrate automatically on first access as described
above. Configs written by earlier versions that contain unsupported fields
must still be migrated to the current `providers`/`models` shape before
startup; otherwise startup fails with `Invalid config at <path>`.


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

**How it works.** Fetches staged diff → optionally fetches Jira issue details from branch name → sends everything (diff + context + active prompt preset) to the configured model → formats the message → you accept / edit / reject → committed locally → optional push. If your branch name matches the configured Jira pattern, issue title and description are included in the generation prompt automatically.

**Configuration.** Uses the `commit` model route from config.json. The active `commit-system` prompt preset supplies the system prompt; set it in `config.json`'s `prompts` map, since the review UI's **Prompts & Models** overlay manages the five review slots.


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
**Configuration.** Uses the `mergeRequest` model route. The active `mr-code` or `mr-plan` prompt preset supplies the description prompt; set it in `config.json`'s `prompts` map, since the overlay manages the five review slots. Requires `glab` to be installed and authenticated for the GitLab host in the MR URL.


---

### `review` — Interactive GitLab Merge-Request Review

Opens a local, three-column review surface for one GitLab merge request. The
left column tracks generated review layers and coverage, the centre column
shows the changed-file diff, and the right column provides persistent,
read-only agent chat. Comments stay local drafts until you explicitly send
each one as a positioned GitLab discussion. Each published discussion has an
**Explain** button that opens a new chat pre-loaded with the comment and its
surrounding diff: the chat is titled `Explain: …` after the comment, and its
first turn uses the active `review-explain-comment` prompt preset, the comment's notes,
and a diff excerpt around the anchored line (marked `>`) — or
`No diff excerpt available for this comment.` for a general discussion — so
the agent replies with a plain-language explanation you can follow up on.

Drafts support local Write/Preview Markdown modes. Published positioned and
general discussions render sanitized GitHub-flavoured Markdown; collapsed
discussion summaries remain plain text.

The **Settings** dialog has three tabs: **Prompts**, **Skills**, and
**Appearance**. The **Prompts** tab manages the five review prompt slots
(`review-layers-code`, `review-layers-plan`, `review-chat`,
`review-explain-comment`, `review-comment-from-chat`), their presets and
versions, plus the review agent and model. Changes apply to the next layer
run or chat turn; use **Regenerate** to rebuild cached layers.

### Skills

The **Skills** tab lists each skill and its active version in a scrollable
column; **New skill** stays pinned at the top while that list scrolls.
**New skill** opens a cancellable name dialog. The dialog shows `Name is
required`, `Use only letters, numbers, _ and -`, `Name must be more than 3
characters`, `Name must be 64 characters or fewer`, or `A skill with this name
already exists` inline as applicable. **Create** stays disabled until the name
is valid. Skills cannot be renamed. Choose a version from the version dropdown.
**Activate** makes a selected inactive version active; **New version** copies
the editor text into the next version and activates it. **Save** overwrites the
active version, while inactive versions are read-only. **Delete** asks for
confirmation and removes the skill and all its versions.

In chat, type `/` at the start of the message or after whitespace to open a
popover above the slash with up to three most-recently-used skills; continue
typing to filter by name prefix, use the arrow keys to move, and press Enter to
select. The composer placeholder also explains how to open this menu. When no
skills match, **No matches** appears with a plus button that opens Settings
directly to the Skills tab. A selected skill appears as a highlighted
`/<name>` tag, and Backspace or Delete removes the whole tag. When sent, the
server replaces tags with their skills' active text; the transcript shows the
tags instead of that text.

The **Appearance** tab has a **Color theme** dropdown: **Default** (dark) or
**Light** (light-grey background, dark-grey text, orange accents slightly
lighter than in Default). The
choice applies immediately and is saved as `appearance.colorTheme`
(`"default"` or `"light"`) in `config.json`.


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

Claude is the default review agent. Set `review.model` to any model name
accepted by `claude --model`; mole-tools forwards it for both layer generation
and chat. Omit it to use Claude Code's normal current default model.

**Codex CLI**

```bash
codex --version
codex login
codex login status
```

Set `review.model` to a model accepted by `codex exec -m`; omit it to use
Codex's configured default.

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
`~/.config/mole-tools/worktrees/<host>/<project>/mr-<iid>/` at MR head. Layer
output lives outside the worktree. OMP and Claude chat use read-only inspection
tools; Codex chat uses a `read-only` sandbox. Codex layer and comment-from-chat
turns run in `workspace-write`, so the review worktree is also writable; prompt
policy is the guard against editing code under review. The worktree persists
for restart and is not auto-removed when the CLI exits; clean deliberately with
`mole-tools worktree-prune` after checking path and any local work.

**Configuration.** `review.agent` selects `claude` (default), `omp`, or
`codex`; set `review.binary` for a non-default executable and `review.model`
for any of them.
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
minimum `60`). When `reviewBabysitter.scheduleTimes` lists 24-hour `HH:MM`
local times instead, scans run only at those times: the first scan waits for
the next configured time rather than starting immediately, and
`intervalSeconds` is ignored. `SIGINT` or `SIGTERM` finishes the active
request and report, then stops without starting another scan.

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
`aiReviewerUsername`. A healthy MR blocked only by a merge dependency also
queues this review before the dependency merges; it never gets assessed or
approved while dependency-blocked. Standalone global MR notes (`individual_note`)
do not count as open threads; only unresolved threaded discussions with
non-system notes block approval. Draft requests, conflicts, unsafe mergeability,
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

<url|title> — @<assignee>[, @<assignee>...]
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
| 4a | `merge_request_blocked` with successful or unconfigured pipeline | `🏷️ AI review requested.`, `⏳ AI review is in progress.`, or `⛔ Blocked by a merge dependency.` depending on label and completion note |
| 4b | Unsafe or unknown merge status, or dependency block with non-healthy pipeline | `⛔ GitLab reports unresolved mergeability status.` |
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
# UI styles: Tailwind v4 + shadcn (base-luma). Production build runs scripts/build.ts because the CLI compiler skips bundler plugins.

Produces `mole-tools` — a standalone compiled binary with no external `node_modules` requirement at runtime.

### Running from Source

```bash
bun run dev <command> [args...]       # e.g. bun run dev commit, bun run dev help
```

Runs the CLI directly against TypeScript sources without building.

### Testing

```bash
bun test                             # run all tests with coverage enabled by bunfig.toml
```

`bunfig.toml` enables coverage reporting but enforces no threshold; review the per-file table for gaps.

Tests live alongside source under `src/` (`*.test.ts`) and in a top-level `test/` directory for integration scenarios.

### Linting

```bash
bun run lint                         # biome check (formatting + linting)
```

### Releasing

Releases use a version-bump PR first. Do not tag or publish before that PR is merged.

See `.claude/skills/release/SKILL.md` for the full release checklist.

Start from a clean, up-to-date `main`. Review the latest GitHub release and tag, inspect changes since that release, and choose a patch, minor, or major bump from the current `package.json` version. Create a `release/vX.Y.Z` branch from `origin/main` and change only `package.json`'s `version` on that branch. Commit and push that branch, then open a PR to `main`:

```bash
git fetch --tags origin refs/heads/main:refs/remotes/origin/main
git status --short --branch
git branch --show-current
git rev-parse HEAD
git rev-parse refs/remotes/origin/main
gh auth status
gh release list --limit 1
git describe --tags --abbrev=0 origin/main
git switch -c release/vX.Y.Z origin/main
# Update only package.json's version on this branch.
git add package.json
git commit -m "chore(release): vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --base main --head release/vX.Y.Z --title "chore(release): vX.Y.Z" --body "Bump package version to vX.Y.Z."
```

Stop after opening the PR. Wait for the user to approve and merge it; do not merge it or publish while approval is pending.

After the user confirms the merge, switch to `main`, fetch again, and verify it is clean and matches `origin/main`. Compare the prior release tag with merged `main`, review commit messages and referenced issues, and curate verified release notes under **Features**, **Improvements**, and **Bug fixes**. Never invent issue references or release details. Save the notes to a temporary file, then publish the already-merged version:

```bash
notes_file="$(mktemp)"
# Write the curated release notes to "$notes_file".
bun run release publish --notes-file "$notes_file"
```

The publish command does not bump `package.json`, commit, or push `HEAD`. It refuses dirty, non-`main`, or stale checkouts and an existing tag or GitHub Release; it builds the binary, creates and pushes an annotated version tag only, and creates the GitHub Release with the supplied notes and macOS arm64 asset. Verify the tag and release with `git ls-remote --tags origin "refs/tags/vX.Y.Z"` and `gh release view vX.Y.Z`. The GitHub Release is the release entry.

### Project Structure (Quick Reference)

| Path | Description |
|---|---|
| `src/index.tsx` | CLI entry point — command registration, config loading, Ink UI bootstrap |
| `src/core/` | Context, error handling, feature interface |
| `src/features/` | One directory per surviving feature (commit, merge-request, worktree-prune, init, review) |
| `src/adapters/` | Config loader, prompt loader, provider adapters, VCS/host implementations |
| `src/features/review/ui/components/SettingsPanel.tsx` | Review UI Settings dialog (Prompts, Skills, and Appearance tabs) for prompt presets, versions, review-agent settings, and color theme |
| `specs/` | Design docs and architecture notes |
