# ADR 0004: Explicit model routing with strict provider validation

- **Status:** Superseded — historical decision. The shipped loader retains tested legacy normalization for supported upgrades; live contract is defined by source.
- **Date:** 2026-07-14
- **Supersedes:** Legacy string-key model routing and model-name prefix overrides


> **Current implementation note:** New configurations use `providers.*` plus `models.commit` and `models.mergeRequest` routes with `{ provider, name }`. Prompt overrides are file-backed under `~/.config/mole-tools/prompts/`. The decision text below records the earlier strict-break proposal and is archival.

## Context

The previous configuration schema mixed string-key routing (`"commit": "ollama"`) with `@model:` prefix overrides, fallback chains, and compatibility shims. That shape obscured which provider and model each generation flow used.

The surviving generation flows need explicit, independently editable routes. Breaking the old configuration shape removes ambiguity and lets invalid references fail before any external work.

## Decision

Use explicit `{ provider: string, name: string }` objects keyed by feature. Connection details live separately under `providers`. Validation is strict: no fallbacks and no legacy shims.

Top-level config structure:

```jsonc
{
  "providers": {
    "ollama": { "baseUrl": "http://localhost:11434" },
    "pi":     { "binary": "pi" }
  },
  "models": {
    "commit":       { "provider": "ollama", "name": "qwen3.6" },
    "mergeRequest": { "provider": "ollama", "name": "qwen3.6" }
  }
}
```

Validation rules:

1. Every provider referenced in `models` **must exist** under `providers`. A missing reference fails validation with a clear message.
2. An incomplete route fails; the resolver does not select a fallback.
3. Both surviving routes require non-empty `provider` and `name` values.

### Alternatives considered

| Option | Rejected because |
|--------|------------------|
| **Backward-compat migration layer** | Adds complexity while the configuration contract is changing |
| **`@model:` prefix on string keys** | Implicit convention is harder to read than explicit objects |
| **Runtime defaults for incomplete routes** | Hides configuration errors until generation starts |

## Consequences

- Changing a flow's model requires editing only its entry under `models`; provider connection details and feature code stay separate.
- `mole-tools init` writes complete defaults, so fresh installs do not hit missing-route errors.
- The top-level key `"llm"` is represented by `"models"`; `"providers"` continues to hold connection configuration.
