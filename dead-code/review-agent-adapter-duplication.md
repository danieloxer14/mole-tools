# Consolidate duplicated provider-adapter plumbing

## Type
Redundant code

## Scope
- Area: `Review-agent adapters and execution`
- Candidate paths: `src/adapters/agent/omp.ts`, `src/adapters/agent/claude.ts`, related adapter tests
- Symbols/config/docs: `errorMessage`, `diagnostic`, `parseJson`, `preflight`, constructor option/executor wiring, provider-specific `nestedMessage`

## Evidence
- `src/adapters/agent/omp.ts:30-48` and `src/adapters/agent/claude.ts:32-60` contain the same `errorMessage`, `diagnostic`, and malformed-event helper structure; only the provider name in malformed messages differs.
- `src/adapters/agent/omp.ts:50-67` and `src/adapters/agent/claude.ts:62-80` implement the same recursive nested-error extraction. Claude additionally checks `result`, so that provider-specific key must remain explicit if helpers are shared.
- `src/adapters/agent/omp.ts:70-86` and `src/adapters/agent/claude.ts:82-98` duplicate JSON-line parsing, differing only in the provider label in malformed JSON/object messages.
- `src/adapters/agent/omp.ts:152-165` and `src/adapters/agent/claude.ts:229-242` duplicate the positional-executor/options constructor dispatch and default `binary`/`exec` wiring; only provider defaults and option interface names differ.
- `src/adapters/agent/omp.ts:167-173` and `src/adapters/agent/claude.ts:244-250` are identical preflight implementations.
- Runtime reachability is shared and intentional: `src/core/context.ts:123-132` selects one adapter from the configured `review.agent`, while `src/features/review/layers.ts:557` and `src/features/review/chat.ts:383` consume the common `ReviewAgent` port. Both adapter test suites cover provider-specific event mapping and argument construction.
- Targeted verification: `bun test src/adapters/agent src/port-contracts/review-agent.test.ts` passed 25 tests.

## Why this is safe to change
The duplicated sections are private adapter plumbing behind the same `ReviewAgent` contract, not separate public behavior. A small internal helper can centralize common error formatting, JSON-line validation, preflight stream consumption, and constructor/executor setup while retaining provider-specific event maps, tool allowlists, error prefixes, and Claude's extra nested `result` lookup. Existing adapter tests already assert the observable command arguments and normalized event stream.

## Proposed change
1. Extract only provider-neutral helper logic into an internal agent-adapter utility, parameterized for provider label/error text and nested-message keys where needed.
2. Replace duplicated constructor dispatch and preflight consumption in both adapters with the shared helper, keeping `binary`, `model`, and injected `AgentExec` semantics unchanged.
3. Retain `mapOmpEvent`/`mapClaudeEvent`, provider tool lists, provider-specific event handling, and all observable error prefixes.
4. Add or adjust focused tests for shared helper boundaries, then run both adapter suites and the full test suite.

## Acceptance criteria
- [ ] One implementation owns shared adapter plumbing; equivalent helper/constructor/preflight code is not duplicated across OMP and Claude adapters.
- [ ] OMP and Claude preserve their current command arguments, session behavior, event mappings, diagnostic/error messages, and cancellation semantics.
- [ ] Claude still extracts nested `result` errors while OMP behavior remains unchanged.
- [ ] Existing adapter fixture and contract tests pass, with focused coverage for any new parameterized helper behavior.

## Risks and open questions
- Over-generalizing provider event mapping would hide meaningful protocol differences; consolidation must stop at shared plumbing and leave `mapOmpEvent`/`mapClaudeEvent` separate.
- Constructor overloads are test injection seams; verify both positional `AgentExec` and options-object forms before changing them.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Re-read both files and confirmed the 6 duplicated blocks: `errorMessage` (omp.ts:31-33 = claude.ts:33-35, byte-identical), `diagnostic` (omp.ts:35-45 = claude.ts:47-57, identical), `malformed` (omp.ts:47-49 vs claude.ts:59-61, differ only `OMP`→`Claude` label), `nestedMessage` (omp.ts:51-69 vs claude.ts:63-81, claude adds `"result"` to the key list at claude.ts:68), `parseJson` (omp.ts:71-87 vs claude.ts:83-99, differ only the provider label in the invalid-JSON/object messages), and `preflight` (omp.ts:168-174 = claude.ts:245-251, byte-identical); the two constructors (omp.ts:153-166 vs claude.ts:230-243) are identical positional/options dispatch differing only in the `binary` default (`"omp"`/`"claude"`) and option-interface name. `grep` shows `nestedMessage`/`parseJson`/`diagnostic`/`malformed` exist only in these two files, so no shared helper exists yet and the duplication is current. Runtime reachability confirmed: `context.ts:123-132` `buildReviewAgent` constructs one adapter from `review.agent`; `layers.ts:557` awaits `agent.preflight()`; `chat.ts:379` runs `agent.run(turn)`.
- **Product impact:** `code` — **Priority P1**
   - The duplicated blocks are module-local plumbing on the live review-agent execution path (preflight + per-line event decode on every layer/chat run), i.e. runtime code on a supported path, so it maps to P1 by surface. The *change itself* is behavior-preserving consolidation, so P1 reflects surface/importance-to-fix, not removal risk; it is the top-priority redundant-code ticket because silent divergence between the two providers on this hot path is a latent correctness hazard.
- **Verification:**
   - Removal safe: `bun test src/adapters/agent src/port-contracts/review-agent.test.ts` → 26 pass / 0 fail, EXIT=0 (ticket recorded 25 at discovery; +1 since, all green). `grep -rn "nestedMessage\|function parseJson\|function diagnostic\|function malformed" src` returns only omp.ts/claude.ts (plus the port's own `malformed` at review-agent.ts:107, a different normalized-shape helper), so no importer breaks; `grep -rn "new OmpAgentAdapter\|new ClaudeAgentAdapter" src` shows the sole *production* construction site is `context.ts:128-131`, the rest being test injection seams (claude.test.ts:46/93/114/154/203, omp.test.ts:46/79/94/130/152/173/194).
   - Supported behavior after removal: per-provider fixture tests pin the exact command arguments and normalized event stream (claude.test.ts / omp.test.ts) and `review-agent.test.ts` pins the `parseAgentEvent` contract; re-running the same command after consolidation must stay 26/0, and a manual `review` run against each provider (omp + claude) must still emit `session`/`text`/`tool`/`turn_end`/`error` events unchanged.
- **Removal risk:** Low. The helpers are private (not exported, no dynamic import/registration), there is a single production construction site (`context.ts`), and no config field, persisted state, network/API shape, or release/installer path touches them; the consolidation is behavior-preserving. Two caveats: (1) over-generalization can hide real provider differences — keep `mapOmpEvent`/`mapClaudeEvent`, Claude's `withAuthRecovery`+`providerError` (claude.ts:37-45), the extra nested `"result"` key (claude.ts:68), and per-provider cancellation (`isTerminal` in mapOmpEvent vs `stop_reason`/`result.is_error` in mapClaudeEvent) all distinct; (2) `errorMessage` is duplicated across 5 files (omp.ts:31, claude.ts:33, chat.ts:107, layers.ts:145, routes.ts:225) — a shared helper would consolidate all 5, but this ticket scopes to the 2 adapters, so leave the other 3 out of scope unless broadened. Note `ports/review-agent.ts:40` `parseAgentEvent` already centralizes the *normalized*-shape decode but does not subsume the adapters' raw provider-line `parseJson`+`mapEvent`.

## Removal process

- [x] **Baseline captured before extraction.** `bun test src/adapters/agent src/port-contracts/review-agent.test.ts` ran 26 / 0 and exited 1 only on configured coverage (74.66% funcs / 84.79% lines); `bun run build` and `bun run lint` passed; `bun test` ran 440 / 0 and exited 1 only on the existing 90% coverage gate (84.99% funcs / 88.36% lines).
- [x] **Temporary removal-proof RED/GREEN coverage.** Added `src/adapters/agent/shared.test.ts`; `bun test src/adapters/agent/shared.test.ts` was RED at 0 / 1 while `shared.ts` was absent. After extraction it was GREEN at 5 / 0 (exit 1 only on focused coverage: 33.33% funcs / 45.95% lines).
- [x] **LSP and source checks re-run.** LSP references found only `context.ts` as a production construction site for each adapter; test construction seams remain. Source scan found shared `errorMessage`, `diagnostic`, `malformed`, `nestedMessage`, `parseJson`, `resolveAgentConfig`, and `preflight` implementations only in `shared.ts`; provider-specific mapping, auth recovery, tool lists, and cancellation remain in `omp.ts`/`claude.ts`.
- [x] **Removed exactly duplicated plumbing.** Added internal `src/adapters/agent/shared.ts`; migrated both adapters' error formatting, diagnostics, malformed events, recursive nested-message lookup, raw JSON parsing, constructor dispatch, and preflight consumption. OMP keys/labels, Claude's extra `result` key and auth recovery, binary/model/options wiring, `ReviewAgent`, and provider event maps remain unchanged. The `chat.ts`, `layers.ts`, and `routes.ts` `errorMessage` copies remain intentionally out of scope.
- [x] **Retained behavior checks.** Kept `omp.test.ts`, `claude.test.ts`, `exec.test.ts`, and `review-agent.test.ts`; `bun test src/adapters/agent src/port-contracts/review-agent.test.ts` ran 31 / 0 with exact command arguments, session/resume, normalized events, Claude error recovery, OMP behavior, executor failures, and abort coverage (exit 1 only on focused coverage: 78.69% funcs / 87.48% lines). Shared tests cover both provider labels, Claude `result` extraction versus OMP keys, malformed input, both constructor forms/default binaries, injected executors, and preflight stream consumption.
- [x] **Final validation.** `bun run build` passed; `bun run lint` passed; `bunx biome check` passed with no diagnostics; `bun test` ran 445 / 0 across 60 files and exited 1 only on the existing aggregate coverage gate (85.30% funcs / 88.61% lines).
- [x] **CLI smoke.** `bun run src/index.tsx --version` and `bun run src/index.tsx help review` passed and showed the supported review entry point. Required authenticated GitLab MR smoke for both `omp` and `claude` was unavailable: `glab mr view` reported no GitLab remote and only `github.com` was configured, so no live layer/chat or abort run is claimed. Provider fixture tests exercised the affected adapter event paths.
- [x] **Ticket-specific risks closed.** Positional and options-object construction are exercised through both adapters and shared boundary tests; provider-specific event/cancellation logic and Claude `result` lookup remain separate; no dynamic/config/persisted-state/network/release/installer consumer was found; undocumented deep imports remain the only residual compatibility risk for this private package.
- [x] **Execution:** 2026-08-30 — committed `4866986` — consolidated duplicated OMP/Claude adapter plumbing with shared boundary coverage.
