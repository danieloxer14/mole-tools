# Remove unreferenced root CLI scaffold

## Type
Dead code

## Scope
- Area: `CLI composition and startup`
- Candidate paths: `index.ts`
- Symbols/config/docs: top-level `console.log("Hello via Bun!")`

## Evidence
- `package.json:4` declares `src/index.tsx` as the module entry point.
- `package.json:8-9` use `src/index.tsx` for both development and compiled startup; no script invokes root `index.ts`.
- `README.md:423`, `specs/architecture/architecture.md:51-52`, and `specs/architecture/code-design.md:63-65` identify `src/index.tsx` as the CLI entry point.
- Repository search found no imports, scripts, documentation instructions, or tests referencing root `index.ts` or its `Hello via Bun!` output.
- `bun run src/index.tsx help` exercised the supported CLI entry path and printed the registered command list; root scaffold is not part of that path.

## Why this is safe to change
`index.ts` has no reachable caller in package metadata, supported commands, tests, or documentation. It only prints a Bun starter message and is superseded by the real `src/index.tsx` CAC composition root. No supported CLI invocation depends on it.

## Proposed change
1. Delete root `index.ts`.
2. Keep `src/index.tsx` as the sole CLI entry point; update no callers because repository search found none.

## Acceptance criteria
- [ ] Root `index.ts` no longer exists.
- [ ] Package scripts and build metadata still point to `src/index.tsx`.
- [ ] No supported CLI caller or documentation reference is removed accidentally.
- [ ] `bun run src/index.tsx help` and `bun run src/index.tsx --version` retain current output and exit successfully.

## Risks and open questions
- `index.ts` could be used by an undocumented external command such as `bun run index.ts`; no repository evidence supports that path. Confirm release notes or external consumer requirements before deletion.

## Assessment

- **Validated:** 2026-08-27 — `valid`
    - Re-ran the recorded evidence against current source. Root `index.ts` is a one-line Bun scaffold (`console.log("Hello via Bun!")`, 31 B) with no reachable caller: `package.json:4` sets `module` to `src/index.tsx` and `package.json:8-9` run/build `src/index.tsx`; `scripts/release.ts:90` builds via the `build` script (`src/index.tsx`) and `install.sh:7,14` download a prebuilt binary; no `exports` map/barrel (private pkg `package.json:6`). `grep -rn 'index\.ts' src test scripts` returns only string fixtures — `src/features/worktree-prune/summary.test.ts:11,28,41` and `src/shared/diff.test.ts:11,12` use `"src/index.ts"` as fake git-diff data, not as a consumer; a side-effect-import / standalone-exec search over `src;test;scripts;package.json;bunfig.toml;install.sh;tsconfig.json;README.md;specs;docs` found none. `bun run index.ts` prints only `Hello via Bun!` (exit 0).
- **Product impact:** `code` — **Priority P3**
    - Dead runtime-code file at repo root, but off every supported path (not the module entry, build target, script, or import target); it prints a starter message only, so no product surface — no user-facing behavior, no contract/schema/release surface → internal dead code, defer. Mirrors the `review-unused-compatibility-wrappers` / `review-agent-generic-parser` P3 precedent (dead code, no product surface).
- **Verification:**
    - Prove removal safe: `grep -rn 'index\.ts' src test scripts` → only the two fixture files above (fake diff paths, not consumers); search for side-effect imports / standalone execution of root `index.ts` (e.g. `import "./index.ts"`, `bun run index.ts`, `./index.ts`) across `src test scripts package.json bunfig.toml install.sh tsconfig.json README.md specs docs` → no matches; `package.json:4,8-9` and `scripts/release.ts:90` reference `src/index.tsx`, never root `index.ts`; the file has no exports, so no static or side-effect import can target it.
    - Prove supported behavior still works: `bun run src/index.tsx help` → exit 0, lists `commit init merge-request worktree-prune review`; `bun run src/index.tsx --version` → `mole-tools/0.3.1 darwin-arm64 bun-v24.3.0`, exit 0; `bun test` unaffected (no test imports root `index.ts`).
- **Removal risk:** None found for the product after checking dynamic loading (no `import(` target), external/untracked consumers (private pkg, `module` = `src/index.tsx`, no export map/barrel), CLI options, config fields, persisted state, network/API shape, and release/installer paths (`release.ts` builds `src/index.tsx`; `install.sh` downloads the binary). Residual: an out-of-tree `bun run index.ts` / `bun index.ts` would lose the `Hello via Bun!` starter message only — no in-repo evidence of such a consumer; the ticket's "Risks and open questions" already flags it.

- **Needs investigation:** 2026-08-28 — removal is blocked before editing because current baseline is not green. `bun run src/index.tsx help` exited 0 and listed `commit`, `init`, `merge-request`, `worktree-prune`, and `review`; `bun run src/index.tsx --version` exited 0 with `mole-tools/0.3.1 darwin-arm64 bun-v24.3.0`; `bun run index.ts` emitted only `Hello via Bun!`; `bun run build` and `bun run lint` passed; `bun test` ran 441 tests with 0 failures and 1075 expectations but exited 1 under `bunfig.toml`'s enforced 90% coverage gate at 84.91% functions / 88.27% lines. Missing evidence: green full-test baseline after the unrelated coverage shortfall is resolved; no removal-proof test or deletion was attempted.

## Removal process

- [x] Capture baseline before editing (2026-08-28): `bun run src/index.tsx help` and `bun run src/index.tsx --version` exited 0 with the registered command list and `mole-tools/0.3.1 darwin-arm64 bun-v24.3.0`; `bun run index.ts` emitted only `Hello via Bun!`; `bun run build` and `bun run lint` passed; `bun test` ran 441 pass / 0 fail / 1075 expectations but exited 1 under the enforced 90% coverage gate (84.91% functions / 88.27% lines). Baseline is not green, so removal did not start.
- [ ] Add temporary `test/dead-code/root-cli-scaffold.removal.test.ts` that asserts the repository root `index.ts` file does not exist; run `bun test test/dead-code/root-cli-scaffold.removal.test.ts` and observe RED while the one-line scaffold remains.
- [ ] Re-check package metadata, `src/index.tsx`, `scripts/release.ts`, `install.sh`, and supported docs for entrypoint references; distinguish fixture strings `"src/index.ts"` in `src/features/worktree-prune/summary.test.ts` and `src/shared/diff.test.ts` from imports/standalone execution and preserve those fixtures.
- [ ] Delete only root `index.ts` and its `console.log("Hello via Bun!")`; keep `src/index.tsx` as the sole CLI composition root and make no caller migration because no supported caller exists.
- [ ] Run `bun test test/dead-code/root-cli-scaffold.removal.test.ts`, `bun run src/index.tsx help`, and `bun run src/index.tsx --version`; all must be GREEN, with command list/version output unchanged and fixture data intact.
- [ ] Re-run repository searches for root-entry imports/standalone execution and confirm `package.json` module/dev/build scripts, `scripts/release.ts`, and `install.sh` still use `src/index.tsx` or the compiled binary; no `index.ts` consumer, export map, dynamic loader, CLI/config/API/persisted-state path, or release/install dependency may remain.
- [ ] Run final validation `bun run build`, `bun run lint`, and `bun test`; smoke both supported CLI commands again (`bun run src/index.tsx help` and `bun run src/index.tsx --version`) and do not treat the deleted `bun run index.ts` greeting as supported behavior.
- [ ] Delete the temporary removal-proof test, rerun `bun test`, and record the execution result. Before committing, reconfirm private-package/no-export boundary and the residual risk of an undocumented out-of-tree `bun run index.ts`/`bun index.ts`; if such a consumer is required, update `## Assessment` and stop rather than deleting the scaffold.
