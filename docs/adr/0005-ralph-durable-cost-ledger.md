# ADR 0005: Ralph durable cost ledger and provider-neutral usage results

- **Status:** Accepted
- **Date:** 2026-07-14

## Context

Ralph currently launches provider-neutral workspace-agent sessions for task-file generation, worker attempts, and reflections, but `AgentResult` returns only output, diagnostics, and success. The shared `CostTracker` is invocation-scoped and records only unlabelled token counts, so it cannot attribute cost to a Ralph iteration or preserve a full implementation-loop total across resumed `ralph run` commands.

Users need the cost of every iteration and the total cost of a durable Ralph loop. This must survive process termination and be available in the loop state, rather than depending on the current process's tracker.

## Decision

Extend the abstract LLM result contract so every agent operation returns provider-neutral structured usage. Adapters preserve provider-reported token usage and actual USD charge when available. When usage is not reported, the adapter estimates token counts from the request and captured output and marks them as estimated. Shared cost code, rather than Ralph or a concrete adapter, derives an explicitly estimated USD amount when no actual charge is supplied.

Ralph persists a required, append-only session ledger in `.ralph/<name>.state.json`. A record is written for successful and failed initialization, worker, and reflection agent sessions once a result is available. Each record identifies its phase, selected provider/model, optional worker iteration, outcome, usage, and actual, estimated, zero, or unavailable USD result.

The loop aggregates ledger records as follows:

- An iteration subtotal contains its worker attempt and its immediately following periodic reflection, when present.
- A final reflection with no worker is shown separately.
- The full-loop total includes initialization, every worker attempt (including failed attempts), periodic reflections, and the final reflection across all resumed runs.

Ralph displays the persisted summary after successful initialization and after every terminal run outcome, including completion, pauses, validation/reflection failures, and interruption. A run displays the full loop history, not merely entries created during that command.

Fallback pricing comes from a built-in model-price catalog. Cataloged local/self-hosted models have a USD amount of zero. Unlisted cloud models retain token usage but have an unavailable USD amount; mole-tools does not invent a universal fallback rate.

This is a breaking Ralph-state schema change. State files without the required ledger are unsupported; no migration or retrospective estimate is provided.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Keep cost only in `CostTracker` | It is process-scoped, has no Ralph phase/iteration attribution, and cannot represent a resumed loop total. |
| Let Ralph derive usage from text | It would duplicate provider-specific accounting at feature level and violate the provider-neutral port boundary. |
| Make each adapter calculate its own fallback USD | Pricing policy would be duplicated across adapters and yield inconsistent results. |
| Store only per-iteration aggregates | It loses the session-level evidence needed to distinguish worker and reflection cost or audit failures. |
| Estimate historical legacy loops | Task files and timestamps cannot recover actual token usage; presenting an invented total would mislead users. |
| Use one generic USD rate for unknown models | A number with no model-specific basis is more misleading than an explicitly unavailable estimate. |

## Consequences

- `AgentResult`, all LLM adapters, and test fakes must supply structured usage.
- Pi JSON-mode event parsing must capture reported usage where Pi provides it; tests must cover reported and estimated paths.
- Ralph schema validation, persistence, init, run, interruption, and reflection flows must write ledger records atomically with state updates.
- The cost-summary formatter is Ralph-specific and derives all displayed subtotals from durable ledger entries.
- The existing generic cost-breakdown history remains separate; this ADR does not redefine its session format or pricing comparison UI.
- Adding a model to the built-in price catalog is a code release; unknown models still provide useful token metrics without a false USD value.
