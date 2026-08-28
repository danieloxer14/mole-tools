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
- **Needs investigation:** 2026-08-28 — removal is blocked before editing because current baseline is not green. `bun test src/adapters/llm/pi.test.ts src/adapters/llm/ollama.test.ts` ran 6 tests with 0 failures and 8 expectations but exited 1 under `bunfig.toml`'s enforced 90% coverage gate (77.78% functions / 83.33% lines); `bun test src/ports/llm.test.ts src/core/context.test.ts` ran 7 tests with 0 failures and 13 expectations but exited 1 under the same gate (17.19% functions / 21.37% lines). `bun test` ran 440 tests with 1 failure in `review routes > cancels one chat without stopping another` at `src/features/review/routes.test.ts:730`; `bun run build` and `bun run lint` passed. Missing evidence: green focused and full baseline after the coverage-gate follow-up and unrelated review-route failure are resolved. No removal-proof test or source edit was made.
## Removal process

- [x] Capture baseline before editing (2026-08-28): the Pi/ollama command ran 6 pass / 0 fail / 8 expectations but exited 1 at 77.78% functions / 83.33% lines; the port/context command ran 7 pass / 0 fail / 13 expectations but exited 1 at 17.19% functions / 21.37% lines; `bun run build` passed; `bun run lint` passed; full `bun test` ran 440 pass / 1 fail at `src/features/review/routes.test.ts:730` (`review routes > cancels one chat without stopping another`). Baseline is not green, so removal did not start.
- [ ] Add temporary `test/dead-code/pi-no-op-generate-test.removal.test.ts` that reads `src/adapters/llm/pi.test.ts` and asserts the `generate returns an AsyncIterable (integration stub)` test title/catch-all block is absent; run `bun test test/dead-code/pi-no-op-generate-test.removal.test.ts` and observe RED while the vacuous test remains.
- [ ] Decide explicitly whether an assertion-backed Pi success-path contract is required; do not restore the current catch-all smoke test. Keep `PiAdapter.generate`, provider configuration, `buildContext` Pi wiring, and the non-zero-process error test.
- [ ] Delete only the `generate returns an AsyncIterable (integration stub)` block at `src/adapters/llm/pi.test.ts:10-28`, remove no production adapter, configuration field, fixture, or provider wiring, and leave the constructor/projectRoot test unchanged unless the separate contract decision changes it.
- [ ] Re-run `bun test test/dead-code/pi-no-op-generate-test.removal.test.ts` and the retained focused commands `bun test src/adapters/llm/pi.test.ts src/adapters/llm/ollama.test.ts`, `bun test src/ports/llm.test.ts`, and `bun test src/core/context.test.ts`; all must be GREEN with Pi construction, non-zero exit propagation, provider wiring, and the LLM port contract still covered.
- [ ] Re-check `grep -rn "integration stub" src`, `grep -rn "PiAdapter" src test`, and `glob **/*.snap`; confirm no stale fixture/snapshot/preload or test-discovery reference remains and that only intended production/test references survive.
- [ ] Run final validation `bun run build`, `bun run lint`, and `bun test`; smoke the supported CLI entry with `bun run src/index.tsx help` (and `bun run src/index.tsx help review` if the review command is exercised) without claiming an undocumented Pi stdout framing contract.
- [ ] Delete the temporary removal-proof test, rerun all retained Pi/context/port tests, and record the execution result. Reconfirm no runtime/config/CLI/network/release compatibility surface changed; if an out-of-tree success-path requirement is discovered, update `## Assessment` before adding a new assertion-backed test.
