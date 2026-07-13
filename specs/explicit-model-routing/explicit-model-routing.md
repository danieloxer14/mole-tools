# mole-tools — Explicit Per-Phase Model Routing

**Status:** Grilled / agreed. Not yet implemented.
**Date:** 2026-07-14
**Author:** Daniel Oxer
**Companions:** [../architecture/code-design.md](./architecture/code-design.md), [docs/adr/0003-capability-aware-llm-provider-routing.md](../docs/adr/0003-capability-aware-llm-provider-routing.md)

Replace the current string-key LLM routing (`llm: { commit: "ollama" }` with `@model:` prefix overrides and legacy fallbacks) with explicit `{ provider, name }` objects per feature, supporting per-phase model selection for multi-phase features like Ralph. Eliminate all legacy shims — this is a breaking change for in-progress development.

---

## 1. Why

The current routing schema is confusing:
- String keys with hidden `@model:` prefix semantics (`"@qwq:pi"`)
- Multiple fallback chains (legacy section → default model → hardcoded)
- A single flat model stored per-feature, unable to differentiate Ralph's init/implement/reflect phases
- Legacy ollama backward-compat logic that will never fire on fresh installs

The new design trades backward compat for clarity and expressiveness.

---

## 2. New Config Shape

### Top-level sections

```jsonc
{
  "providers": {
    "ollama": { "baseUrl": "http://localhost:11434" },
    "pi":     { "binary": "pi" }
  },
  "models": {
    // Single-phase feature → flat object
    "commit":       { "provider": "ollama", "name": "qwen3.6" },
    "mergeRequest": { "provider": "ollama", "name": "qwen3.6" },

    // Multi-phase feature → object keyed by phase
    "ralph": {
      "init":      { "provider": "pi", "name": "qwen3.6" },
      "implement": { "provider": "pi", "name": "qwen3.6" },
      "reflect":   { "provider": "pi", "name": "qwen3.6" }
    }
  },
  "jira": { ... },
  "diff": { ... }
}
```

### Naming rationale

| Section | Purpose |
|---------|---------|
| `providers` | Connection details per provider identity (baseUrl, binary) |
| `models`    | Routing: which provider + model each feature/phase uses |

No conflict — `providers` defines *how to connect*, `models` defines *what to route to*.

### Strictness rules

1. Every key in `models` references a provider that **must exist** in `providers`. Missing reference → validation error at boot with message like `"provider 'ollama' referenced in models.commit but not defined in providers"`.
2. No fallbacks. If a feature lacks an entry, the resolver throws cleanly.
3. No `@model:` prefix parsing, no legacy `commitModel`/`mrModel`, no `models.default`.
4. All fields are schema-level required (no `.optional()` or `.default()` padding on the model objects themselves).

### Bootstrap defaults

`mole-tools init` writes a complete template covering:
- `providers`: Ollama + Pi with sensible connection defaults
- `models.commit`: `{ provider: "ollama", name: "qwen3.6" }`
- `models.mergeRequest`: `{ provider: "ollama", name: "qwen3.6" }`
- `models.ralph.init`, `.implement`, `.reflect`: each defaults to `{ provider: "pi", name: "qwen3.6" }`

---

## 3. Ralph Phase Model Persistence

### State file shape (`.ralph/<name>.state.json`)

Replaces flat `provider: string` + `model: string` with a per-phase map:

```ts
models: {
  init:      { provider: string, name: string },
  implement: { provider: string, name: string },
  reflect:   { provider: string, name: string }
}
```

Models are resolved from live config at init-time and **persisted**. A `ralph run` later reads what was baked into state — even if global config has changed. This guarantees traceability: the loop always reruns with exactly the models selected during creation. To change models mid-flight, a user deletes the loop artifacts and recreates it.

### Init-time flow changes

Current behavior: `ralph init` requires a strict `--model` CLI flag and resolves provider from config routing.

New behavior:
1. `ralph init <name> <source>` no longer requires `--model`.
2. During the init interactive flow, the tool asks **three questions**, prepopulated with the defaults from `config.models.ralph`:
   - *"Task generation model (init)?"* → default: `qwen3.6`
   - *"Implementation model (implement)?"* → default: `qwen3.6`
   - *"Reflection model (reflect)?"* → default: `qwen3.6`
3. The provider key for each phase is resolved from the chosen config defaults; users can edit inline to switch providers/models if desired.
4. Once all three are collected, init proceeds: task generation uses the resolved *init* model, and all three selections are persisted into `.state.json`.

### Run-time resolution

- Worker iterations use `models.implement` from state
- Reflection/review runs use `models.reflect` from state
- The LLM port receives explicit `{ providerKey, name }` per call — no routing table lookup needed at this point; the data is already in state.

---

## 4. Resolved Decisions (from grilling)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Flatten single-phase features | `"commit": { provider, name }` directly — no double-key nesting buys nothing for one-operation features |
| 2 | Keep `providers` section separate | Connection details (URLs, binary paths) are identical across features; dedup avoids noise |
| 3 | Schema-level required fields | Zod schema enforces completeness; boot fails fast if config is incomplete |
| 4 | Drop all legacy/transform support | In-progress dev repo — breaking change is cheap |
| 5 | Persist per-phase models at init | Determinism: a Ralph loop always uses what it was created with, not whatever config happens to say later |
| 6 | Ask model questions during init flow | Avoids forced CLI flags; prepopulated defaults make common case zero-typing |
| 7 | Naming: `init` / `implement` / `reflect` | Three clear phase names distinct from subcommand names (`ralph run`) |

---

## 5. Open Items

- **UI prompting specifics:** Exactly how the three model questions are rendered in Ink (three separate `editText` prompts? a single multi-select with phase labels?) — deferred to implementation detail.
- **Future multi-phase features:** New features with sub-phases follow the Ralph pattern (`{ "featureName": { "phase1": {...}, ... } }`). Single-operation features remain flat.

---

## 6. Implementation Plan

| Step | File(s) | Change |
|------|---------|--------|
| 1 | `adapters/config/schema.ts` | Define new `ProviderConfigSchema`, `ModelsConfigSchema`; remove all legacy shims, `@model:` prefix parsing, and fallback chains |
| 2 | `core/context.ts` | Update `buildAdapterMap` + `resolveProfileKey` to use strict model lookup; throw cleanly on missing keys or unlinked providers |
| 3 | `adapters/config/loader.ts` | Update bootstrap template to seed valid defaults for new structure |
| 4 | `features/ralph/init.ts` | Replace `--model` requirement with three interactive model-resolution prompts; persist per-phase selections into state |
| 5 | `features/ralph/run.ts` | Read phase-specific models from persisted state for worker and reflection calls |
| 6 | `features/ralph/schema.ts` | Update `RalphStateFileSchema`: replace flat `provider`/`model` with nested `models { init, implement, reflect }` |
| 7 | All tests | Update schema/loader feature specs to match new config shape; update Ralph fakes for per-phase model resolution |

---

## 7. ADR Follow-up

This effectively **supersedes** [ADR 0003](../docs/adr/0003-capability-aware-llm-provider-routing.md)'s configuration decision (the capability-aware port itself remains valid). An explicit supersession note should be added to ADR 0003 once implemented.
