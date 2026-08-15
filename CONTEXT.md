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

### Plain stdout help
Deterministic text printed directly to stdout, without mounting Ink and without loading config. Used for `mole-tools help` and `mole-tools help <command>`.
