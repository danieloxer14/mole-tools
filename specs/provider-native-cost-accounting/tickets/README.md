# Tickets for provider-native cost accounting

**Source spec:** `specs/provider-native-cost-accounting/provider-native-cost-accounting.md`  
**Generated:** 2026-07-14  
**Output format:** local files

## Ticket list (dependency order)

| # | Title | Blocked by | Purpose |
|---|-------|------------|---------|
| 01 | Establish normalized LLM accounting foundation | None | Build the shared contract, catalog, and sanitizer. |
| 02 | Persist strict LLM-only cost history | 01 | Enforce current generic history and remove pseudo-costs. |
| 03 | Account Pi runs from completed session JSONL | 01 | Make settled Pi JSONL authoritative and clean up sessions. |
| 04 | Normalize Ollama results and LLM test fakes | 01 | Apply the neutral contract to local LLMs and tests. |
| 05 | Keep non-Ralph features resilient to accounting faults | 02, 03 | Persist unavailable history without failing primary features. |
| 06 | Pause Ralph on normalized accounting failure | 01, 03 | Persist Ralph accounting and enforce its fail-closed boundary. |

## Cross-ticket risks

- The generic cost schema is intentionally breaking: legacy history must fail without migration.
- Pi process/session cleanup must hold for all process and parser outcomes.
- Ticket 05 is intentionally fail-open; ticket 06 is intentionally fail-closed after settled accounting failures.
