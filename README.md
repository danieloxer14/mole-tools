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
mole-tools init      # write a default config template
mole-tools commit    # generate a commit message for staged changes
```

## Config

Location: `~/.config/mole-tools/config.json`. Auto-created with defaults on
first run. Secrets are stored in plaintext — keep this file out of any synced
repo.

| Key | Purpose |
|-----|---------|
| `ollama.commitModel` | Model used for commit messages |
| `ollama.baseUrl` | Ollama endpoint (default `http://localhost:11434`) |
| `commitSystemPrompt` | System prompt for commit message generation |
| `jira.enabled` | Toggle Jira ticket context lookup |
| `jira.url` / `jira.apiKey` | Jira base URL and API token |
| `jira.branchPattern` | Regex to extract a ticket key from the branch name |
| `diff.ignore` | Glob patterns excluded from the full diff (lockfiles, snapshots, etc.) |

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
