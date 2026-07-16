# Tickets for Ralph Cost Tracking

**Source spec:** `specs/ralph-cost-tracking/ralph-cost-tracking.md`
**Generated:** 2025-07-14
**Output format:** local files

## Ticket list (dependency order)

| # | Title | Blocked by | Purpose |
|---|-------|-----------|---------|
| 01 | Define `LlmUsage`/`UsdCost` types and make `AgentResult.usage` required | None | Establish the abstract usage contract on the port side so all adapters return structured token data |
| 02 | Parse Pi JSON usage events and estimate missing usage | 01 | Extract provider-reported tokens from Pi events; fall back to estimation when absent |
| 03 | Shared model-price catalog, cost derivation, and aggregation functions | 01 | Pure functions for USD calculation by model, ledger aggregation, and terminal summary formatting |
| 04 | Add `RalphCostRecord` schema and require `costLedger` in Ralph state | 01, 03 | Zod schemas for cost records; require ledger array in RalphStateFileSchema |
| 05 | Init cost recording and summary output | 04 | Persist init agent-session cost and print compact summary after ralph init |
| 06 | Worker/reflection cost recording and terminal summaries for all run paths | 05 | Capture every worker/reflection attempt in ledger; print full history on all terminal paths of ralph run |

## Cross-ticket risks

- **Test fixtures cascade**: Ticket 01 changes `AgentResult` shape, which propagates through FakeLlm, all LLM adapter tests, and Ralph integration tests. Fixtures across many files need updating to include valid `usage`. Coordinate updates carefully to keep CI green each step.
- **Shared helper dependency**: Tickets 05 and 06 both call the derivation/aggregation/formatting functions from ticket 03. If those function signatures change during implementation, tickets 05/06 may need follow-up adjustments. Consider locking the public API of the shared module early.
- **run.ts complexity**: Ticket 06 touches multiple terminal paths in `run.ts` (pause, completion, reflection failure, worker failure, interruption). Each path needs consistent summary-printing and record-persistence behavior. Regression risk: any path missed means incomplete cost history output.
- **Schema backward compatibility**: The spec explicitly rejects migration — state files without `costLedger` fail validation. After ticket 04 lands, any Ralph loops that existed before the change become invalid. This is by design but worth noting for rollout timing.

## Execution order suggestion

Tickets 01 through 04 form the foundation and can be started once their blockers are clear (01 immediately; 02-03 after 01; 04 after 01+03). Tickets 05 and 06 are sequential integrations — start 05 only after 04, then 06 after 05.

```
01 ──┬──► 02 (parallel)
     ├──► 03 ──┬──► 04 ──► 05 ──► 06
     └─────────┘
```

The next step is to run `/implement` on ticket 01 to begin.
