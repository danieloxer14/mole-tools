# ADR 0006: Prompt presets, versions, and review UI settings

- **Status:** Accepted
- **Date:** 2026-09-11
- **Scope:** Prompt customization and review-agent settings

## Context

Issue #33 asks for editable prompts with named presets and version history,
plus provider/model selection for features that use prompts. The previous
prompt store used one flat Markdown file per slot beside `config.json`. Review
agent and model settings were configured only in the config file, while the
review UI had no way to manage either setting.

The new design must preserve existing prompt text during migration, keep
commit and merge-request prompt routing predictable, and let a running review
server apply prompt and review-agent changes without granting the browser file
or worktree access.

## Decision

### D1 — Named presets with append-only versions

A preset is a named variant of one prompt slot. A version is an append-only
revision of one preset. Prompt files use this layout:

```text
~/.config/mole-tools/prompts/
└── <slot>/
    └── <preset>/
        ├── 001.md
        └── 002.md
```

The active text is the highest version of the active preset. Saving creates a
new version. Rollback copies an older version forward as a new latest version,
and reset writes the shipped default as a new version. Mole-tools never
deletes prompt versions.

### D2 — Active preset is recorded in config

`config.json` stores a partial map under `config.prompts`:

```jsonc
{
  "prompts": {
    "commit-system": "default",
    "review-chat": "concise"
  }
}
```

A missing slot uses the `default` preset. Activating a preset persists this
map. Commit and merge-request commands resolve the active preset on each run;
the review server keeps its live settings in memory.

### D3 — Lazy migration and retirement of `mr-system`

Legacy flat files migrate once, lazily, on first access of their slot:
`prompts/<slot>.md` becomes `prompts/<slot>/default/001.md`. If
`mr-code.md` is absent, legacy `mr-system.md` migrates to
`mr-code/default/001.md`. If `mr-code.md` exists, it takes precedence and
`mr-system.md` is not used for that access. `mr-system` is removed as a prompt
slot; the migration preserves its text for existing installations.

### D4 — Preset-name validation

Preset names must match `^[a-z0-9][a-z0-9._-]{0,63}$`. This keeps each name a
safe path segment and makes names portable across supported environments.
`default` is reserved for automatic seeding but remains user-editable.

### D5 — Review UI is the editing surface

Prompt and review-agent changes are managed from the review web UI's
**Prompts & Models** overlay. The overlay provides slot, preset, and version
selection, a text editor, save/rollback/reset actions, and review-agent/model
selection. Browser mutations use token-protected API routes; the browser never
writes prompt files or `config.json` directly. No new CLI command or flag is
added for editing prompts.

### D6 — Live settings belong to the review server

The review server owns in-memory settings seeded from startup config. Layer
runs and chat turns resolve the selected prompt preset when they start, so
changes apply to the next run or turn. Persistence is injected through
`persistConfig`; the default uses `updateConfig`, which shallow-merges and
rewrites `config.json`. Review-agent changes use an injected factory to build
and swap the agent for subsequent work; in-flight turns keep their current
agent. Cached layers are not invalidated automatically; users use
**Regenerate** to rebuild them.

### D7 — Review-agent construction uses a factory

`Context.createReviewAgent(override?)` constructs the configured OMP, Claude, or Codex adapter.
Override values take precedence over `config.review`; when an
override changes the agent, the configured binary is ignored because the
binary defaults to the selected agent name. An injected review agent used by
tests is returned unchanged. Review feature call sites use the factory rather
than constructing or retaining provider-specific adapters themselves.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Single global preset profile | Different slots need independent customization and rollout; one profile would couple unrelated prompts. |
| Pinned versions | A pinned version adds another mutable state pointer and complicates rollback. Highest-version selection keeps history linear and rollback explicit. |
| CLI command / `$EDITOR` | The review UI is the agreed management surface; another command would duplicate validation, persistence, and versioning behavior. |
| Per-phase review models | Layers and chat intentionally share one review agent/model. Splitting them would add configuration complexity without a requested use case. |

## Consequences

- Prompt customizations are durable, auditable, and independently selectable
  per slot, while legacy flat files migrate without losing user text.
- Prompt and review-agent settings are discoverable in one review UI overlay;
  no shell editor or extra CLI workflow is required.
- `updateConfig` rewrites `config.json` without comments. Users who rely on
  comments must keep those notes elsewhere.
- Changing a prompt does not rebuild cached layers automatically; users must
  choose **Regenerate** to apply a changed layer prompt to cached output.
- Swapping the review agent can restart provider chat sessions because session
  identifiers are provider-specific; in-flight turns continue with their
  original agent.
- The review server's live settings can differ from the parent process's
  startup config until a later invocation, by design.
