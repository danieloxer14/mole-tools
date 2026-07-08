# mole-tools — Implementation Plan (commit tool → binary)

**Status:** Planned. No implementation yet.
**Date:** 2026-07-08
**Author:** Daniel Oxer
**Companions:** [architecture.md](./architecture.md), [code-design.md](./code-design.md),
[../commit-tool.md](../commit-tool.md), [spike-ink-bun-compile.md](./spike-ink-bun-compile.md)

Sequenced, bottom-up build of the **commit** tool through a shippable macOS
arm64 binary. Each layer is testable before the next depends on it. Every phase
ends with a **gate** — a concrete, checkable outcome. Acceptance-criteria row
numbers refer to [../commit-tool.md](../commit-tool.md) §7.

Ink under `bun build --compile` is already de-risked (spike PASS,
`react-devtools-core` mandatory). `init` ships **both** ways: loader
auto-bootstrap on first run *and* a standalone `init` subcommand.

---

## Dependency order

```
0 ──▶ 1 ──▶ ┬─▶ 2 ┐
            ├─▶ 3 ┼─▶ 6 ──▶ 7 ──▶ 8
            ├─▶ 4 ┤
            └─▶ 5 ┘
```

- **0 → 1** hard prerequisite.
- **2, 3, 4, 5** all depend only on the Phase 1 contracts — parallelizable.
- **6** needs 2 + 3 + 4 + 5 (real flow + real adapters + UI + fakes).
- **7** needs 6. **8** last.

---

## Phase 0 — Scaffold

- `git init`; `.gitignore` (`node_modules`, the `mole-tools` binary, `*.log`).
- `bun init`. `package.json` dependencies **pinned from the spike**:
  - runtime: `ink@7.1.0`, `react@19.2.7`, `ink-text-input@6.0.0`,
    **`react-devtools-core`** (compile fails without it — spike gotcha),
    `cac`, `zod`.
  - dev: `@biomejs/biome`, `@types/react`.
- `tsconfig.json` (`jsx: react-jsx`, bundler module resolution, strict).
- `biome.json`.
- npm scripts: `dev` (`bun run src/index.tsx`), `build` (see Phase 8), `test`
  (`bun test`), `test:cov` (`bun test --coverage`), `lint` (`biome check`).
- `bunfig.toml` — enable coverage + enforce a threshold:
  ```toml
  [test]
  coverage = true
  coverageThreshold = { line = 0.9, function = 0.9 }
  coverageSkipTestFiles = true
  ```
  Excludes: `src/index.tsx` (thin cac wiring, covered by Phase 7 integration),
  `adapters/ui/UiHost.tsx` (Ink render, covered by Phase 5 manual smoke).
- Directory skeleton per [code-design.md](./code-design.md) §3:
  `core/ ports/ adapters/ shared/ features/ test/fakes/`.
- `src/index.tsx` stub that prints help.

**Gate:** `bun run src/index.tsx` prints stub help; `bun test` runs clean;
`bun test --coverage` reports (threshold trivially met with no source yet);
`biome check` passes.

---

## Phase 1 — Contracts (interfaces + types only, no logic)

Pure type layer. Nothing here imports an adapter.

- `ports/ui.ts` — `UiPort` (fixed primitive vocabulary, code-design §8) + `Choice<T>`.
- `ports/vcs.ts` — `Vcs` + `FileDiff`, `CommitMeta`, `LogQuery`.
- `ports/llm.ts` — `Llm` (streaming `AsyncIterable<string>`) + `LlmRequest`.
- `ports/issue-tracker.ts` — `IssueTracker` + `Issue`.
- `ports/git-host.ts` — `GitHost` + host types (reserved for MR; interface only).
- `core/feature.ts` — `Feature<A, R>` interface.
- `core/errors.ts` — `AbortError`, `UserRejectedError`, `PortError`, `handleError`.
- `core/context.ts` — `Context` type + `buildContext` **signature** (body stubbed / throws).
- `core/registry.ts` — `features: Feature[] = []`.

**Gate:** `tsc`/`bun` typecheck clean; dependency rule holds (ports/core import
nothing from adapters).

---

## Phase 2 — Pure functions (zero mocks, TDD)

Data in, data out. Colocated `*.test.ts`, no ports, no I/O.

- `shared/diff.ts` → `filterDiff(files, ignoreGlobs)` — patch body vs stat-only
  (spec §5.2). **Covers acceptance #8.**
- `shared/format.ts` → `checkFormat(message)` → `{ ok } | { ok: false, violations }`
  — Conventional Commits prefix + subject ≤72 + blank line before body
  (spec §5.5). **Covers the check side of acceptance #9.**
- `features/commit/prompt.ts` → `buildCommitPrompt(system, issue, diff)`.

**Gate:** `bun test` green; all assertions plain input→output, no mocks.

---

## Phase 3 — Config adapter + `init`

- `adapters/config/schema.ts` — zod schema mirroring [../commit-tool.md](../commit-tool.md)
  §3 table + `Config` type. MR-only keys (`ollama.mrModel`, `mrSystemPrompt`,
  `dynamicEnvRepos`, `autoReviewer`) present but optional.
- `adapters/config/loader.ts` — load `~/.config/mole-tools/config.json`,
  zod-validate (precise errors), **first-run template bootstrap** (default
  Ollama model, Jira disabled; write template, tell user the path, proceed).
- `features/init/index.ts` — standalone `Feature` that writes/overwrites the
  template explicitly (registered in Phase 6/7).
- Unit tests: bootstrap-writes-template + continues, bad key → precise error,
  valid load parses. **Covers acceptance #1.**

**Gate:** `bun test` green; acceptance #1 covered; loader and init share the
template source.

---

## Phase 4 — Adapters (real adapter, mocked transport)

Instantiate the real adapter, mock only its transport. No live network/subprocess.

- `adapters/vcs/git.ts` — Bun `$` wrappers (`stagedDiff`, `hasStagedChanges`,
  `commit`, `push`, `currentBranch`, `defaultBranch`, …). Parse stdout →
  structured `FileDiff[]`/`CommitMeta[]`. On failure throw `PortError` carrying
  **verbatim** stderr. **Covers acceptance #15** (push rejected).
- `adapters/llm/ollama.ts` — `fetch` → `/api/generate`, `stream: true`; yield
  decoded chunks as `AsyncIterable<string>`. Daemon-unreachable → `PortError`
  with the URL (**#3**); model-not-pulled → `PortError` with `ollama pull <model>`
  hint (**#4**).
- `adapters/issue-tracker/jira.ts` — fetch ticket summary + description;
  network/auth/404 → `PortError` (**#6**).

Unit tests mock `fetch` / Bun `$`: assert the outbound request/command is
correct and the mocked response parses to the right structured value.

**Gate:** `bun test` green; adapter failure-mapping rows (#3, #4, #6, #15)
covered at adapter level.

---

## Phase 5 — UI bridge (Ink ↔ async UiPort)

Flow runs outside React; Ink renders once and reacts to a controller
(code-design §8).

- `adapters/ui/controller.ts` — `UiController` with a single current-request
  slot + `subscribe`/`getSnapshot` (React 19 `useSyncExternalStore` source).
- `adapters/ui/InkUiPort.ts` — thin wrappers over `controller.request(...)`;
  a user "reject" throws `UserRejectedError` at the call site.
- `adapters/ui/UiHost.tsx` — the one long-lived component; renders the current
  request (`confirm`/`select`/`multiSelect`/`editText`/`editMultiline`/`stream`)
  and resolves on user action. `stream` consumes the async iterable and appends
  chunks live.
- `app.tsx` — `runInInk(fn)`: `render(<UiHost controller={c}/>)` once, run the
  flow alongside, return the flow's result.

**Gate:** manual smoke in a **real terminal** (spike open-note): prefilled
editable `TextInput` works, key-driven select works, streaming-append cadence is
smooth (batch tokens if it thrashes — architecture §6 risk #3).

---

## Phase 6 — Commit feature + fakes + e2e

- `test/fakes/` — `FakeUiPort` (scripts queued answers **and** records a
  transcript), `FakeVcs`, `FakeLlm` (yields scripted chunks), `FakeIssueTracker`,
  `FakeGitHost`, `fakeContext({...})`. Fakes can throw `PortError`/`AbortError`
  on demand for failure-path e2e.
- `features/commit/index.ts` — linear `run(ctx, args)` reading like spec §4
  (code-design §9):
  1. `hasStagedChanges()` else `AbortError("No staged changes")` (**#2**).
  2. `maybeFetchIssue(ctx)` — gated on `ctx.issues` + branch pattern (**#5, #6, #7**).
  3. `filterDiff(await stagedDiff(), config.diff.ignore)` (**#8**).
  4. `buildCommitPrompt(...)`.
  5. `generateValid(ctx, prompt)` — stream + `checkFormat` + up to N (≈3) retries,
     else abort + print violations (**#9**).
  6. `ui.select` accept / edit / reject (**#10**); edit → `ui.editText` prefilled,
     committed as-is, **no** re-check (**#12**); reject → `UserRejectedError` (**#11**).
  7. `vcs.commit(final)` (**#13**).
  8. `ui.confirm("Push?")` → `push({ setUpstream, branch })`, `-u origin <branch>`
     when no upstream (**#14**); remote reject surfaces verbatim (**#15**).
- Finish `buildContext` — wire real adapters; `issues` null when `jira.enabled === false`.
- Register `commit` (and `init`) in `core/registry.ts`.
- Feature e2e specs covering **all 15 acceptance rows** via fakes; assert on the
  returned `Result`, recorded port calls, and the UI transcript.

**Gate:** full acceptance matrix (#1–#15) green under `bun test`.

---

## Phase 7 — Entry point

- `src/index.tsx` — `cac("mole-tools")`; iterate `features`, register one command
  per feature, `applyZodOptions(cmd, f.args)` derives `--flags` from the schema.
  Command action:
  1. zod-parse the argv cac collected → typed `args` (validation error → print +
     non-zero exit),
  2. `loadConfig()`,
  3. `runInInk(async ui => f.run(buildContext({ config, ui }), args))`,
  4. route any throw through `handleError(e, ui)` → non-zero exit on every
     abort/guard.
- `cli.help(); cli.parse();`

**Gate:** `bun run src/index.tsx commit` drives the real flow end-to-end against
a scratch git repo (real git, real Ollama). Exit codes correct on abort paths.

---

## Phase 8 — Build binary + distribution

- **Build:** `bun build src/index.tsx --compile --target=bun-darwin-arm64 --outfile mole-tools`.
- **Standalone smoke:** copy the binary to a dir with **no** `node_modules`
  anywhere on the path; run `commit` and `init` (confirms spike gotcha stays
  fixed and no reliance on local modules).
- **`install.sh`** (curl-piped, architecture §5):
  1. resolve latest GitHub release asset (arm64 macOS),
  2. download → `chmod +x`,
  3. move to `/usr/local/bin/mole-tools` (sudo only if dir not user-writable;
     prompt clearly first),
  4. verify `/usr/local/bin` on PATH; warn + print export line if not,
  5. print installed version + `mole-tools init` hint.
- **README:** build, install, config (`~/.config/mole-tools/config.json`).

**Gate:** compiled `./mole-tools commit` runs the full flow standalone;
`install.sh` places it on PATH and `mole-tools --version` works.

---

## Testing summary (code-design §10)

| Tier | Where | How |
|------|-------|-----|
| Pure unit | `shared/`, `features/*/…` pure fns | input→output, no mocks (Phase 2) |
| Adapter unit | each `adapters/*` | real adapter, mocked `fetch`/`$` (Phase 4) |
| Feature e2e | whole `run()` | fake ports + scripted/recording `FakeUiPort` (Phase 6) |

Acceptance rows #1–#15 all land in an automated test by end of Phase 6; Phases 7–8
add real-integration and standalone-binary smoke checks.

### Coverage — first-class, enforced

- **Tests are a deliverable of every phase, not a follow-up.** No phase gate
  passes with its code untested — a phase is "done" only when its tests are
  written and green.
- **Threshold:** ≥90% line + function via `bunfig.toml` `coverageThreshold`
  (Phase 0). CI-less for now, so the threshold **is** the gate: `bun test`
  fails the run if coverage drops below it — every phase gate implicitly runs it.
- **Excluded** (justified, not lazy): `src/index.tsx` cac wiring (Phase 7
  integration exercises it) and `adapters/ui/UiHost.tsx` Ink render (Phase 5
  manual real-terminal smoke). Everything else — ports usage, pure fns,
  adapters, controller, feature flow — is inside the threshold.
- **Per-phase coverage owners:** Phase 2 pure fns → 100% (trivial); Phase 3
  loader → all branches (bootstrap / bad-key / valid); Phase 4 adapters → both
  success + each mapped failure; Phase 6 `run()` → every accept/edit/reject and
  gate branch.

---

## Out of scope (this plan)

Merge-request feature internals, GitHub/GitLab host logic, cross-platform builds,
CI release pipeline, Homebrew/npm publish, auto-update. Subcommand slot, cac
routing, and MR config keys are reserved but not implemented.
