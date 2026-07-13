# mole-tools

Global CLI for common git/dev workflows. Fast/lite path: local Ollama, no
Claude round-trip. See [specs/commit-tool.md](specs/commit-tool.md) and
[specs/architecture/](specs/architecture/) for the full design.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/danieloxer14/mole-tools/main/install.sh | bash
```

Installs the `mole-tools` binary to `/usr/local/bin` (macOS arm64 only).

## Usage

```bash
mole-tools init                         # write a default config template
mole-tools commit                       # generate a commit message for staged changes
mole-tools merge-request                # generate a merge request
mole-tools ralph init <name> <source>   # create a durable implementation loop
mole-tools ralph run <name>             # run or resume a loop
```

## Config

Location: `~/.config/mole-tools/config.json`.

Run `mole-tools init` to generate a default template, or let it be created on first run. JSON comments (`//`) are supported. Configuration is strict: all provider entries and model routes are required, and unknown or legacy fields are rejected.

### Full Configuration Reference

```jsonc
{
  // ── Provider Profiles ────────────────────────────────────────────────
  // Named AI provider configurations that can be referenced by features
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434"
    },
    "pi": {
      "binary": "pi",
      "projectRoot": "../../optional/path"
    }
  },

  // ── Explicit model routes ───────────────────────────────────────────
  "models": {
    "commit": { "provider": "ollama", "name": "qwen3.6" },
    "mergeRequest": { "provider": "ollama", "name": "qwen3.6" },
    "ralph": {
      "init": { "provider": "pi", "name": "qwen3.6" },
      "implement": { "provider": "pi", "name": "qwen3.6" },
      "reflect": { "provider": "pi", "name": "qwen3.6" }
    }
  },

  // ── Jira Integration ────────────────────────────────────────────────
  "jira": {
    "enabled": false,
    "branchPattern": "[A-Z]+-[0-9]+"
    // "url": "https://your-domain.atlassian.net"   // required when enabled is true
    // "email": "you@example.com"                   // set for Jira Cloud (Basic auth)
    // "apiKey": "your-api-token"                   // API token for authentication
  },

  // ── Diff Filtering ──────────────────────────────────────────────────
  // Globs excluded from diffs shown to the LLM
  "diff": {
    "ignore": ["*.lock", "bun.lockb", "package-lock.json", "*.snap"]
  },

  // ── Optional: Dynamic Environment Handoff ───────────────────────────
  // Repos that get offered a "create dynamic env" option
  // "dynamicEnvRepos": ["org/repo"],
  // Script path called for handoff when enabled
  // "dynamicEnvScript": "hack/local/dynamic-env.sh",

  // ── Optional: Auto-Reviewer ─────────────────────────────────────────
  // Enables the "add auto-reviewer?" prompt during merge-request generation
  // "autoReviewer": { "username": "your-handle" }
}
```

### Routing

Each route is required and must reference an existing provider map key. There are no defaults, legacy fields, or `@model:` overrides.

During `ralph init`, three prefilled questions collect the model names for task generation, implementation, and reflection. The configured provider for each phase is retained. These selections are persisted in `.ralph/<name>.state.json`, so later runs remain deterministic even if global configuration changes.

## Development

```bash
bun install
bun run dev commit     # run from source
bun test                # unit + adapter + e2e tests
bun run lint            # biome check
```

## Build

```bash
bun run build           # bun build --compile --target=bun-darwin-arm64
./mole-tools --version
```

Produces a standalone `mole-tools` binary (no `node_modules` needed at
runtime).

## Release

Install and authenticate the GitHub CLI once:

```bash
brew install gh
gh auth login
```

From a clean working tree, publish the next GitHub release and its installable
macOS-arm64 binary:

```bash
bun run release patch # or: minor, major
```

The command bumps `package.json`, builds the binary, commits and tags
`v<version>`, pushes the commit and tag, then creates a GitHub release with a
`mole-tools-darwin-arm64` asset.
