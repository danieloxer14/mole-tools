# Remove non-asserting Pi generation smoke test

## Type
Obsolete test/fixture

## Scope
- Area: `Tests, fakes, and fixtures`
- Candidate paths: `src/adapters/llm/pi.test.ts:10-28`
- Symbols/config/docs: `PiAdapter.generate`; `generate returns an AsyncIterable (integration stub)`

## Evidence
- `src/adapters/llm/pi.test.ts:10-28` starts `PiAdapter` with `binary: "echo"`, drains generated chunks into a local string, and never asserts the string, chunk count, command arguments, or completion result.
- The same test catches every error at `src/adapters/llm/pi.test.ts:25-27`; it passes whether generation succeeds, emits incorrect output, or fails to spawn.
- `src/adapters/llm/pi.ts:18-50` has observable behavior in stdout token emission and non-zero-process error propagation, but the candidate test checks neither behavior. `src/adapters/llm/pi.test.ts:29-42` separately asserts the non-zero exit error, and `src/core/context.test.ts:89-111` verifies Pi provider wiring through `buildContext`.
- Whole-repository fixture/setup search found no Pi test fixture, snapshot, preload, or alternate consumer associated with the stub. `bun test src/adapters/llm/pi.test.ts src/adapters/llm/ollama.test.ts` passed 6 tests with 0 failures and 8 expectations; the candidate contributes no expectation.
- `PiAdapter` remains live production code: `src/core/context.ts:11,103-117` constructs it for configured non-Ollama provider profiles. This ticket removes only the vacuous test, not the adapter or its wiring.

## Why this is safe to change
The candidate has no assertion capable of detecting a supported or broken generation result and tolerates all runtime errors. Removing it cannot remove a behavior contract. Pi wiring remains covered by the context test, while the meaningful non-zero exit contract remains covered by the adjacent test. A real stdout test should replace it only if the repository chooses to define and stabilize Pi subprocess output framing; that is not implied by this cleanup.

## Proposed change
1. Delete the `generate returns an AsyncIterable (integration stub)` test from `src/adapters/llm/pi.test.ts`.
2. Retain the constructor/configuration and non-zero-exit tests, `PiAdapter.generate`, and context provider-wiring coverage.
3. If a future Pi output contract is intentionally supported, add a deterministic assertion-backed test using an explicit fake executable or injected subprocess seam rather than restoring this catch-all smoke test.
4. Run the focused Pi/context tests and the repository test command.

## Acceptance criteria
- [ ] No test remains that catches all Pi generation errors while asserting no result.
- [ ] Pi provider construction and non-zero exit behavior remain covered.
- [ ] No production Pi adapter, configuration field, or provider wiring is removed.
- [ ] Focused verification and the full Bun test suite pass.

## Risks and open questions
- Pi stdout framing is currently an undocumented subprocess boundary; decide whether future support requires an assertion-backed success-path test before deleting the stub.
- The constructor test is intentionally left unchanged because it exercises acceptance of the configured `projectRoot` seam; reassess it only with an explicit test-contract decision.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Re-ran `bun test src/adapters/llm/pi.test.ts src/adapters/llm/ollama.test.ts` → 6 pass / 0 fail / 8 `expect()` calls; the `integration stub` at `pi.test.ts:10-28` has zero `expect()` and a `catch {}` at `pi.test.ts:25-27`, so it contributes no expectation. `PiAdapter` live at `context.ts:11` (import) + `context.ts:113` (`buildAdapterMap`); wiring covered by `context.test.ts:89-111`; extra contract coverage at `src/ports/llm.test.ts:11-14` (`typeof adapter.generate === "function"`). No snapshot/fixture/preload references the stub (`glob **/*.snap` + `grep "integration stub" src` clean; `PiAdapter` only in `pi.ts`, `pi.test.ts`, `context.ts`, `ports/llm.test.ts`).
- **Product impact:** `test` — **Priority P3**
   - Candidate is a single vacuous unit test with no runtime/CLI/config/network surface; it gates nothing. Only effect of removal is dropping line coverage on the `pi.ts` generate body (still exercised by the non-zero-exit test `pi.test.ts:29-42` and the contract test `ports/llm.test.ts:11-14`). Test/fixture surface → P3.
- **Verification:**
   - Proves removal is safe: delete `pi.test.ts:10-28`, then `bun test src/adapters/llm/pi.test.ts src/adapters/llm/ollama.test.ts` and `bun test src/ports/llm.test.ts src/core/context.test.ts` still green; `grep -rn "integration stub" src` returns nothing; `glob **/*.snap` shows no Pi snapshot.
   - Proves supported behavior still works after removal: `bun test src/ports/llm.test.ts` (contract: `generate` is a function), `bun test src/core/context.test.ts` (Pi provider wiring via `buildContext`), `bun test src/adapters/llm/pi.test.ts` (constructor + non-zero exit), then full `bun test`.
- **Removal risk:** None found for runtime/config/CLI/network/release — the candidate is a test file with no external or untracked consumer (only `pi.ts`, `context.ts`, `ports/llm.test.ts` reference `PiAdapter`). Sole open item is the policy question already in "Risks and open questions": whether the team wants an assertion-backed success-path test before deleting the stub; that is a coverage-vs-assertion decision, not a removal blocker.
- **Baseline caveat:** 2026-08-30 — the repository's configured `bun test` remains non-zero only because `bunfig.toml` enforces 90% coverage; final run had 447 tests pass / 0 fail at 85.34% functions / 88.87% lines. The focused suites and full suite had no test failures with an explicit temporary config disabling coverage. This existing repository-wide gate is unrelated to the vacuous-test removal; no removal-specific blocker remains.
## Removal process

- [x] Capture baseline before editing (2026-08-30): the Pi/ollama command ran 6 pass / 0 fail / 8 expectations but exited 1 at 77.78% functions / 83.33% lines; the port/context command ran 7 pass / 0 fail / 13 expectations but exited 1 at 18.09% functions / 21.26% lines; `bun run build` passed; `bun run lint` passed; full `bun test` ran 448 pass / 0 fail but exited 1 at 85.56% functions / 88.92% lines. Baseline is not green, so removal did not start.
- [x] Re-verified assessment before editing (2026-08-30): `PiAdapter` remains constructed only through `buildContext` for configured non-Ollama profiles; no dynamic/registration/configuration/CLI/generated/runtime/fixture/snapshot consumer references the stub. No caller or import migration is required. Keep constructor/projectRoot acceptance, `generate`, non-zero-process propagation, provider wiring, and `typeof adapter.generate === "function"` coverage. Compatibility/release/archive checks are not applicable to this test-only deletion.
- [x] Contract decision before editing (2026-08-30): no assertion-backed Pi stdout success-path contract is currently documented or required; do not replace vacuous smoke with a new test. Removal proof will inspect source structure; retained behavior commands remain the Pi/ollama, port, and context focused suites. The recorded 90% coverage-gate baseline blocker remains unrelated; test assertions will be re-run with coverage disabled, and final `bun test` status will be recorded exactly.
- [x] Added temporary `test/dead-code/pi-no-op-generate-test.removal.test.ts`; `bun --config=/tmp/mole-tools-no-coverage-bunfig.toml test test/dead-code/pi-no-op-generate-test.removal.test.ts` was RED (1 fail) before removal and GREEN (1 pass / 0 fail; 2 expectations) after removal.
- [x] Decision recorded: no assertion-backed Pi stdout success-path contract is documented or required; retained `PiAdapter.generate`, provider configuration, `buildContext` wiring, constructor/projectRoot acceptance, non-zero exit propagation, and LLM port contract coverage.
- [x] Deleted only the vacuous `generate returns an AsyncIterable (integration stub)` test block from `src/adapters/llm/pi.test.ts`; no production adapter, configuration, provider wiring, fixture, or supported behavior changed.
- [x] Re-ran retained tests after proof cleanup with `bun --config=/tmp/mole-tools-no-coverage-bunfig.toml`: Pi/ollama 5 pass / 0 fail / 8 expectations; LLM port 2 pass / 0 fail / 2 expectations; context 5 pass / 0 fail / 11 expectations.
- [x] Rechecked `src` for `integration stub` (no matches), `src`/`test` for `PiAdapter` (only intended adapter, retained tests, context wiring, and port contract references), and `**/*.snap` (none). No stale fixture, snapshot, preload, dynamic, configuration, CLI, network, release, or archival reference remains.
- [x] Final validation: `bun run build` passed; `bun run lint` passed; exact `bun test` ran 447 pass / 0 fail but exited on existing 90% coverage gate at 85.34% functions / 88.87% lines; full assertions passed with `bun --config=/tmp/mole-tools-no-coverage-bunfig.toml test`; `bun run src/index.tsx help` listed all five commands.
- [x] Deleted temporary removal-proof test and reran all retained Pi/ollama, LLM port, and context tests (all pass above). Runtime/config/CLI/network/release compatibility remained unchanged; no out-of-tree success-path requirement was discovered.
