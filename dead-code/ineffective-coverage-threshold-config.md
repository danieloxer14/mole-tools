# Fix ineffective Bun coverage threshold keys

## Type
Stale configuration

## Scope
- Area: `Documentation and project configuration`
- Candidate paths: `bunfig.toml`, `package.json`, README testing instructions
- Symbols/config/docs: `[test].coverageThreshold`, `line`, `function`, documented coverage gate

## Evidence
- `bunfig.toml:1-5` configures `coverage = true` and `coverageThreshold = { line = 0.9, function = 0.9 }`.
- Bun's installed coverage documentation at `node_modules/bun-types/docs/test/code-coverage.mdx:51-71` documents detailed threshold keys as `lines`, `functions`, and `statements` (plural), and says valid thresholds make low-coverage test runs exit non-zero. It does not document the singular `line`/`function` keys used here.
- `bun test src/core/context.test.ts` reported only `17.19%` functions and `21.31%` lines yet exited successfully after 5 passing tests. The configured 90% gate therefore did not reject this intentionally narrow low-coverage run. This is direct evidence that the current threshold configuration is ineffective or at least not enforcing the stated policy.
- `package.json:10-12` and `README.md:393-400` describe normal and coverage test commands, but neither documents that the configured threshold may be ignored. `bun test --coverage src/core/context.test.ts` produced the same low-coverage report and also exited successfully.

## Why this is safe to change
The candidate is test-run configuration, not application behavior. Correcting threshold key names would make the declared coverage policy enforceable; removing the threshold would instead relax policy and requires an explicit decision. No runtime command or persisted user configuration depends on these Bun test settings.

## Proposed change
1. Confirm intended coverage policy and Bun-version support for detailed threshold keys.
2. If the 90% gate is intended, change `line`/`function` to the supported `lines`/`functions` keys (and add `statements` only if required), then run the repository's supported test command to identify the real baseline.
3. If no threshold gate is intended, remove the ineffective threshold configuration and document coverage reporting without claiming enforcement.
4. Reconcile `package.json:test:cov` and README coverage instructions with the chosen policy; coordinate with `dead-code/redundant-coverage-script.md` rather than making duplicate script changes.

## Acceptance criteria
- [ ] Bun recognizes the configured threshold keys under the repository's supported Bun version.
- [ ] A deliberately low-coverage test invocation has the intended exit status, proving the gate is real or explicitly absent by policy.
- [ ] README and package scripts describe coverage reporting and enforcement accurately.
- [ ] No application behavior changes and the supported full test command has a documented baseline result.

## Risks and open questions
- Correct keys may expose an existing repository-wide coverage shortfall; treat that as a test/configuration follow-up, not as justification to weaken the gate silently.
- Confirm whether singular keys are accepted by any older Bun version used by the team before changing them.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Re-ran `bun test src/core/context.test.ts` on Bun 1.3.14: 5 pass, `EXIT=0` despite the coverage report listing many modules at `0.00%` funcs/lines — the 90% gate did not reject the low-coverage run, reproducing the ticket. Isolated temp-dir repro proves the mechanism: singular `{ line = 0.9, function = 0.9 }` → `EXIT=0` at 50% funcs, while plural `{ lines = 0.9, functions = 0.9 }` (per `node_modules/bun-types/docs/test/code-coverage.mdx:68`) and scalar `coverageThreshold = 0.9` (`code-coverage.mdx:60`) both → `EXIT=1`; Bun 1.3.14 silently ignores the singular keys used at `bunfig.toml:3`. `bun test --coverage src/core/context.test.ts` also exits 0. Discovery-run percentages are run-dependent (coverage aggregates all imported modules), but non-enforcement is deterministic.
- **Product impact:** `config` — **Priority P3**
   - Surface is test-runner config (`bunfig.toml` `[test]`) plus docs (`package.json:10-11`, `README.md:394-399`). No runtime/product behavior → not P1. Not P2: no CI (`.gitlab-ci.yml`/`.github` absent) and `scripts/release.ts` invokes no tests, so the gate does not gate product or release. It is test/CI-quality tooling with no direct product surface → P3. Above P4 docs drift because the config itself is functionally broken (a silent QA gap), not prose.
- **Verification:**
   - Removal/fix safe: `grep -rn "coverageThreshold\|coverage" .gitlab-ci.yml .github scripts/` → no CI or release consumer; the only "consumers" are historical `.omp/xplan/**` plan notes that cite the 90% gate as an intended convention, not active enforcement.
   - Supported behavior after fix: `bun test` should now fail on the current sub-90% baseline (expect non-zero until real tests are added); `bun test --coverage --coverage-reporter=lcov` confirms the lcov reporter path still emits; `bunx tsc --noEmit` and `bun run lint` remain green (a threshold key change touches no type/lint surface).
- **Removal risk:** Low. No dynamic loading/registration, external/untracked consumers, persisted state, or network/API shape. No CI and no release/installer dependency (`scripts/release.ts` runs no tests). One version-compat boundary: singular-vs-plural key support is Bun-version-dependent; the used toolchain is 1.3.14 (singular ignored) — confirm the team's minimum Bun version before choosing singular-vs-plural keys. Risk of *fixing* (not removing) the gate: plural/scalar keys make `bun test` fail on the existing sub-90% baseline, so the fix must pair added tests with an explicit policy decision, coordinated with `dead-code/redundant-coverage-script.md`.
## Removal process

- [x] Baseline captured on Bun 1.3.14 before editing: `bun test src/core/context.test.ts` and `bun test --coverage src/core/context.test.ts` each passed 5 / failed 0 and reported 17.19% funcs / 21.37% lines while exiting 0; `bun run build`, `bun run lint`, and `bun test` passed (441 / 0). No unrelated baseline failures.
- [x] Policy resolved with `dead-code/redundant-coverage-script.md`: enforce existing configured 90% line/function gate. `bunfig.toml` now uses documented plural `lines`/`functions` keys; `coverage = true`, `coverageSkipTestFiles`, and ignore patterns remain unchanged. No project-declared minimum Bun version exists; supported toolchain evidence is Bun 1.3.14 and older-version compatibility remains an explicit risk.
- [x] Temporary `test/dead-code/ineffective-coverage-threshold-config.removal.test.ts` added. It checked the exact supported plural config and absent singular config, created an isolated low-coverage fixture, invoked `bun test --coverage`, and expected non-zero. Focused command: `bun test test/dead-code/ineffective-coverage-threshold-config.removal.test.ts`; observed RED (0 / 1) against singular keys, then GREEN (1 / 0) after the config fix.
- [x] Changed only `[test].coverageThreshold` in `bunfig.toml` from singular `line`/`function` to supported `lines`/`functions`; no application code, callers, schemas, fixtures, package scripts, or compatibility aliases required migration. Direct `bun test --coverage` and canonical `bun test` coverage behavior remain enabled.
- [x] Retained coverage behavior verified after config change: `bun test --coverage --coverage-reporter=lcov` passed 441 / 0 and emitted `coverage/lcov.info`; `bun test src/core/context.test.ts` passed 5 / 0 at the test level but exited 1 because its 17.19% funcs / 21.37% lines are below the enforced gate.
- [x] Rechecked `coverageThreshold`/`coverage` consumers in `.gitlab-ci.yml`, `.github`, and `scripts/`: no matches; `.gitlab-ci.yml` and `.github` are absent. Maintained README/package instructions contain no stale script or threshold claim; README now states that `bun test` emits coverage and enforces 90% line/function coverage. Historical `.omp/xplan/**` references were left unchanged.
- [x] Final validation: `bun run build` passed; `bun run lint` passed (145 files); `bun test` ran 441 / 0 but exited 1 because aggregate coverage is 84.91% funcs / 88.27% lines, exposing existing sub-90% follow-up without weakening policy; `bun run src/index.tsx help` printed supported commands. No installer/release/UI runtime path changed.
- [x] Deleted temporary removal-proof test and reran retained `bun test --coverage --coverage-reporter=lcov` (441 / 0, `coverage/lcov.info`) and `bun test src/core/context.test.ts` (5 / 0 tests, expected exit 1 from threshold). Execution entry: `[x] 2026-08-28 — committed <short SHA> — enforced documented 90% Bun coverage gate by correcting singular threshold keys and updated README policy wording.`
