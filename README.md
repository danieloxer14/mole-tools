# mole-tools

Global CLI for common git/dev workflows. AI-powered commit messages and merge requests — running fast against your local Ollama or any configured provider.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/danieloxer14/mole-tools/main/install.sh | bash
```

Installs the `mole-tools` binary to `/usr/local/bin` (macOS arm64 only).

---

## Init

### Prerequisites

**Ollama** must be installed and running locally. Pull at least one model before your first run:

```bash
brew install ollama                   # or download from https://ollama.com
ollama pull gemma3:12b               # or any model you prefer — qwen3.6, llama3, etc.
```

The tool calls Ollama over HTTP at `http://localhost:11434` by default. Make sure the server is running before invoking any AI features.

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

### Prompt File Overrides

Instead of editing the bundled system prompts, you can place custom `.md` files in a **prompts directory** next to your config:

```
~/.config/mole-tools/
├── config.json
└── prompts/
    ├── commit-system.md
    └── mr-system.md
```

If a file exists it is loaded in full; if it is missing the built-in default is used (and written to the prompts dir for future editing). Two prompt slots are available — one for commit generation and one for merge-request generation. Edit these to change tone, style conventions, or add repo-specific instructions without touching config.json.

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
mole-tools merge-request                              # interactive flow
mole-tools merge-request --context "migration risk"   # extra inline guidance
```

| Option | Description |
|---|---|
| `--context <text>` | Extra guidance for both the commit-phase and MR-description generation. |

**How it works.** Preflight GitLab connection → if staged changes exist, commits them first → pushes branch → collects diff against default branch → fetches Jira issue if present → generates title + description → interactive reviewer selection (with optional auto-reviewer from config) → draft toggle → confirm and create. For repos listed in `dynamicEnvRepos`, an optional dynamic-environment handoff script is offered after creation.

**Configuration.** Uses the `mergeRequest` model route. Customise the system prompt via `~/.config/mole-tools/prompts/mr-system.md`. Requires a GitLab host to be reachable (configured through the `pi` provider or environment).

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
