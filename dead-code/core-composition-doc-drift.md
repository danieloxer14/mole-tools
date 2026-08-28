# Reconcile stale core composition and registry documentation

## Type
Stale documentation

## Scope
- Area: `Core application composition`
- Candidate paths: `specs/architecture/architecture.md`, `specs/architecture/code-design.md`, `specs/architecture/implementation-plan.md`, `specs/merge-request/merge-request-implementation-plan.md`, `specs/help-feature/help-feature.md`, `README.md`, `src/features/worktree-prune/index.ts`
- Symbols/config/docs: architecture status and composition examples; `features` registry; `Context`/`handleError` examples; `cost-breakdown`; worktree-prune registration comment; project quick-reference feature list

## Evidence
- `specs/architecture/architecture.md:3` says `Ideation / grilled. No implementation yet`, while `package.json:4,8-9` and `src/index.tsx:3-14,42-96` show the implemented CLI composition root.
- `specs/architecture/code-design.md:3` says `No implementation yet`; its registry example at `:137-142` contains only `[commit, mergeRequest]`, its context example at `:197-217` describes a stubbed/provider-switch composition, and its error example at `:304-307` renders `PortError.stderr ?? message`. Current `src/core/registry.ts:1-14` registers `commit`, `init`, `mergeRequest`, `worktreePrune`, and `reviewFeature`; `src/core/context.ts:134-162` constructs real VCS, GitLab, Jira, and LLM adapters; `src/core/errors.ts:18-27` renders `PortError.message`.
- `specs/architecture/implementation-plan.md:3,76-79` still describes a planned build with stubbed `buildContext` and an empty registry, despite `src/core/context.ts:134-163` and `src/core/registry.ts:8-14` being implemented.
- `specs/merge-request/merge-request-implementation-plan.md:29-33` says the registry exports `commit`, `init`, and `costBreakdown` and that context sets `gitHost: null`; its registration snippet at `:313-319` repeats `costBreakdown`. No `cost-breakdown` feature exists in `src/core/registry.ts`; `bun run src/index.tsx help` observed the five live commands, including `review`.
- `specs/help-feature/help-feature.md:205-225` still requires `cost-breakdown` and asserts a four-feature registry. The live help smoke test listed `commit`, `init`, `merge-request`, `worktree-prune`, and `review`.
- `README.md:419-427` quick reference lists `src/features/` as only `commit`, `merge-request`, `worktree-prune`, and `init`, omitting registered `review`, while the README review section documents the review feature.
- `src/features/worktree-prune/index.ts:176-177` says discovery/removal will be wired in later tickets, but the same module runs discovery and normal/force removal at `:62-173`, and `src/core/registry.ts:12` registers it.
- Inspections used LSP references for `buildContext`, `RoutingLlmProxy`, `ProviderLlmProxy`, and `features`; no dynamic production registry consumer was found. `bun test src/core/context.test.ts src/features/help/format.test.ts src/features/worktree-prune/index.test.ts` passed 32 tests; this verifies current composition-related behavior remains live.

## Why this is safe to change
These files are documentation, planning snapshots, or a stale source comment; none drives command registration or adapter wiring. Runtime behavior is sourced from `src/index.tsx`, `src/core/registry.ts`, `src/core/context.ts`, and `src/core/errors.ts`. Updating or explicitly archiving stale claims cannot remove a supported command. Keep historical design rationale only where it is labeled as historical and does not present obsolete examples as current contracts.

## Proposed change
1. Update or archive the architecture status/planning snapshots and replace obsolete registry, context, and error examples with current source-backed contracts.
2. Remove `cost-breakdown` and old four-entry registry assumptions from the merge-request and help-feature specifications; use `src/core/registry.ts` as the current command source of truth.
3. Add `review` to the README quick-reference feature list or explicitly label the list as abbreviated.
4. Update the worktree-prune registration comment so it describes completed discovery/removal behavior.
5. Re-run targeted core/help/worktree tests and the help smoke command after documentation edits; do not change production behavior as part of this cleanup.

## Acceptance criteria
- [ ] No current-status section claims core composition or feature registration is unimplemented.
- [ ] Registry/context/error examples match supported source behavior, including five registered commands and the current `PortError` display contract.
- [ ] No composition or help specification requires nonexistent `cost-breakdown` or omits a command while presenting the list as complete.
- [ ] README quick reference and worktree-prune comment describe current registered features and lifecycle.
- [ ] Targeted tests and `bun run src/index.tsx help` still prove supported composition and command output.

## Risks and open questions
- The architecture and implementation-plan files may be retained as historical records; choose archive-vs-rewrite deliberately and label retained snapshots so readers do not mistake them for current contracts.
- `PortError.stderr` may represent an intended future UX rather than accidental documentation drift; confirm desired error-display behavior before changing that example or code.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Re-ran every evidence item against current source. Status lines still stale: `specs/architecture/architecture.md:3` (`Ideation / grilled. No implementation yet.`), `code-design.md:3` (`Grilled / agreed. No implementation yet.`), `implementation-plan.md:3` (`Planned. No implementation yet.`). Examples still stale: registry `[commit, mergeRequest]` at `code-design.md:137-142` vs live 5-entry `src/core/registry.ts:8-13` (`commit, init, mergeRequest, worktreePrune, reviewFeature`); context `makeLlmRouter`/`makeGitHost` at `code-design.md:197-217` vs real `buildContext` `src/core/context.ts:134-162` (real `GitAdapter`/`Gl`abAdapter`/`JiraAdapter`/`RoutingLlmProxy`); error `e.stderr ?? e.message` at `code-design.md:307` vs live `src/core/errors.ts:25` (`e.message`). `implementation-plan.md:78-79` still shows stubbed `buildContext` + empty `features: Feature[] = []`. `merge-request-implementation-plan.md:31-32,318` still claim registry exports `costBreakdown` and `gitHost: null`. `help-feature.md:209-212,223-225` still require `cost-breakdown` + four-feature registry. `README.md:426` lists 4 features, omits `review`. `src/features/worktree-prune/index.ts:176-177` comment still says "discoveries/removal wired in later tickets" while `:62-173` runs discovery + normal/force removal. `bun run src/index.tsx help` lists 5 commands (commit, init, merge-request, worktree-prune, review); `grep -rn 'cost-breakdown\|costBreakdown' src` → no matches; `bun test src/core/context.test.ts src/features/help/format.test.ts src/features/worktree-prune/index.test.ts` → 32 pass / 0 fail.
- **Product impact:** `docs` — **Priority P4**
   - Every candidate path is a design/planning spec, README prose, or one source comment (`worktree-prune/index.ts:176-177`); none drives command registration, adapter wiring, config, or API shape. Runtime behavior is sourced from `src/index.tsx:42-47`, `src/core/registry.ts`, `src/core/context.ts`, `src/core/errors.ts`. Pure documentation drift, safe to defer.
- **Verification:**
   - Prove removal safe: `grep -rn 'cost-breakdown\|costBreakdown' src` (expect none — feature never existed); `grep -rn 'features\.\(push\|splice\|unshift\)\|\bfeatures\s*=[^=]\|registerFeature' src` (expect none — registry is a static array, no dynamic consumer); `grep -rn 'import\s*(' src` (expect only the test-fake import in `src/features/worktree-prune/index.test.ts`, no production dynamic import). The `features` export (`src/core/registry.ts:8`) is consumed only by `src/index.tsx:9,27,32,42` and test-local arrays — no external/untracked consumer.
   - Prove supported behavior still works: `bun test` green; `bun run src/index.tsx help` lists the 5 subcommands; `bun run src/index.tsx <commit|init|merge-request|worktree-prune|review> --help` each prints usage; confirm docs edits stay prose-only (acceptance criterion 5 — no production behavior change).
- **Removal risk:** None found for runtime — no dynamic loading/registration (registry is a static array), no external/untracked consumer of `features`, no public CLI option, config field, persisted state, API/network shape, or release/installer surface in the candidate paths. Two implementation-time policy caveats (not validity blockers, already in `Risks and open questions`): (1) `architecture.md` / `code-design.md` / `implementation-plan.md` are dated 2026-07-08 historical snapshots — decide archive-and-label vs in-place rewrite so history isn't destroyed; (2) `code-design.md:307` renders `PortError.stderr ?? message` while `src/core/errors.ts:25` renders `message` only, and the `stderr` field still exists (`errors.ts:8`) and may be intended future UX — confirm desired error-display direction before aligning the example.

## Removal process

- [x] Re-verified assessment before editing: LSP references found `buildContext` in `src/index.tsx` and `src/core/context.test.ts`, `RoutingLlmProxy`/`ProviderLlmProxy` only in `src/core/context.ts` and its tests, and `features` only in `src/index.tsx`; scoped searches found no runtime `cost-breakdown`/`costBreakdown`, dynamic registry mutation, or production dynamic import. Focused baseline `bun test src/core/context.test.ts src/features/help/format.test.ts src/features/worktree-prune/index.test.ts` passed 32 tests; `bun run build`, `bun run lint`, and `bun test` passed (441 tests).
- [x] Added temporary `test/dead-code/core-composition-doc-drift.test.ts`; `bun test test/dead-code/core-composition-doc-drift.test.ts` produced RED (`No implementation yet`), then GREEN (1 pass / 21 assertions) after edits; deleted temporary test before final validation.
- [x] Updated only `specs/architecture/architecture.md`, `specs/architecture/code-design.md`, `specs/architecture/implementation-plan.md`, `specs/merge-request/merge-request-implementation-plan.md`, `specs/help-feature/help-feature.md`, `README.md`, and the registration comment in `src/features/worktree-prune/index.ts`: live five-command registry, adapter-backed `buildContext`, `PortError.message` display, completed worktree lifecycle, and no current `costBreakdown`/`cost-breakdown` or `gitHost: null` claims.
- [x] No caller/import/config/schema/fixture migration was required: changes are prose/comment-only, with runtime registry, context, error implementation, CLI compatibility, and generated/runtime consumers unchanged.
- [x] Resolved `PortError.stderr` policy by retaining the field and adapter diagnostics while documenting live `ui.error(e.message)` behavior; `src/core/errors.ts` unchanged.
- [x] Retained behavior passed `bun test src/core/context.test.ts src/features/help/format.test.ts src/features/worktree-prune/index.test.ts` (32/0), `bun run src/index.tsx help` (all five tools), and each requested `--help` smoke command (commit, init, merge-request, worktree-prune, review printed usage).
- [x] Final validation passed: `bun test` 441/0, `bun run build` exit 0, `bun run lint` exit 0; scoped searches found no runtime or candidate-doc `cost-breakdown`/`costBreakdown`, no dynamic registry-loading consumer beyond the test-fake import, and no stale candidate claims. Temporary proof test deleted; retained focused tests rerun.
- [x] Compatibility, dynamic-loading, release, installer, and archival checks preserved: static registry, no external/untracked `features` consumer, no CLI/config/API/release/installer shape changes, and dated architecture/planning rationale explicitly labeled historical. Commit and push only this ticket's report, documentation, and comment change.
