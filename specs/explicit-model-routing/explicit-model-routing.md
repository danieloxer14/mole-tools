# mole-tools — Explicit Model Routing

**Status:** Superseded — historical decision. The shipped loader retains tested legacy normalization for supported upgrades; live contract is defined by source.
**Date:** 2026-07-14
**Author:** Daniel Oxer
**Companion:** [architecture/code-design.md](../architecture/code-design.md)

> **Current implementation note:** New configurations use `providers.*` plus `models.commit` and `models.mergeRequest` routes with `{ provider, name }`. Prompt overrides are file-backed under `~/.config/mole-tools/prompts/`. The decision text below records the earlier strict-break proposal and is archival.

Replace string-key model routing (`llm: { commit: "ollama" }`), `@model:` prefix overrides, and fallback chains with explicit `{ provider, name }` objects for each generation flow. This is a breaking configuration change: invalid or incomplete routes fail during validation instead of silently selecting a default.

---

## 1. Why

The old routing schema hid provider selection behind string keys and fallback rules. Explicit objects make each flow's provider and model visible in configuration and keep connection details separate from route selection.

---

## 2. Config shape

### Top-level sections

```jsonc
{
  "providers": {
    "ollama": { "baseUrl": "http://localhost:11434" },
    "pi":     { "binary": "pi" }
  },
  "models": {
    "commit":       { "provider": "ollama", "name": "qwen3.6" },
    "mergeRequest": { "provider": "ollama", "name": "qwen3.6" }
  },
  "jira": { ... },
  "diff": { ... }
}
```

### Naming rationale

| Section | Purpose |
|---------|---------|
| `providers` | Connection details per provider identity (`baseUrl`, `binary`) |
| `models` | Which provider and model each generation flow uses |

`providers` defines how to connect; `models` defines where to route a flow.

### Strictness rules

1. Every key in `models` references a provider that **must exist** in `providers`. A missing reference fails validation with a message identifying the route and provider key.
2. If a required route is missing, the resolver fails cleanly; no fallback is selected.
3. Legacy sections, `@model:` prefixes, and default routes are not accepted.
4. Every route requires non-empty `provider` and `name` values.

### Bootstrap defaults

`mole-tools init` writes a complete template covering:

- `providers`: Ollama and Pi connection defaults
- `models.commit`: `{ provider: "ollama", name: "qwen3.6" }`
- `models.mergeRequest`: `{ provider: "ollama", name: "qwen3.6" }`

---

## 3. Resolved decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Keep single-flow routes flat | `"commit": { provider, name }` directly expresses one generation operation |
| 2 | Keep `providers` separate | Connection details are shared across flows and should not be duplicated |
| 3 | Require route fields at schema level | Validation catches incomplete configuration before generation |
| 4 | Drop legacy transforms | A clean break removes fallback ambiguity |

---

## 4. Implementation notes

| Step | File(s) | Change |
|------|---------|--------|
| 1 | `src/adapters/config/schema.ts` | Define provider maps and strict `commit`/`mergeRequest` routes |
| 2 | `src/core/context.ts` | Resolve each surviving purpose through its configured route |
| 3 | `src/adapters/config/loader.ts` | Seed valid defaults in the bootstrap template |
| 4 | Config tests | Cover valid routes, missing providers, and rejected legacy shapes |

The composition root builds provider adapters from `providers`; feature flows receive the selected provider through the context-level router.
