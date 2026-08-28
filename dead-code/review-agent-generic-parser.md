# Remove superseded generic review-agent event parser

## Type
Dead code | Redundant code

## Scope
- Area: `Review-agent adapters and execution`
- Candidate paths: `src/ports/review-agent.ts`, `src/adapters/agent/exec.test.ts`, `src/port-contracts/review-agent.test.ts`
- Symbols/config/docs: `parseAgentEvent`, `unknownEvent`, `isRecord`, `isToolPhase`, parser-only assertions

## Evidence
- `lsp references` for `parseAgentEvent` found references only in its declaration, `src/adapters/agent/exec.test.ts`, and `src/port-contracts/review-agent.test.ts`; no production caller.
- `src/core/context.ts:123-131` selects `OmpAgentAdapter` or `ClaudeAgentAdapter`, and both adapters decode their provider-specific envelopes internally (`mapOmpEvent` and `mapClaudeEvent`). Neither adapter calls `parseAgentEvent`.
- `src/adapters/agent/exec.test.ts:61-144` replays the same OMP and Claude NDJSON fixtures through `parseAgentEvent` and expects provider events to become diagnostics. The adapter tests (`src/adapters/agent/omp.test.ts:44-75,77-90` and `src/adapters/agent/claude.test.ts:44-88`) replay those fixtures through the live provider-specific decoders and assert the actual shared events.
- `package.json:6` marks the package private, `package.json:5` identifies `src/index.tsx` as its module entry, and `src/index.tsx` exports only `applyZodOptions`; no external package API exposes this parser.
- Targeted verification: `bun test src/adapters/agent src/port-contracts/review-agent.test.ts` passed 25 tests, including parser-only tests and provider adapter behavior.

## Why this is safe to change
`parseAgentEvent` has no runtime consumer in this private CLI. Its provider-neutral `type`/`kind` decoder cannot interpret OMP or Claude envelopes as meaningful events; the adapters already own those mappings. The adapter tests provide live behavior coverage, while the remaining review-agent contract tests can continue to cover `ReviewAgent` event ordering, errors, and cancellation without retaining an unused parser export. No dynamic registration, generated consumer, persisted state, or network boundary references this symbol.

## Proposed change
1. Remove `parseAgentEvent` and its private parser helpers from `src/ports/review-agent.ts`.
2. Remove parser-only imports and assertions from `src/adapters/agent/exec.test.ts` and `src/port-contracts/review-agent.test.ts`; retain executor line-order, exit, cancellation, and provider-adapter coverage.
3. Re-run adapter and review-agent contract tests, then the full test suite, to prove OMP and Claude event normalization remains supported.

## Acceptance criteria
- [ ] No production or test import/reference to `parseAgentEvent` remains.
- [ ] `src/ports/review-agent.ts` contains only the live review-agent port and event types after parser removal.
- [ ] OMP and Claude fixtures still normalize to session, text, tool, error, diagnostic, and turn-end events through their adapters.
- [ ] Targeted adapter/contract tests and the full test suite pass.

## Risks and open questions
- The only compatibility risk is an untracked consumer importing an internal source path; repository search, language-server references, private-package metadata, and the `src/index.tsx` entrypoint found none. If this repository later becomes a library, define an explicit supported export before removal.

## Assessment

- **Validated:** 2026-08-26 — `valid`
    - Re-ran `lsp references`/`grep` for `parseAgentEvent`: 9 refs, all in the declaration (`src/ports/review-agent.ts:40`) and the two test files (`exec.test.ts:3,44,134`; `review-agent.test.ts:5,122,129,133,138`); no production caller. Non-test port imports are type-only — `context.ts:16`, `layers.ts:8`, `chat.ts:5`, `routes.ts:12` import `type { ReviewAgent }`/`type { AgentEvent, ReviewAgent }`, and `omp.ts:5`/`claude.ts:5` import types; none imports `parseAgentEvent`. The 4 private helpers are used only inside `parseAgentEvent`: `unknownEvent` (:59,:83), `isRecord` (:51), `isToolPhase` (:73), `malformed` (:66,71,75,81); the same names in `store.ts:35`/`omp.ts:47`/`claude.ts:59` are separate module-scoped defs, so no cross-file dependency. Targeted `bun test src/adapters/agent src/port-contracts/review-agent.test.ts` → 26 pass / 0 fail (ticket recorded 25 at discovery; +1 since, all green); coverage shows `src/ports/review-agent.ts` 100% funcs / 85.45% lines with uncovered 52-55,66,78-80 — exactly the parser's own branches.
- **Product impact:** `code` — **Priority P3**
    - `parseAgentEvent` is an unused export in the `ReviewAgent` port module — dead code with zero runtime consumer (superseded by `mapOmpEvent`/`mapClaudeEvent`), so it touches no supported path and maps to P3 "internal helper with no direct product surface" plus its parser-only test cleanup. Not P1/P2: the live contract is the `ReviewAgent` interface plus the `AgentEvent`/`AgentTurn`/`AgentDiagnosticCode` types (all retained); the parser gates nothing and is off the hot path (contrast `review-agent-adapter-duplication` P1, whose blocks run on the per-line decode path).
- **Verification:**
    - Removal safe: `grep -rn parseAgentEvent src` returns only the declaration + 2 test files (no production importer); the 4 helpers have no use outside `parseAgentEvent`; non-test port imports are `type`-only, so deleting the function + helpers + the 3 parser-only test blocks leaves no dangling reference. Re-run `bun test src/adapters/agent src/port-contracts/review-agent.test.ts` and expect the parser-independent subset green: exec.test.ts line-order/exit/abort at :146/:159/:174, and review-agent.test.ts FakeReviewAgent ordering/error/abort at :18/:58/:75/:98.
    - Supported behavior after removal: full `bun test` must stay green; a manual `review` run against both `omp` and `claude` must still emit `session`/`text`/`tool`/`turn_end`/`error` events unchanged — those flow through `mapOmpEvent`/`mapClaudeEvent`, never the generic parser.
- **Removal risk:** None found. No dynamic import/registration (static import by 2 test files only); no external consumer (private package `package.json:6`, module entry `src/index.tsx` exports only `applyZodOptions`, no export map/barrel re-exports the parser); no config field, persisted state, or network/API shape touched (`AgentEvent`/`ReviewAgent` types retained); `scripts/release.ts`/`install.sh` don't reference it. Caveats: (1) remove only the 3 parser-only tests — exec.test.ts:29-59 and :61-144, review-agent.test.ts:121-144 — retain the parser-independent ones; (2) the `parseAgentEvent` import (exec.test.ts:3, review-agent.test.ts:5) drops, but `PortError` (exec.test.ts:2) stays — it is used at :167 by the non-zero-exit test; (3) if the repo later becomes a library, define an explicit supported export before removal.
- **Needs investigation:** 2026-08-28 — removal iteration stopped before editing because required baseline was not green. `bun test src/adapters/agent src/port-contracts/review-agent.test.ts` passed 26 tests with 0 failures but exited 1 because focused coverage was 74.66% functions / 84.79% lines, below enforced 90% thresholds. `bun run build` passed. `bun run lint` passed. Full `bun test` passed 441 tests with 0 failures but exited 1 because coverage was 84.91% functions / 88.27% lines. Missing evidence: a green baseline for this ticket after the repository-wide coverage gate is restored or coverage is raised above 90%; no source removal was attempted.
## Removal process

- [x] Capture baseline before editing — 2026-08-28: focused `bun test src/adapters/agent src/port-contracts/review-agent.test.ts` passed 26 tests with 0 failures but exited 1 at 74.66% functions / 84.79% lines against 90% thresholds; `bun run build` passed; `bun run lint` passed; full `bun test` passed 441 tests with 0 failures but exited 1 at 84.91% functions / 88.27% lines. Parser-only tests are included in the 26 focused passes; no removal-proof test was added because baseline was not green.
- [ ] Add temporary `test/dead-code/review-agent-generic-parser.removal.test.ts` that reads `src/ports/review-agent.ts`, `src/adapters/agent/exec.test.ts`, and `src/port-contracts/review-agent.test.ts` and asserts `parseAgentEvent`, `unknownEvent`, `isRecord`, `isToolPhase`, and `malformed` are absent from their obsolete declaration/import/assertion locations; run `bun test test/dead-code/review-agent-generic-parser.removal.test.ts` and observe RED before removal.
- [ ] Remove `parseAgentEvent` and its four private helpers from `src/ports/review-agent.ts`; remove only parser imports/assertions and the parser-only blocks in `src/adapters/agent/exec.test.ts:29-59,61-144` and `src/port-contracts/review-agent.test.ts:121-144`. Keep `PortError` in `exec.test.ts`, the `ReviewAgent`/`AgentEvent`/`AgentTurn`/`AgentDiagnosticCode` types, and all parser-independent tests.
- [ ] Re-run `bun test test/dead-code/review-agent-generic-parser.removal.test.ts` and `bun test src/adapters/agent src/port-contracts/review-agent.test.ts`; both must be GREEN. Confirm OMP and Claude fixtures still normalize through `mapOmpEvent`/`mapClaudeEvent` and that line ordering, exit, cancellation, FakeReviewAgent ordering, errors, and abort behavior remain covered.
- [ ] Re-check `grep -rn "parseAgentEvent\|unknownEvent\|isRecord\|isToolPhase\|malformed" src test`, LSP references, and dynamic-import/string searches; allow unrelated same-named module-local helpers, but leave no parser import, export, or call and retain no stale parser-only fixture reference.
- [ ] Run final validation `bun run build`, `bun run lint`, and `bun test`; smoke the supported review entry with `bun run src/index.tsx help review`, and if credentials/config permit, execute one `review` run for both `omp` and `claude` to observe session/text/tool/turn-end/error events without claiming a generic parser path.
- [ ] Delete the temporary removal-proof test, rerun the retained adapter/contract tests, and record the execution result. Before committing, reconfirm no dynamic registration, package root export, config/persisted-state/network/release or installer consumer exists; if this private package later needs a public parser API, update `## Assessment` instead of retaining this orphan.
