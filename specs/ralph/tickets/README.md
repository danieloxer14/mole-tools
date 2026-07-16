# Tickets for Ralph Orchestrator

**Source spec:** `specs/ralph-tool.md`
**Generated:** 2026-07-13
**Output format:** local files
**Implementation review:** 2026-07-13 — focused Ralph tests pass after review fixes.

## Ticket list (dependency order)

| # | Title | Blocked by | Purpose |
|---|-------|-----------|---------|
| 00 | Capability-aware LLM provider routing | None | Provider-neutral text/agent port, Pi adapter, feature-owned provider config |
| 01 | Types & schemas | None | Core interfaces + Zod validation for task/state/lock artifacts |
| 02 | Prompt extensions | None | Seed 3 Ralph prompt types (init, implement, reflect) with defaults |
| 03 | Task file validator | 01 | Parse/validate Markdown structure, extract checklist, detect checkbox mutations |
| 04 | State & lock persistence | 00, 01, 02 | Add persisted provider and atomically read/write `.ralph/*.md`, `*.state.json`, PID-based locks |
| 05 | `ralph init` command | 00, 03, 04 | Run the configured agent through `ctx.llm`, validate output, persist artifacts |
| 06 | Worker loop: agent + checklist tracking | 00, 04, 05 | Continuous fresh agent iterations with checkbox validation and retries |
| 07 | Reflection & completion gate + interrupt handling | 00, 06 | Periodic/final agent reflection, reopening work, graceful Ctrl+C shutdown |
| 08 | Register `ralph` feature + help | 05 | CLI wiring in registry, subcommand docs, discoverability via `mole-tools help` |
| 09 | Persist Ralph iteration handoff summaries | 06 | Carry latest worker summary through state into next worker prompt |

## Review notes

- Fixed Pi adapter invocation: agent and generation requests now use Pi print mode and explicit `--model`; Ralph remains provider-neutral.
- Fixed worker validation so an unchanged selected checkbox is a failed attempt, as required by the retry contract.
- Fixed init cleanup to remove both artifacts on transactional persistence failure.
- Fixed lock reclamation so a live PID is never stolen merely because a run is old; only dead-PID locks are stale.
- Focused validation/persistence/adapter suite: `111 pass, 0 fail`.
- `run.ts` has no dedicated integration tests in the repository yet; add scripted FakeLlm tests for worker, reflection, cap, and SIGINT paths before treating behavior as production-verified.


## Parallel tracks

Tickets **00**, **01**, and **02** have no blockers and can proceed independently.

Once 00+01+02 land:
- **03** unblocks on 01 (task parsing needs the types)
- **04** unblocks on 00, 01, and 02 (provider-persisted state, types, and prompt convention)

Then the linear chain **05 → 06 → 07 → 08** can proceed in order. Ticket 05 must use the port/fake seam from 00; it must not introduce a feature-local Pi spawn helper.

## Cross-ticket risks

- **Provider boundary**: Tickets 05–07 call `ctx.llm.runAgent`; only ticket 00's `PiAdapter` owns Pi subprocess details. Test Pi flags (`--approve`, `-p`, `--model`, system-prompt modes) in the adapter, not Ralph feature tests.
- **Ink spinner vs. agent I/O**: Ticket 06 uses an Ink spinner while an agent runs. Ralph consumes provider output internally; verify the spinner does not corrupt lifecycle log output.
- **`.ralph/` directory creation**: If `.ralph/` already exists from another tool or manual use, collision checks in tickets 04 and 05 must correctly distinguish between Ralph artifacts and unrelated files.
- **Cancellation reliability**: Ticket 07 cancels through the LLM port. PiAdapter must forward cancellation to its child process; this behavior is tested at the adapter boundary and is POSIX-targeted for now.

## Open questions (carried from individual tickets)

- **`cac` subcommand nesting**: Does the existing mole-tools `cac` CLI handle nested subcommands? If not, all Ralph dispatch happens within one `ralph` Feature that parses its own positional args. See ticket 08.
- **`--model` required vs. config-default**: The spec keeps it required on `init`; it supplies the configured Ralph provider profile and is persisted with that provider.

## Next step

Run ticket 00 first or in parallel with tickets 01 and 02. Do not implement Ralph command execution until the capability-aware LLM seam is available.
