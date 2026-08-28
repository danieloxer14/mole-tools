# Repair broken documentation cross-links

## Type
Stale documentation

## Scope
- Area: `Documentation and project configuration`
- Candidate paths: `specs/architecture/architecture.md`, `specs/architecture/code-design.md`, `specs/architecture/implementation-plan.md`, `specs/help-feature/help-feature.md`, `specs/help-feature/help-feature-implementation-plan.md`, `specs/merge-request/merge-request-tool.md`, `specs/merge-request/merge-request-implementation-plan.md`, `specs/explicit-model-routing/tickets/README.md`
- Symbols/config/docs: Markdown companion links and generated `Source spec` paths

## Evidence
- `specs/architecture/architecture.md:6,78` links to `./commit-tool.md`, but no `specs/architecture/commit-tool.md` exists; the target is `specs/commit/commit-tool.md`.
- `specs/architecture/implementation-plan.md:6-7,12,103` links to `../commit-tool.md`, but no `specs/commit-tool.md` exists; the target is `../commit/commit-tool.md`.
- `specs/architecture/code-design.md:6,480` links to `../commit-tool.md` and `../merge-request-tool.md`, but the existing targets are `../commit/commit-tool.md` and `../merge-request/merge-request-tool.md`.
- `specs/help-feature/help-feature.md:6` links to `../CONTEXT.md`, `../docs/adr/0001-registry-backed-plain-help.md`, and `architecture/code-design.md`; resolving from `specs/help-feature/` yields nonexistent paths. Existing targets are `../../CONTEXT.md`, `../../docs/adr/0001-registry-backed-plain-help.md`, and `../architecture/code-design.md`.
- `specs/help-feature/help-feature-implementation-plan.md:6-8` lists `CONTEXT.md`, `docs/adr/0001-registry-backed-plain-help.md`, and `specs/help-feature.md` as source documents; none exists at the document's location. The repository contains `../../CONTEXT.md`, `../../docs/adr/0001-registry-backed-plain-help.md`, and `help-feature.md`.
- `specs/merge-request/merge-request-tool.md:6,10,49` links to `./commit-tool.md` and `./architecture/architecture.md`, but the existing targets are `../commit/commit-tool.md` and `../architecture/architecture.md`.
- `specs/merge-request/merge-request-implementation-plan.md:5` repeats the same two invalid relative paths; both resolve one directory above their intended targets.
- `specs/explicit-model-routing/tickets/README.md:3` records `specs/explicit-model-routing.md` as its source spec, but that path does not exist; the actual source is `specs/explicit-model-routing/explicit-model-routing.md`.
- A repository-local path inspection over Markdown links and backticked project paths found these unresolved targets. The broken references are documentation-only; no source import, command registration, or runtime loader consumes them.

## Why this is safe to change
The candidate strings are navigation metadata in Markdown and generated ticket headers. Correcting them changes no application code, configuration parsing, CLI behavior, or persisted state. Existing files at the proposed targets were checked, and the package is private with no published documentation API to preserve.

## Proposed change
1. Correct each relative Markdown link to its existing companion document.
2. Correct generated `Source spec` and source-document paths to the actual nested locations.
3. Run a repository-local documentation-link check scoped to README.md, CONTEXT.md, specs/, and docs/adr/; leave user-repository search paths such as `docs/CODEOWNERS` untouched because they describe runtime discovery targets, not repository links.

## Acceptance criteria
- [ ] Every listed companion/source-document reference resolves to an existing repository file.
- [ ] No stale path variants remain in the affected documentation set.
- [ ] No application code, config schema, CLI behavior, or generated runtime artifact changes.
- [ ] Link verification reports no unresolved in-repository documentation targets in the scoped paths.

## Risks and open questions
- Some planning documents are intentionally historical; preserve their wording while correcting navigation unless the separate status-drift ticket decides to archive them.
- Confirm whether any external tooling parses the generated `Source spec` strings before changing their spelling; no repository consumer was found.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Re-scanned 49 scoped markdown files (README.md, CONTEXT.md, specs/, docs/adr/): 17 broken in-repo links, matching all six markdown-link claims — `architecture.md:6,78` (`./commit-tool.md` → `specs/architecture/commit-tool.md`, missing), `code-design.md:6,480` (`../commit-tool.md` + `../merge-request-tool.md` → `specs/` root, missing), `implementation-plan.md:7,12,103` (`../commit-tool.md` → `specs/commit-tool.md`, missing), `help-feature.md:6` (3 links → `specs/CONTEXT.md`, `specs/docs/adr/0001-…`, `specs/help-feature/architecture/code-design.md`, all missing), `merge-request-tool.md:6,10,49` + `merge-request-implementation-plan.md:5` (`./commit-tool.md` + `./architecture/architecture.md` → `specs/merge-request/…`, missing). Backticked source-path drift also re-confirmed: `help-feature-implementation-plan.md:6-8` and `explicit-model-routing/tickets/README.md:3` (`specs/explicit-model-routing.md` — the sole outlier; sibling ticket READMEs point to correct nested paths). All 7 proposed targets exist; all 9 broken variants absent (`test -f` / glob).
- **Product impact:** `docs` — **Priority P4**
   - Pure Markdown navigation metadata (companion/source-doc links + generated `Source spec` headers). No source import, CLI registration, config field, or runtime artifact touches specs/; `bun build src/index.tsx`, `bun test`, and `biome check` never read it. Safe to defer.
- **Verification:**
   - Proves fix safe: `bun run build && bun test && bun run lint` must pass unchanged (specs not imported/compiled/linted); `grep -rIn "Source spec\|commit-tool.md\|merge-request-tool.md" src scripts test` → no code consumer (only historical `.pi-subagents/artifacts/**` notes reference `Source spec`, none parse it).
   - Proves behavior after fix: re-run the link scan (python `glob` + `re` over the scoped roots, reporting unresolved in-repo links) and require 0 (current baseline: 17). Backticked source paths (claims 5, 8) have no link-checker coverage — verify by `test -f` on the corrected nested targets: `specs/explicit-model-routing/explicit-model-routing.md`, `../../CONTEXT.md`, `../../docs/adr/0001-registry-backed-plain-help.md`, `help-feature.md`.
- **Removal risk:** None found — no dynamic loading/registration (static docs); no external/untracked consumer (repo-wide `grep -rIn "Source spec"` finds only a historical subagent artifact, not a parser); no CLI/config/persisted-state/network surface; `scripts/release.ts` and `install.sh` do not reference specs/; no CI (no `.github`, no `.gitlab-ci.yml`). Two cautions, not blockers: (1) preserve intentional historical wording per the status-drift ticket; (2) confirm no external tooling parses `Source spec` before re-spelling — repo-wide grep found none.
- **Needs investigation:** 2026-08-28 — required baseline gate is not green: `bun test` exited 1 with 440 passing and one unrelated existing failure at `src/features/review/routes.test.ts:730` (`review routes > cancels one chat without stopping another`; expected `["d751840e-2c36-407e-afef-34e554215770"]`, received `undefined`). `bun run build` and `bun run lint` passed. Per loop rule 4, stop before adding a temporary proof test or changing documentation; rerun baseline after this failure is investigated.


## Removal process

- [x] Re-verified assessment before editing: scoped Markdown scan covered 49 files and found the recorded 17 unresolved links; all seven intended targets exist; all nine recorded broken path variants are absent. Searches of `src/`, `scripts/`, and `test/` found no `Source spec`, `commit-tool.md`, or `merge-request-tool.md` consumer. No source, config, CLI, generated-runtime, release, installer, dynamic-loading, or archival evidence changed.
- [x] Captured required baseline with `bun run build && bun run lint && bun test`: `bun run build` passed, `bun run lint` passed (`Checked 145 files`), and `bun test` failed with 440 passing / 1 failing at `src/features/review/routes.test.ts:730` (`review routes > cancels one chat without stopping another`; expected `["d751840e-2c36-407e-afef-34e554215770"]`, received `undefined`). This unrelated failure blocks removal.
- [ ] Needs investigation before removal: make full baseline `bun test` green without modifying this ticket's documented scope; no temporary proof test, source-document edit, retained-test edit, or removal commit was made in this iteration.
- [ ] Add temporary `test/dead-code/documentation-broken-cross-links.test.ts` only after baseline recovery. It must resolve every listed Markdown link and backticked `Source spec` path from its owning file, assert all seven intended targets exist, and run with `bun test test/dead-code/documentation-broken-cross-links.test.ts` to produce RED before repairs and GREEN after repairs.
- [ ] Correct only these documentation paths: `specs/architecture/architecture.md` `./commit-tool.md` → `../commit/commit-tool.md`; `specs/architecture/implementation-plan.md` `../commit-tool.md` → `../commit/commit-tool.md`; `specs/architecture/code-design.md` `../commit-tool.md`/`../merge-request-tool.md` → `../commit/commit-tool.md`/`../merge-request/merge-request-tool.md`; `specs/help-feature/help-feature.md` `../CONTEXT.md`, `../docs/adr/0001-registry-backed-plain-help.md`, and `architecture/code-design.md` → `../../CONTEXT.md`, `../../docs/adr/0001-registry-backed-plain-help.md`, and `../architecture/code-design.md`; `specs/merge-request/merge-request-tool.md` and `specs/merge-request/merge-request-implementation-plan.md` companion paths → `../commit/commit-tool.md` and `../architecture/architecture.md`.
- [ ] Correct generated `Source spec` paths only in `specs/help-feature/help-feature-implementation-plan.md` (`../../CONTEXT.md`, `../../docs/adr/0001-registry-backed-plain-help.md`, `help-feature.md`) and `specs/explicit-model-routing/tickets/README.md` (`../explicit-model-routing.md`). Preserve historical wording/status and do not alter imports, registrations, config/schema, fixtures, runtime artifacts, release scripts, or user-repository discovery paths.
- [ ] After repairs, rerun the scoped link scan and require zero unresolved targets; rerun `test -f` checks for `specs/commit/commit-tool.md`, `specs/merge-request/merge-request-tool.md`, `CONTEXT.md`, `docs/adr/0001-registry-backed-plain-help.md`, `specs/architecture/code-design.md`, `specs/help-feature/help-feature.md`, and `specs/explicit-model-routing/explicit-model-routing.md`; rerun `bun test test/dead-code/documentation-broken-cross-links.test.ts`.
- [ ] Retain supported behavior with `bun run build`, `bun run lint`, and `bun test`; delete the temporary proof test and rerun its retained focused tests. Exercise no CLI/UI/release surface because this ticket changes static Markdown only.
- [ ] Final validation and compatibility checks: `bun run build && bun run lint && bun test`, scoped link scan at zero, no code consumer of corrected paths, no dynamic/registration/config/API/persisted-state/release/installer consumer, and historical/archival wording preserved. Do not mark execution complete until baseline and final gates are green; then mark the execution entry with date, short SHA, and one-line outcome.
