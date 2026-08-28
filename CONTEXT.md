# mole-tools Context

This glossary captures domain language for the single `mole-tools` bounded context.

## Terms

### Feature
A user-facing tool represented by a `Feature` object in `src/core/feature.ts` and registered in `src/core/registry.ts`. A feature has a command name, one-line description, zod argument schema, and a `run(ctx, args)` flow.

### Registered command
A CLI command exposed to users. Most registered commands come directly from the feature registry. The `help` command is intentionally special-cased because it must run without config loading or Ink.

### Help feature
The discoverability function that lists available tools and explains how to call each one. It is registry-backed so newly registered features appear automatically.

### Commit auto mode
A strictly non-interactive commit invocation enabled by `mole-tools commit --auto`. It accepts the generated, format-valid message and creates the local commit without showing the message selection. It deliberately never pushes; staged-change validation, Jira lookup, diff collection, generation, and failure handling remain unchanged. A future commit-flow decision that cannot be safely automated fails rather than prompting or silently choosing a default.

### LLM model route
A feature-owned provider/model selection in global configuration, for example `commit: { provider: "ollama", name: "qwen3" }`. Provider connection details are stored separately under `providers`. The `commit` and `mergeRequest` routes select their provider and model independently.

### User-supplied generation context
Optional, invocation-scoped, non-blank free text supplied through the `--context` CLI option to guide an LLM-generated commit message or merge-request title and description. Its internal whitespace is preserved; it has no tool-level length limit and is not persisted. Prompt builders render it immediately after the feature prompt as a clearly labelled guiding-instruction section, before Jira, commit, and diff evidence. For a merge-request invocation that commits staged changes, the same context guides the internal commit generation as well as merge-request generation.

### Feature help metadata
Optional command-level documentation colocated on a feature. It may include invocation syntax, examples, and notes. It does not replace generated data from the feature's name, description, or zod args.

### Zod argument metadata
Descriptions and examples attached to individual zod argument schemas with `.describe(...)` and `.meta({ examples: [...] })`. This is the canonical place for option-level help text.

### Interactive review (`mole-tools review`)
The feature that reviews one GitLab merge request in a local three-column web
UI. Invoke it as
`mole-tools review <mr-url> [--mode code|plan] [--no-open] [--refresh]`.
`--mode` defaults to `code` and selects only the layer prompt; `plan` frames
the same diff/chat/comment flow around requirements and acceptance criteria.
`--no-open` suppresses browser launch. `--refresh` re-fetches the MR head and
rebuilds the detached worktree before serving.

### Review URL and run token
The URL printed by `mole-tools review` points to
`http://127.0.0.1:<ephemeral-port>/?t=<random-token>`. Token is minted for one
CLI run and is never persisted. Every `/api/*` request must carry token as
`?t=<token>` or `X-Mole-Token`; missing or wrong token gets `401`. Server is
loopback-only and exists only while CLI process runs.

### Review worktree
A detached worktree checked out at MR head for safe inspection. Review first
uses current directory when its `origin` matches MR; otherwise it reuses or
creates cache clone under `~/.config/mole-tools/repos/` and worktree under
`~/.config/mole-tools/worktrees/<host>/<project>/mr-<iid>/`. Chat and comment
agents have read-only tools, including Bash for read-only inspection commands.
Layer output is written outside worktree. CLI exit stops server but leaves
worktree and review state on disk; cleanup is deliberate through
`worktree-prune`, not automatic.

### ReviewAgent
Provider-neutral port for review turns. It exposes `preflight()` and a
streaming `run({ sessionId?, cwd, systemPromptFile, message, writeDir?,
signal? })`. Adapters normalize `omp` or `claude` NDJSON into session, text,
tool, error, turn-end, and diagnostic events. `Llm` remains one-shot and
continues to serve commit and merge-request generation.

### Review session
Provider conversation uses active chat `sessionId` in per-chat review state,
with `chats` and `activeChatId` identifying each conversation.
First chat turn seeds MR metadata, layer guide, and changed-file list; later
turns resume that chat's session with message, new line tags, and open file only.
User/assistant entries append to `chats/<chatId>.ndjson`. Legacy
`chatSessionId` and `chat.ndjson` are read-only migration inputs for pre-multi-chat
v1 state; `chat.ndjson` is adopted once into `chats/legacy.ndjson`. Comment
creation opens empty local drafts; users author bodies and Send posts them
directly, without an agent session or chat state change.

### Review layer
Generated guide entry with `title`, `tldr`, `files[]`, optional `bdd[]`, plus
persisted id/done/stale state. Guide auto-runs once when pending, caches when
ready, and can be Regenerated or Retried. A layer curates files from the full
changed-file tree; global and per-layer viewed-file coverage are separate.

### Positioned discussion
A local comment draft anchored to one diff side and inclusive line range.
New-side anchors use `new_line`; deleted-side anchors use `old_line`. Ranges
cannot cross sides and must resolve against current diff refs before explicit
Send posts one GitLab discussion. Existing discussions remain read-only.

### Review sync
Explicit re-synchronization after a head-SHA change. Refresh checks current
head and reports staleness without mutating state. Sync recreates detached
worktree at new head, recomputes merge base/diff/refs, marks layers stale,
preserves chat/drafts, and stamps drafts whose anchors no longer resolve.

### Plain stdout help
Deterministic text printed directly to stdout, without mounting Ink and without loading config. Used for `mole-tools help` and `mole-tools help <command>`.
