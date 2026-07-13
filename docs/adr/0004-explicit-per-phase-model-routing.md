# ADR 0004: Explicit per-phase model routing with strict provider validation

- **Status:** Accepted
- **Date:** 2026-07-14
- **Supersedes:** [ADR 0003 · config section](./0003-capability-aware-llm-provider-routing.md#decision) (capability-aware port itself remains valid)

## Context

The capability-aware LLM router introduced in ADR 0003 worked well for provider selection, but the configuration schema evolved into a confusing shape: string-key routing (`"commit": "ollama"`) layered with `@model:` prefix overrides, multiple fallback chains (legacy section → default model → hardcoded), and backward-compat shims that will never fire on fresh installs. The single flat pair `{ provider, model }` persisted per Ralph loop was insufficient once we wanted distinct models for task generation, implementation, and reflection phases.

Since the repo is in-progress development, breaking changes have trivial cost and eliminate confusion before any other consumers exist.

## Decision

Replace all string-key routing and `@model:` prefix semantics with explicit `{ provider: string, name: string }` objects keyed by feature. Multi-phase features nest further by phase. Connection details live separately under `providers`. Validation is strict — no fallbacks, no legacy shims.

Top-level config structure:

```jsonc
{
  "providers": {
    "ollama": { "baseUrl": "http://localhost:11434" },
    "pi":     { "binary": "pi" }
  },
  "models": {
    // single-phase feature → flat object
    "commit":       { "provider": "ollama", "name": "qwen3.6" },
    "mergeRequest": { "provider": "ollama", "name": "qwen3.6" },

    // multi-phase feature → phase-keyed object
    "ralph": {
      "init":      { "provider": "pi", "name": "qwen3.6" },
      "implement": { "provider": "pi", "name": "qwen3.6" },
      "reflect":   { "provider": "pi", "name": "qwen3.6" }
    }
  }
}
```

Validation rules:
1. Every provider referenced in `models` **must exist** under `providers`. Missing reference → validation error at boot with a clear message.
2. No fallback chains if config is incomplete — the resolver throws.
3. All model entries are schema-level required; no `.optional()` or `.default()` padding on the objects themselves.

Ralph init interactively resolves and persists all three phase models into `.ralph/<name>.state.json` at creation time. `ralph run` reads persisted state, not live config — guaranteeing a loop always reruns with exactly what it was created with.

### Alternatives considered

| Option | Rejected because |
|--------|------------------|
| **Backward-compat migration layer** | Adds complexity for in-progress dev with no existing configs to migrate |
| **`@model:` prefix on string keys** | Implicit convention is confusing to read; explicit objects document intent |
| **Runtime resolution from config during every `ralph run`** | Loses traceability — a loop's behaviour would depend on whatever the config says at invocation time, not what it was created with |

## Consequences

- Changing a feature's model requires editing only its entry under `models` — no touching provider connection details or feature flows.
- Ralph loops carry full provenance: the state file records exactly which provider and model will be used for init, implement, and reflect.
- Future multi-phase features follow the same nesting pattern without schema restructuring.
- Bootstrapping via `mole-tools init` writes complete defaults so users never hit missing-config errors on fresh installs.
- The capability-aware LLM port (ADR 0003) remains unchanged — only how routes are defined changes.
- The top-level key `"llm"` is renamed to `"models"` to reflect its purpose more precisely; `"providers"` continues holding connection config.
