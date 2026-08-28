# Remove redundant explicit coverage script

## Type
Redundant code

## Scope
- Area: `Documentation and project configuration`
- Candidate paths: `package.json`, `bunfig.toml`, `README.md`
- Symbols/config/docs: `scripts.test`, `scripts.test:cov`, `[test].coverage`, coverage commands in Development / Testing

## Evidence
- `package.json:10-12` defines `test: "bun test"` and `test:cov: "bun test --coverage"`.
- `bunfig.toml:1-5` sets `[test].coverage = true`, so Bun enables coverage for every `bun test` invocation. Bun's installed code-coverage documentation at `node_modules/bun-types/docs/test/code-coverage.mdx:34-49` states that `coverage = true` always enables coverage by default.
- `bunfig.toml:3` also attempts to configure 90% line/function thresholds, but it uses singular `line`/`function` keys while Bun's documented detailed keys are `lines`/`functions`. The low-coverage successful run is tracked separately in `dead-code/ineffective-coverage-threshold-config.md`; explicit `--coverage` adds no distinct coverage-reporting behavior.
- `bun test src/core/context.test.ts` and `bun test --coverage src/core/context.test.ts` both printed the same coverage table and passed 5 tests with 0 failures. This confirms `test:cov` is behaviorally redundant under the checked Bun configuration.
- `README.md:393-400` presents `bun test` and `bun test --coverage` as separate test modes, although both enable coverage in this repository. Repository search found no CI file or source consumer of `test:cov`; `package.json:1-6` marks the package private.

## Why this is safe to change
The candidate is a duplicate package script and misleading documentation, not application behavior. Removing the alias while retaining `bun test` and its existing coverage-reporting setting preserves observed reporting; threshold enforcement is unresolved and tracked separately. The private package boundary and absence of repository consumers reduce compatibility risk, but external developer shell aliases or automation may still invoke `bun run test:cov`.

## Proposed change
1. Choose `bun test` as the single canonical coverage-reporting command because `bunfig.toml` enables coverage for every test invocation.
2. Remove `scripts.test:cov` from `package.json` and update `README.md:393-400` to explain that `bun test` includes coverage; or retain the script only if an external consumer is identified and document it explicitly as an alias.
3. Resolve the intended threshold policy through `dead-code/ineffective-coverage-threshold-config.md`; do not silently claim that the current singular keys enforce 90%.

## Acceptance criteria
- [ ] The project has one documented command for the current coverage-enabled test behavior, with no misleading distinction between `bun test` and `bun test --coverage`.
- [ ] No repository automation or supported developer workflow loses a required command; any retained compatibility alias is explicitly justified.
- [ ] Coverage reporting remains unchanged, and any intended 90% threshold policy is either demonstrably enforced or explicitly removed/documented through the threshold ticket.
- [ ] `bun test` and an explicit coverage invocation produce the intended documented result after cleanup.

## Risks and open questions
- Check external CI, contributor scripts, and release automation before deleting `test:cov`; none are present in this repository, but private package scripts can still be called outside the tree.
- Confirm target Bun-version policy before relying on `coverage = true` as the canonical behavior; current installed Bun semantics were verified.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Re-ran on Bun 1.3.14: `bun test src/core/context.test.ts` and `bun test --coverage src/core/context.test.ts` produce byte-identical coverage tables (`17.19%` funcs / `21.37%` lines, 5 pass / 0 fail, `EXIT=0` for both) — coverage is emitted by plain `bun test` because `bunfig.toml:2` sets `coverage = true`, confirming `code-coverage.mdx:34-42` ("always enable coverage reporting by default"). `package.json:11` `test:cov: "bun test --coverage"` is therefore behaviorally identical to `package.json:10` `test: "bun test"`; the flag adds no distinct reporting under this config.
- **Product impact:** `docs` — **Priority P4**
   - Surface is a redundant non-load-bearing package script (`package.json:11`) plus a misleading README distinction (`README.md:397-398`, presenting `bun test` and `bun test --coverage` as two modes). No runtime/product surface; no CI (`.github`/`.gitlab-ci.yml` absent) and `scripts/release.ts` runs no tests, so nothing gates product or release on `test:cov`. Pure docs + non-load-bearing config, deferrable → P4 (below P3 threshold ticket, which creates a silent QA gap; this one does not).
- **Verification:**
   - Removal safe: `grep -rn "test:cov" .` returns only the definition (`package.json:11`), historical spec prose (`specs/architecture/implementation-plan.md:47`), and `dead-code/*` notes — no runtime, CI, or release consumer; `scripts/release.ts` has no test/coverage reference. Behavioral equivalence already proven: the two commands above emit identical output and both `EXIT=0`.
   - Supported behavior after removal: `bun run test` still runs all tests and still emits coverage (driven by `bunfig.toml:2` `coverage = true`), and a developer typing `bun test --coverage` still works directly (Bun flag, independent of the script); `bunx tsc --noEmit` and `bun run lint` are untouched (no type/lint surface).
- **Removal risk:** Low. No dynamic loading/registration, no persisted state, no network/API shape. No in-tree consumer (private package, no CI, release runs no tests). Residual: an out-of-tree developer shell alias or automation invoking `bun run test:cov` would break on removal, though the underlying `--coverage` flag still works; also coordinate the `test:cov` reconciliation with `dead-code/ineffective-coverage-threshold-config.md` (its step 4 defers the script decision to this ticket) and confirm the team's minimum Bun version, since `coverage = true` semantics were verified only on Bun 1.3.14.

## Removal process

- [x] Added temporary `test/dead-code/redundant-coverage-script.removal.test.ts`; `bun test test/dead-code/redundant-coverage-script.removal.test.ts` was RED with 0 pass / 1 fail while `scripts.test:cov` existed, then GREEN with 1 pass / 0 fail after removal; deleted proof test before final verification.
- [x] Baseline re-verification completed on Bun 1.3.14. `package.json`, `bunfig.toml`, `README.md`, `specs/architecture/implementation-plan.md`, and `scripts/release.ts` were inspected; `.github` and `.gitlab-ci.yml` are absent. Search found the definition, historical architecture prose, and dead-code notes only; no source, test, CI, release, installer, generated/runtime, dynamic-loading, or package-export consumer. Baseline `bun test src/core/context.test.ts` and `bun test --coverage src/core/context.test.ts` each passed 5 / failed 0 with identical 17.19% funcs / 21.37% lines coverage; `bun run build`, `bun run lint`, and `bun test` passed (441 / 0).
- [x] Removed exactly `scripts.test:cov` from `package.json`. Updated only the maintained README Testing section to make `bun test` the sole canonical coverage-enabled command. Preserved `bunfig.toml` coverage and unresolved singular threshold keys, direct `bun test --coverage` support, and historical `specs/architecture/implementation-plan.md` prose.
- [x] No in-repository `test:cov` consumer was found, so no migration was required. Private-package and out-of-tree alias risk remains; no project-declared minimum Bun version exists, so the supported evidence is the installed Bun 1.3.14 behavior.
- [x] Retained coverage verified: `bun test src/core/context.test.ts` and `bun test --coverage src/core/context.test.ts` each passed 5 / failed 0 with identical 17.19% funcs / 21.37% lines tables; `bun run test` passed 441 / 0 and emitted coverage.
- [x] Final validation passed: `bun run build`, `bun run lint`, and `bun test` (441 / 0). Supported workflow smoke passed with `bun run test` (441 / 0) and direct `bun test --coverage src/core/context.test.ts` (5 / 0). Release/installer paths remain unchanged; package remains private; threshold policy remains assigned to `dead-code/ineffective-coverage-threshold-config.md`.
- [x] Deleted temporary removal proof and reran all retained focused coverage commands plus `bun run test`; both focused commands remained 5 / 0 with identical coverage, and canonical test remained 441 / 0. Residual caveats unchanged: external aliases may break, and Bun minimum-version policy is undeclared.
