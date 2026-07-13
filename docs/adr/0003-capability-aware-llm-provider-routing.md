# ADR 0003: Capability-aware LLM provider routing

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

mole-tools originally composed one `OllamaAdapter` as `Context.llm`. That was
sufficient for streaming text generation in commit and merge-request flows, but
it makes provider choice global and lets a future Ralph implementation bypass
the architecture by spawning Pi directly in a feature.

Different flows need different capabilities. Commit and merge-request need text
generation. Ralph needs an agent that can operate in a workspace, apply a
semantic auto-approval policy, return process diagnostics, and be cancelled.
A provider may support either capability or both.

## Decision

Keep one provider-neutral `Llm` port, expanded with explicit capabilities and
separate text-generation and workspace-agent operations. Features request an
operation for their named purpose; a Context-level router resolves that purpose
to the configured provider and model. Ralph persists the resolved provider
selection and asks the router to resolve that opaque selection on resume.

Configuration is feature-owned, for example:

```json
{
  "commit": { "provider": "ollama", "model": "qwen3" },
  "mergeRequest": { "provider": "pi", "model": "claude-sonnet-4" },
  "ralph": { "provider": "pi" },
  "providers": {
    "ollama": { "baseUrl": "http://localhost:11434" },
    "pi": { "command": "pi" }
  }
}
```

Ralph retains its required CLI `--model`; it overrides/supplies the model for
its `ralph` profile and persists both provider and model in loop state.

Requests at the port boundary are semantic. Pi-specific flags, including
`--approve`, exist only in `PiAdapter`. An adapter lacking a requested
capability throws `UnsupportedCapabilityError` before performing external work.

## Consequences

- Changing a feature's configured provider requires no feature-flow changes.
- Ralph uses the same injected LLM abstraction and fake-port test seam as
  commit and merge-request; it does not spawn Pi directly.
- Ollama remains a text-generation provider unless a future adapter gains safe
  workspace-agent support. Configuring it for Ralph fails clearly at preflight.
- New providers such as Claude or Codex require an adapter and provider config,
  not edits to existing feature flows.
- `Context.llm` becomes a routed capability-aware port rather than a single
  hard-wired Ollama adapter.
