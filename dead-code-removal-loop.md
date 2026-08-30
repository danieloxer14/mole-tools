# Dead-code removal loop

Remove one assessed dead-code ticket per iteration. Run eligible tickets from **P4 to P1**; within a priority, follow the order below. Priority comes from `dead-code-assess-loop.md`: it is the recorded product-impact and removal-risk ordering, not a claim that every P4 edit is risk-free.

This loop changes code and documentation. It is deliberately one-ticket, one-commit: do not combine unrelated removals, refactors, documentation corrections, or test cleanups.

## Prerequisite state

The assessed `dead-code/` reports and `dead-code-assess-loop.md` must be present on this branch before the first iteration. They are the source of truth for each candidate's scope, exact verification commands, and unresolved risks. Do not begin a removal from a report marked `invalid` or `needs-investigation`.

## Operating rules

1. Select first unchecked eligible ticket in the execution order. Perform **only it** in this iteration.
2. Read the whole ticket plus its `## Assessment`. Re-verify all recorded references, dynamic/registration paths, production entry points, configuration/CLI/API compatibility, generated/runtime consumers, and external-consumer risks before editing. If evidence has changed or a risk remains unresolved, mark `Needs investigation`, record exact missing evidence, and stop the iteration without removing code.
3. Add/update `## Removal process` in the ticket before removal. Preserve every existing section. Checklist must name:
   - exact symbols, files, aliases, exports, scripts, or document references to remove;
   - caller/import/config/schema/fixture/spec migrations required for a clean cutover;
   - temporary removal-proof test and its focused command;
   - retained behavior/regression test(s) and focused command(s);
   - build, lint, full-test, and surface smoke command(s);
   - compatibility, dynamic-loading, release, or archival checks from `## Assessment`.
4. Capture baseline: run ticket-specific inspections and focused tests from `## Assessment`, then `bun run build`, `bun run lint`, and `bun test`. Baseline must be green. Stop and record unrelated failures; never bury them in this ticket.
5. Red-green removal:
   - Add a **temporary removal-proof test** that fails while the identified obsolete symbol/file/script/reference exists, and run its focused test to observe RED. It may assert source structure only because its sole requested purpose is proving removal.
   - Add or strengthen **retained** behavior tests only when current coverage does not exercise an observable supported contract that the removal could regress. Run them before the removal to prove they pass on the baseline.
   - Remove every in-scope obsolete declaration, caller, test, fixture, spec/document reference, and now-obsolete import. Do not leave aliases, compatibility wrappers, deprecated exports, or dead test knobs.
   - Run temporary removal-proof and retained behavior tests. Both must be GREEN.
6. Re-run ticket-specific inspections, focused tests, `bun run build`, `bun run lint`, and `bun test`. Exercise every affected user-facing CLI, installer, release, or UI surface with the exact smoke command recorded in the ticket. Do not claim a surface was visually verified when it was not launched.
7. Delete the temporary removal-proof test. Keep only tests that defend observable supported behavior. Re-run every retained test after that cleanup.
8. Update ticket `## Removal process` with observed commands/results and mark its execution entry `[x]` as `YYYY-MM-DD — committed <short SHA> — <one-line outcome>`. Commit only this ticket's source, retained behavior tests, and its report. Push `dead-code-removal-loop` after the commit. Verify push result from Git output.
9. If removal becomes invalid, do not force it. Update `## Assessment` and mark the entry `Invalid — <reason>`; commit and push the report-only outcome in its own iteration.
10. Never run two checklist entries in one loop iteration. Re-running a completed entry refreshes proof/results in place; never duplicates sections.

## Execution order

### P4 — documentation drift

- [x] `dead-code/cli-specs-superseded-flags.md` — 2026-08-28 — committed fc2cfbf — flag-style `--commit`/`--merge-request` forms migrated to subcommands across 2 specs + 2 bug repros; 2 GRILL-ME records archival-marked; no source/parser/registry change.
  - Remove obsolete flag-form documentation only: two specs plus bugs/repro references. Preserve `GRILL-ME` historical material.
  - Re-check registered subcommands in `src/index.tsx` and `src/cli/registry.ts`; prove no flag parsing remains in `src/`.

- [x] `dead-code/core-composition-doc-drift.md` — 2026-08-28 — committed 8edcd8d — reconciled architecture, merge-request/help specs, README, and worktree-prune registration comment with live five-command registry/context/error behavior; preserved historical rationale and removed stale cost-breakdown claims.
- [x] `dead-code/documentation-broken-cross-links.md` — 2026-08-28 — committed da848fc — repaired 17 scoped Markdown links and 4 generated `Source spec` path drifts; temporary proof test red/green; final build, lint, full test, and link scan passed.
  - Repair 17 in-repo Markdown links in six files and two backticked source-path drifts.
  - Re-check all seven intended targets exist and all nine broken variants are absent; validate links after edit.
- [x] `dead-code/implemented-feature-spec-status-drift.md` — 2026-08-28 — committed e030014 — marked commit/context/help plans and tickets implemented; documented worktree lifecycle and CAC flag compatibility; preserved open UI items.
  - Update four specs, three tickets, and plan status to implemented behavior; remove dead Phase-2 `cost-breakdown` link.
  - Preserve documented `--base-dir` compatibility because CAC still accepts camel-cased option parsing.
- [x] `dead-code/logger-spec-implementation-drift.md` — 2026-08-28 — committed 9dd5863 — reconciled logger spec and ticket statuses with live logger foundation; preserved focused-test and instrumentation gaps; no runtime changes.
  - Bring logger spec and three ticket statuses current with live logger foundation and instrumentation boundary.
  - Do not add instrumentation or a logger test merely for status drift; preserve existing `logger.warn` behavior.
- [x] `dead-code/redundant-coverage-script.md` — 2026-08-28 — committed 52b7f11 — removed redundant `test:cov`; README now documents canonical coverage-enabled `bun test`; coverage behavior unchanged.
  - Remove `test:cov` only after confirming `bunfig.toml` still makes `bun test` collect coverage identically.
  - Coordinate decision with `ineffective-coverage-threshold-config`; search tracked/docs and release paths for script consumers; assess untracked alias risk explicitly.
- [x] `dead-code/review-comment-session-doc-drift.md` — 2026-08-28 — committed 4c2c977 — corrected ADR 0005 and `CONTEXT.md` to per-chat persistence, explicit legacy migration, and local user-authored comment drafts; runtime unchanged.
  - Correct ADR 0005 and `CONTEXT.md` to current per-chat state/store/chat and local-draft comment model.
  - Sweep ADR alternatives-considered row identified in assessment; do not change review runtime.
- [x] `dead-code/review-comment-status-spec-drift.md` — 2026-08-28 — committed c91d18b — documented `sending`, failure, and retained posted drafts with `postedDiscussionId` in API/lifecycle spec; runtime unchanged.
  - Document live `sending` status and replace two stale “replace the draft” descriptions.
  - Re-check state/routes/component status transitions; no runtime edit unless documentation evidence disproves assessment.
- [x] `dead-code/review-http-stream-header-doc-drift.md` — 2026-08-28 — committed aa30e7d — corrected request versus response `Content-Type`/`Accept` documentation; runtime headers and endpoints unchanged.
  - Correct spec distinction: request `Content-Type` versus response `Content-Type` and `Accept` headers.
  - Re-check chat, layer, comment-send, and SSE paths; preserve current runtime headers.
- [x] `dead-code/stale-config-prompt-specs.md` — 2026-08-28 — committed 5663808 — reconciled configuration, prompt, model-routing, and GitLab documentation with shipped behavior; runtime unchanged.
  - Remove/correct obsolete route, prompt, and Ralph-key documentation; update model/host references.
  - Label ADR material archival where appropriate. Preserve live legacy migration in loader/schema even though older docs contradict it.

### P3 — internal, test, or fixture code

- [x] `dead-code/gitlab-unused-schema-types.md` — 2026-08-28 — committed 4e90efd — removed four unconsumed inferred GitLab schema aliases; runtime schemas, shared position type, and GitLabDiscussion retained; focused 58/0, final full 445/0.
  - Remove four unused aliases in `glab-schemas.ts`; preserve live runtime schemas in `glab.ts` and `GitLabDiscussion` diagnostic.
  - Use LSP references before removal; run port/adapter/position tests.
- [x] `dead-code/ineffective-coverage-threshold-config.md` — 2026-08-28 — committed e960ec6 — corrected Bun coverage threshold keys to documented plural `lines`/`functions`, updated README enforcement wording, and proved low-coverage runs now fail; full suite remains below newly enforced 90% gate (84.91% funcs / 88.27% lines) as documented follow-up.
  - Replace or remove ignored singular coverage threshold keys only after choosing intended coverage policy with `redundant-coverage-script`.
  - Retain behavioral test proving intended Bun threshold enforcement; prove singular keys are no longer silently accepted.
- [ ] `dead-code/pi-no-op-generate-test.md` — Needs investigation — 2026-08-28 — no code changed; baseline blocked by enforced 90% coverage failures and unrelated review-route test failure, recorded in ticket.
  - Delete vacuous catch-all Pi generate test. Preserve `PiAdapter` wiring and LLM port contract coverage.
  - Keep/add only observable adapter/contract behavior tests.
- [ ] `dead-code/redundant-fake-vcs-contract-tests.md` — Needs investigation — 2026-08-28 — no code changed; baseline blocked by unrelated review-route failure at `src/features/review/routes.test.ts:730` and enforced 90% coverage gate (84.91% funcs / 88.27% lines), recorded in ticket.
  - Delete eight tests that test fake implementation mechanics, including obsolete `forceRemoveWorktreeError` knob if no retained behavior uses it.
  - Preserve compile-time `FakeVcs implements Vcs` and real Git/worktree-prune/review failure-path coverage.
- [ ] `dead-code/review-agent-generic-parser.md` — Needs investigation — 2026-08-28 — no code changed; baseline focused tests passed 26/0 but exited on 90% coverage (74.66% funcs / 84.79% lines), full suite passed 441/0 but exited on 90% coverage (84.91% funcs / 88.27% lines); build and lint passed, recorded in ticket.
  - Remove orphaned `parseAgentEvent` and private parser helpers plus parser-only tests.
  - Re-check all review-agent event consumers/imports; preserve live provider adapter/port behavior.
- [ ] `dead-code/review-ui-unused-helper-exports.md` — Needs investigation — 2026-08-28 — no code changed; baseline focused and full suites had 0 test failures but exited on enforced 90% coverage thresholds (focused 24.13% funcs / 48.64% lines; full 84.91% funcs / 88.27% lines); build and lint passed; exact missing evidence recorded in ticket.
  - Remove only exported `actionLabel` and `stateLabel` names from `ApprovalControls.tsx`; keep internal helper calls.
  - Use LSP references, then run affected UI tests.
- [ ] `dead-code/review-unused-compatibility-wrappers.md` — Needs investigation — 2026-08-28 — no code changed; focused suite 98/0 and full suite 441/0 both exited on enforced 90% coverage gate (63.83%/68.97% focused; 84.91%/88.27% full), recorded in ticket.
  - Remove all 14 declaration-only aliases across setup/paths/store/server/routes/SSE/chat/layers.
  - Migrate every in-repo consumer to canonical targets; use LSP references per exported alias; run review suite.
- [ ] `dead-code/review-unused-diff-helper.md` — Needs investigation — 2026-08-28 — no code changed; focused route/server tests 34/0 and DiffView test 1/0 had no test failures but exited on enforced 90% coverage (61.97%/68.36% and 6.44%/25.95%); full suite 441/0 exited on 84.91%/88.27% coverage; build and lint passed; exact missing evidence recorded in ticket.
  - Remove `isLargeDiff` and `countLines` from review routes; preserve independent UI collapse and `/api/state` threshold contract.
  - Run routes/server and `DiffView` coverage.
- [ ] `dead-code/root-cli-scaffold.md` — Needs investigation — 2026-08-28 — no code changed; baseline blocked by enforced 90% coverage gate (84.91% funcs / 88.27% lines), recorded in ticket.
  - Delete root `index.ts` Bun greeting scaffold. Preserve fake diff-data strings that happen to contain its path.
  - Smoke-test supported CLI `help` and `--version`; prove module/dev/build/release/install paths use `src/index.tsx`.
- [x] `dead-code/shared-line-code-export.md` — 2026-08-30 — committed 1cdc438 — removed five unconsumed shared export modifiers; retained position, diff-parser, and format APIs; focused tests 55/0, 171/0, 31/0; build/lint passed; full 445/0 with existing 84.91% funcs / 88.27% lines coverage-gate exit.
  - Remove five unused exports while retaining their live internal APIs; migrate `lineCode` test to public/needed behavior rather than exported access.
  - Use LSP references and run shared, port, adapter, and feature tests.
- [x] `dead-code/vcs-unused-unstaged-check.md` — 2026-08-30 — committed 5fca4e3 — removed unused `hasUnstagedChanges` VCS port/adapter/fake/test hook and stale implementation-plan references; retained merge-base diff behavior and unstaged-change exclusion.
  - Remove dead `hasUnstagedChanges` VCS port slot, Git implementation, FakeVcs implementation, inert test override, and stale dead-spec scenarios.
  - Preserve live behavior documentation references and resolve archival decision for stale spec before editing.

### P2 — build, release, configuration, or UI contract code

- [ ] `dead-code/review-duplicate-http-token-transport.md`
  - Remove client-side query-token transport from all 19 review UI fetch calls, retaining header authentication.
  - Preserve server query-token authorization and startup URL handling because they serve distinct paths. Run route/server/comment tests and authenticated UI smoke path.
- [ ] `dead-code/review-ui-duplicate-column-constants.md`
  - Consolidate runtime responsive width/breakpoint constants under one source while preserving CSS fallback paint before app mount.
  - Validate resize and breakpoint behavior at desktop and narrow widths; run existing UI tests plus actual review UI smoke.
- [ ] `dead-code/release-installer-asset-drift.md` — **Invalid; do not remove.**
  - Re-check published release asset name against `install.sh`; current evidence says `mole-tools` is correct and `#mole-tools-darwin-arm64` is only GitHub CLI display label.
  - Report-only closure. Any asset rename/alias would break installation.

### P1 — live runtime duplicate code

- [ ] `dead-code/review-agent-adapter-duplication.md`
  - Extract the six genuinely identical private adapter helpers shared by `omp.ts` and `claude.ts`; migrate both adapters without changing provider-specific auth recovery, nested `result`, or cancellation handling.
  - Run adapter/port tests and review-agent user path smoke.
- [ ] `dead-code/vcs-duplicate-commits-ahead-log.md`
  - Replace `commitsAhead` caller with canonical `log({ base })`; remove obsolete port/adapter method and migrate three specs.
  - Add retained coverage for empty-abort and no-count adapter behavior; update Git test argument ordering.
- [ ] `dead-code/vcs-duplicate-repo-root-lookup.md`
  - Cache/reuse one `repoRoot()` result for duplicate calls at merge-request `index.ts` lines 138/144 only; leave reviewers call out of scope.
  - Add call-count capability to FakeVcs only if needed to prove one lookup, then retain a behavior-level guard for dynamic-environment branch.
- [ ] `dead-code/vcs-duplicate-reviewer-history.md`
  - Compute `touchAuthorsForFiles(files, 200)` and `recentAuthors(100)` once, reuse in no-CODEOWNERS fallback, and preserve ranking input/order semantics.
  - Add retained call-count/result-equivalence coverage because current FakeVcs returns no authors; smoke-test reviewer selection MR path.

## Completion rule

Stop when every entry is `[x]`, `Needs investigation`, or `Invalid`. Final report must list ticket outcomes, commits/pushes, retained regression coverage, baseline/final build-lint-test results, and every unresolved risk with exact evidence still needed. Do not declare a P2/P1 removal complete without its recorded runtime smoke result.
