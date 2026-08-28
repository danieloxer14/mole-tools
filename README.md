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
  }
}
```

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

### Prompt File Overrides

Prompt files live beside `config.json`:

```text
~/.config/mole-tools/
├── config.json
└── prompts/
    ├── commit-system.md
    ├── mr-system.md
    ├── review-layers-code.md
    ├── review-layers-plan.md
    └── review-chat.md
```

Each prompt is loaded in full. On first use of a missing prompt slot,
`mole-tools` writes its built-in default to that path without overwriting
existing content. You may instead create these files before first use. Edit a
file, then start a new command or review-agent turn; no `config.json` change
is needed.

| File | Used by | Customise for |
|---|---|---|
| `commit-system.md` | `commit` | Commit-message tone and repository conventions. |
| `mr-system.md` | `merge-request` | MR title/description format and repository conventions. |
| `review-layers-code.md` | `review` default `--mode code` | Review-layer coverage, priorities, and code-review focus. |
| `review-layers-plan.md` | `review --mode plan` | Requirements, risks, assumptions, and acceptance-criteria review. |
| `review-chat.md` | Review UI chat | Chat-review behavior and response format. |

Review layers are cached per MR. After changing either layer prompt, use
**Regenerate** in the review UI to apply it to existing cached layers. A chat
prompt edit applies to the next newly started chat turn. The review runtime
still enforces read-only tool allowlists and output schemas; prompt text cannot
relax those constraints.

#### Upgrading

Configs written by earlier versions that contain unsupported fields must be migrated to the current `providers`/`models` shape before startup; otherwise startup fails with `Invalid config at <path>`.

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
mole-tools merge-request                              # interactive flow
mole-tools merge-request --context "migration risk"   # extra inline guidance
```

| Option | Description |
|---|---|
| `--context <text>` | Extra guidance for both the commit-phase and MR-description generation. |

**How it works.** Preflight GitLab connection → if staged changes exist, commits them first → pushes branch → collects diff against default branch → fetches Jira issue if present → generates title + description → interactive reviewer selection (with optional auto-reviewer from config) → draft toggle → confirm and create. For repos listed in `dynamicEnvRepos`, an optional dynamic-environment handoff script is offered after creation.

**Configuration.** Uses the `mergeRequest` model route. Customise the system prompt via `~/.config/mole-tools/prompts/mr-system.md`. `glab` must be installed and authenticated for the GitLab host in the MR URL.

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
`review.binary` for a non-default executable and `review.model` for either OMP or Claude.
Layer output and chat state persist per MR below
`~/.config/mole-tools/reviews/`. Requires authenticated `glab` and selected
agent binary on `PATH`. See
[the interactive review spec](specs/review/interactive-review.md) and
[ADR 0005](docs/adr/0005-review-agent-port.md) for contracts.

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
bun test                             # run all tests with coverage enabled by bunfig.toml
```

`bunfig.toml` enforces 90% line and function coverage. Test runs below either threshold exit non-zero.

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
| `src/features/` | One directory per surviving feature (commit, merge-request, worktree-prune, init, review) |
| `src/adapters/` | Config loader, prompt loader, provider adapters, VCS/host implementations |
| `specs/` | Design docs and architecture notes |
