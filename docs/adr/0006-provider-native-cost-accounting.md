# ADR 0006: Provider-native cost accounting

- **Status:** Accepted
- **Date:** 2026-07-14
- **Amends:** [ADR 0005](./0005-ralph-durable-cost-ledger.md)

## Context

The generic cost tracker records unlabelled token estimates, including Jira and git-host output. Its cost breakdown invents cache reuse and hypothetical Claude spend. Pi agent JSON-mode event parsing is not a reliable source of completed accounting: Pi's authoritative session totals are written to its session JSONL and displayed by `/session`.

The accounting model must work for Pi now and other providers, including Claude and Codex, later. It must not depend on a particular user's home directory or retain raw session transcripts.

## Decision

All and only LLM provider operations create normalized cost entries. Each entry stores provider/model provenance, an optional provider session ID, normalized input/output/cache usage, and a USD outcome: `actual`, `estimated`, `zero`, or `unavailable`. It may store a sanitized accounting diagnostic. Jira, git-host, and other context measurements are not cost entries.

Each adapter obtains usage from its authoritative provider-native source. Pi launches in JSON mode with a mole-tools-controlled operating-system temporary `--session-dir`; mole-tools reads the Pi session ID from the JSON-stream header, parses the matching completed session JSONL after the operation settles, normalizes its totals, and removes the temporary directory. It persists the session ID but never the raw session path or JSONL. Pi is the first implementation of this adapter contract, not a special persisted-schema case.

A provider-supplied USD charge is retained as `actual`. If it supplies no charge, shared pricing calculates an explicitly labelled `estimated` charge from a built-in provider/model price catalog and input, output, cache-read, and cache-write rates. Local providers are `zero`; unknown cloud models are `unavailable`. The catalog is shared across all accounting paths, versioned with mole-tools, and not user or project configurable.

Ralph retains its durable phase/iteration ledger, now populated from the normalized accounting result and provider session ID. An accounting parse or persistence failure pauses Ralph with `cost_accounting_failed`, preserves completed worker changes, and starts no later Pi session. Non-Ralph features continue; they persist an `unavailable` entry with a sanitized diagnostic.

The generic cost-history schema is a breaking change. Legacy rows are unsupported and receive no migration. The existing `cost-breakdown` presentation remains unchanged for now; it may ignore the richer stored metadata.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Parse Pi JSON-mode usage events directly | Events are not the `/session` accounting authority and nesting/lifecycle details are easy to parse incorrectly. |
| Read Pi's default session location | It depends on a user's home/configuration and is not portable. |
| Retain failed raw JSONLs and build recovery | It creates a recovery queue and retains raw transcripts for a rare parser defect. |
| Stop every feature on accounting failure | Non-Ralph feature success should not be blocked by ancillary accounting. |
| Keep Jira/git token estimates in the ledger | Context size is not a provider charge and produces false spend. |
| Per-adapter fallback pricing | It duplicates pricing policy and causes inconsistent estimates. |
| User/project-configured prices | It weakens reproducibility and creates support ambiguity. |

## Consequences

- `CostEntry`, history persistence, provider results, Ralph records, fakes, and tests change together.
- Pi accounting is reliable without machine-specific paths or retained raw transcripts.
- Ralph is intentionally fail-closed for accounting defects; other features are not.
- Existing generic cost UI is not redesigned by this ADR.
- A future Claude/Codex adapter implements provider-native usage extraction and returns the same normalized result.
