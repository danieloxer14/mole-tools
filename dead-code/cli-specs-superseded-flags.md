# Replace superseded flag-style CLI invocations in specs

## Type
Stale documentation

## Scope
- Area: `CLI composition and startup`
- Candidate paths: `specs/commit/commit-tool.md`, `specs/merge-request/merge-request-tool.md`
- Symbols/config/docs: `mole-tools --commit`, `mole-tools --merge-request`, and merge-request `--commit` detour references

## Evidence
- `specs/commit/commit-tool.md:44`, `:85`, and `:161` describe `mole-tools --commit`.
- `specs/merge-request/merge-request-tool.md:41`, `:73-74`, `:120`, `:200`, and `:236` describe `mole-tools --merge-request` or invoke a `--commit` flow.
- `specs/architecture/code-design.md:147-150` explicitly decides on subcommands and says this supersedes `--commit` / `--merge-request` phrasing in the tool specs.
- `src/index.tsx:42-47` registers commands from feature names; `src/core/registry.ts:8-14` registers `commit`, `init`, `merge-request`, `worktree-prune`, and `review`, with no flag-style command registration.
- `README.md` current command examples use `mole-tools commit` and `mole-tools merge-request`; `bun run src/index.tsx --help` prints those subcommands.
- `bun run src/index.tsx help` printed the five registered tools and did not advertise either superseded flag form.

## Why this is safe to change
The source command contract and accepted architecture decision both use subcommands. The flag-style invocations have no registered production path and are contradicted by the current user-facing README. Updating these historical specs removes conflicting instructions without changing application behavior.

## Proposed change
1. Replace `mole-tools --commit` with `mole-tools commit` throughout `specs/commit/commit-tool.md`.
2. Replace `mole-tools --merge-request` with `mole-tools merge-request` and the internal `--commit` flow wording with the actual `commit` feature invocation/flow throughout `specs/merge-request/merge-request-tool.md`.
3. Update nearby status/scope prose so these specs no longer present superseded invocations as current commands; retain historical rationale only where clearly labelled.
4. Search all specs and docs for the old forms and either migrate or explicitly mark archival references.

## Acceptance criteria
- [ ] No current-looking CLI example or invocation instruction in the two specs uses `mole-tools --commit` or `mole-tools --merge-request`.
- [ ] Merge-request staged-change documentation names the supported commit subcommand/flow without implying an unregistered flag.
- [ ] Documentation command names match `src/core/registry.ts` and `bun run src/index.tsx --help`.
- [ ] No supported CLI behavior or parser code changes as part of the documentation cleanup.

## Risks and open questions
- Both files declare historical `Ideation / product-grilled` or similar status; decide whether to update them in place or mark them archival before rewriting broad sections. Search for external links or release notes that intentionally preserve the old terminology.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Re-ran evidence: flag forms still present at `specs/commit/commit-tool.md:44,85,161` and `specs/merge-request/merge-request-tool.md:41,73-74,120,200,236`; `specs/architecture/code-design.md:147-150` supersedes them with subcommands; `bun run src/index.tsx --help` lists 5 subcommands (`commit init merge-request worktree-prune review`), no flag form; `grep -rn -- '--commit\|--merge-request' src` → no matches (no flag parsing in source).
- **Product impact:** `docs` — **Priority P4**
   - Superseded invocations live only in spec prose; the registered contract (subcommands via `src/index.tsx:42-47` + `src/core/registry.ts:8-14`), README (`README.md:219,240`), and `--help`/`help` output already use subcommands. No runtime, config, or contract surface touched.
- **Verification:**
   - Prove removal safe: `grep -rn -- '--commit\|--merge-request' src` (expect no matches — source has no flag parsing); `bun run src/index.tsx --help` and `bun run src/index.tsx help` list the 5 subcommands with no flag form; `specs/architecture/code-design.md:147-150` records the supersession decision.
   - Prove supported behavior still works: `bun test` green; `bun run src/index.tsx commit --help` and `bun run src/index.tsx merge-request --help` still print subcommand usage; parser/registry unchanged (acceptance criterion 4 — no CLI behavior change).
- **Removal risk:** None found for the two in-scope specs — prose-only, no dynamic loading/registration, no external consumer of the string, no config field, no release/installer/API path. Scoping caveat: the flag forms also appear outside the ticket's 2-file scope — current-looking repro steps in `specs/bugs/01-concurrent-async-spinners.md:47` and `specs/bugs/02-reviewer-multi-select-missing.md:55` (migrate to subcommands), and historical decision records in `specs/merge-request/GRILL-ME-merge-commit.md:95,103` and `specs/worktree-prune/GRILL-ME-worktree-prune.md:95,103` (retain or mark archival, do not rewrite). Proposed-change step 4 ("search all specs/docs") must be scoped to avoid rewriting historical grill records.

## Removal process

- [x] Add temporary `test/dead-code/cli-specs-superseded-flags.test.ts` asserting that `specs/commit/commit-tool.md` contains no current-looking `mole-tools --commit` invocation and `specs/merge-request/merge-request-tool.md` contains no current-looking `mole-tools --merge-request` or flag-style commit detour; run `bun test test/dead-code/cli-specs-superseded-flags.test.ts` before edits and record RED, then rerun the same command after edits for GREEN, and delete this temporary test before the final diff. — **observed:** `bun test test/dead-code/cli-specs-superseded-flags.test.ts` → RED `2 fail` (both in-scope specs still carried the flag forms) → GREEN `2 pass` after migration; temp test deleted before the final diff.
- [x] In `specs/commit/commit-tool.md`, migrate every current command example and instruction `mole-tools --commit` to `mole-tools commit`; in `specs/merge-request/merge-request-tool.md`, migrate `mole-tools --merge-request` to `mole-tools merge-request` and describe staged-change commit flow with the `commit` subcommand, updating nearby current-status/scope prose without touching parser or registry code. — **observed:** `commit-tool.md` L44/85/161 → `mole-tools commit`; `merge-request-tool.md` L10/41/74/120/200/236 → `mole-tools merge-request` / `commit` flow; `git diff --stat` shows zero `src/` changes (parser + registry untouched).
- [x] Search the documentation set for `--commit` and `--merge-request`; migrate current-looking bug repro steps in `specs/bugs/01-concurrent-async-spinners.md` and `specs/bugs/02-reviewer-multi-select-missing.md`, while retaining `specs/merge-request/GRILL-ME-merge-commit.md` and `specs/worktree-prune/GRILL-ME-worktree-prune.md` references only as explicitly archival historical records. — **observed:** bug repros migrated at `specs/merge-request/bugs/01-concurrent-async-spinners.md:47` + `02-reviewer-multi-select-missing.md:55` (assessment's `specs/bugs/` path was off; real path is `specs/merge-request/bugs/`); both GRILL-ME files gained an explicit `> **Archival decision record.**` marker above Q9, flag forms retained but now labelled; `specs/architecture/code-design.md:148` supersession record left intact.
- [x] Retain supported CLI behavior with `bun run src/index.tsx --help`, `bun run src/index.tsx help`, `bun run src/index.tsx commit --help`, and `bun run src/index.tsx merge-request --help`; confirm output names subcommands and no production source file changed. — **observed:** `--help`/`help` list the 5 subcommands (commit/init/merge-request/worktree-prune/review) with no `--commit`/`--merge-request` form; `commit --help` + `merge-request --help` print subcommand usage; `git diff --stat` shows zero `src/` changes.
- [x] Run final validation with `bun test` plus the four help commands above, and run a scoped search proving the two in-scope specs have no stale flag invocations while any intentionally archival grill records remain labeled. — **observed:** `bun run build` EXIT 0, `bun run lint` EXIT 0, `bun test` 441 pass / 0 fail; scoped `grep -- '--commit\|--merge-request'` clean in the 2 in-scope specs + 2 bug specs; forms remain only in the 2 GRILL-ME files (archival-labelled) + `code-design.md:148`.
- [x] Preserve assessment caveats: source has no flag parser or dynamic registration, so do not add compatibility flags; keep external-link/release-note history and the out-of-scope archival grill references intact unless separately approved. — **observed:** no compatibility flags added (source has no flag parser, confirmed `grep -rn -- '--commit\|--merge-request' src` → none); external-link/release-note history untouched; out-of-scope GRILL-ME references retained + labelled; no config/CLI/API surface changed.
