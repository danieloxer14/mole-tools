# mole-tools — Merge-Request Implementation Spec

**Status:** Draft implementation plan  
**Date:** 2026-07-11  
**Companions:** [merge-request-tool.md](./merge-request-tool.md), [commit-tool.md](./commit-tool.md), [architecture/architecture.md](./architecture/architecture.md)

This document turns the product spec in `merge-request-tool.md` into a repo-grounded implementation plan for `mole-tools`.

---

## 1. Goal

Implement a GitLab-only `merge-request` feature that opens an MR from the current branch using local Ollama generation for the MR title/body, existing git/Jira infrastructure, and `glab` for GitLab operations.

The implementation should preserve the product spec's stance:

- fail fast;
- do not auto-recover from rejected pushes or dirty unstaged trees;
- keep content generation owned by the MR prompt;
- keep structure/flow owned by the tool;
- implement reviewer suggestions as the one deliberately heavier piece of repo intelligence.

---

## 2. Current repo context

Relevant existing files:

| File | Current role |
|------|--------------|
| `src/core/registry.ts` | Registers CLI features. Currently exports `commit`, `init`, `costBreakdown`. |
| `src/core/context.ts` | Builds shared `Context`; currently sets `gitHost: null`. |
| `src/core/feature.ts` | Feature interface used by all commands. |
| `src/features/commit/index.ts` | Best implementation template for staged diff, Jira fetch, Ollama streaming, format retry, accept/edit/reject, and commit creation. |
| `src/features/commit/prompt.ts` | Pattern for rendering issue + diff context into an LLM prompt. |
| `src/adapters/vcs/git.ts` | Existing Git adapter. Has branch, default branch, staged diff, commit, push, commits-ahead, range diff, log. |
| `src/ports/vcs.ts` | Current VCS interface. Needs expansion for MR-specific state. |
| `src/ports/git-host.ts` | Existing Git host port. Needs either expansion or a `glab` adapter matching current shape plus preflight support. |
| `src/adapters/config/schema.ts` | Config schema already includes `ollama.mrModel?`, `dynamicEnvRepos?`, `autoReviewer?`; missing `mrSystemPrompt`/prompt decision and `dynamicEnvScript`. |
| `src/shared/diff.ts` | Existing noise filtering. Reuse for MR diff. |
| `src/shared/format.ts` | Existing conventional-commit title validation. Reuse for generated MR title. |
| `src/ports/ui.ts` | Has `select`, `multiSelect`, `editText`, `editMultiline`, `confirm`, and stream support. |

Validation commands:

```sh
bun test
bun run lint
bun run build
```

---

## 3. Target user flow

The implemented feature should follow the product spec order:

1. Preflight `glab` installed and authenticated.
2. Resolve current branch and default branch.
3. Abort if current branch is default branch.
4. If an open MR already exists for the branch, print URL and exit successfully.
5. Handle pending changes:
   - staged changes: run the commit flow as a sub-step, then resume;
   - dirty unstaged-only tree: abort with `Unstaged changes — stage them first`;
   - clean tree: continue.
6. Push branch:
   - no upstream: `git push -u origin <branch>`;
   - upstream exists and local is ahead: `git push`;
   - push error: print git stderr verbatim and abort.
7. Determine base branch from `origin` default.
8. Abort if no commits ahead of base.
9. Optionally fetch Jira context when enabled and branch matches configured pattern.
10. Collect commits and `origin/<base>...HEAD` diff, applying `diff.ignore` as stat-only filtering.
11. Generate title/body with Ollama `ollama.mrModel`.
12. Validate generated title only; retry up to 3 times; body is free-form.
13. Present candidate title/body: accept, edit, reject.
14. Suggest reviewers from CODEOWNERS + touch-score analysis.
15. Optionally add `autoReviewer.username`.
16. Resolve self as assignee if possible.
17. Show final summary and draft toggle.
18. Run `glab mr create`.
19. If configured, offer dynamic-env script handoff after successful MR creation.

---

## 4. Implementation phases

### Phase 1 — VCS and GitLab foundations

#### 1.1 Expand `Vcs` port

File: `src/ports/vcs.ts`

Add MR-specific capabilities. Suggested shape:

```ts
export interface TouchAuthor {
  author: string;
  count: number;
}

export interface Vcs {
  currentBranch(): Promise<string>;
  defaultBranch(): Promise<string>;
  hasStagedChanges(): Promise<boolean>;
  hasUnstagedChanges(): Promise<boolean>;
  stagedDiff(): Promise<FileDiff[]>;
  commit(message: string): Promise<{ sha: string }>;
  push(opts: { setUpstream: boolean; branch: string }): Promise<void>;
  hasUpstream(branch: string): Promise<boolean>;
  isAheadOfUpstream(branch: string): Promise<boolean>;
  commitsAhead(base: string): Promise<CommitMeta[]>;
  mergeBaseDiff(base: string): Promise<FileDiff[]>;
  changedFiles(base: string): Promise<string[]>;
  touchAuthorsForFiles(files: string[], maxCount: number): Promise<TouchAuthor[]>;
  recentAuthors(maxCount: number): Promise<string[]>;
  repoRoot(): Promise<string>;
  log(opts: LogQuery): Promise<CommitMeta[]>;
}
```

Notes:

- Keep existing `rangeDiff(base)` behavior stable unless all callers are updated.
- Add `mergeBaseDiff(base)` for the MR-required `origin/<base>...HEAD` triple-dot range.
- `changedFiles(base)` should use `git diff origin/<base>...HEAD --diff-filter=M --name-only` for reviewer scoring.

#### 1.2 Update `GitAdapter`

File: `src/adapters/vcs/git.ts`

Implement new methods using Bun-friendly git execution:

- `hasUnstagedChanges`: `git diff --quiet` returns `1` when dirty.
- `hasUpstream`: `git rev-parse --abbrev-ref <branch>@{upstream}`.
- `isAheadOfUpstream`: `git rev-list --count @{upstream}..HEAD`.
- `mergeBaseDiff`: `git diff origin/<base>...HEAD --numstat` and `git diff origin/<base>...HEAD`.
- `changedFiles`: `git diff origin/<base>...HEAD --diff-filter=M --name-only`.
- `repoRoot`: `git rev-parse --show-toplevel`.
- `touchAuthorsForFiles`: `git log --max-count=<n> --name-only --format=... -- <files...>` and tally authors against touched files.
- `recentAuthors`: `git log --max-count=<n> --format=%an` preserving recency and de-duplicating.

#### 1.3 Implement `glab` adapter

New file: `src/adapters/git-host/glab.ts`

Backed by `src/ports/git-host.ts`.

Needed behavior:

- `preflight()` or equivalent:
  - `glab --version`;
  - `glab auth status`.
- `currentUser()`:
  - `glab api /user`;
  - return `null` on lookup failure for assignee behavior.
- `findOpenMr(sourceBranch)`:
  - `glab mr list --source-branch <branch>` with JSON output if available;
  - return first open MR URL or `null`.
- `resolveHandle(handle)`:
  - if handle includes `/`, treat as group and resolve members through `/groups/<encoded>/members`, including pagination if needed;
  - otherwise resolve user through `/users?username=<handle>`.
- `createMr(input)`:
  - run `glab mr create --title <t> --description <body>`;
  - pass one `--assignee` for self when available;
  - pass one `--reviewer` per selected reviewer;
  - pass `--draft` when requested;
  - do not pass `--target-branch` in v1.

The current `CreateMrInput` has `targetBranch` and `reviewerIds`; update as needed to match the product spec. A likely shape:

```ts
export interface CreateMrInput {
  sourceBranch: string;
  title: string;
  description: string;
  draft: boolean;
  assignee?: string;
  reviewers: string[];
}
```

Use `PortError` with original stderr so failures print verbatim.

#### 1.4 Wire context

File: `src/core/context.ts`

Set `gitHost` to the GitLab adapter:

```ts
gitHost: new GlabAdapter(costTracker)
```

or use a small provider check if future config introduces GitHub.

---

### Phase 2 — Config and prompts

#### 2.1 Update config schema

File: `src/adapters/config/schema.ts`

Needed keys:

- `ollama.mrModel`: required for MR feature or validated at feature runtime.
- `mrSystemPrompt`: decide whether this is config-backed per product spec.
- `dynamicEnvScript`: optional string, defaulting to `hack/local/dynamic-env.sh`.

Suggested minimal schema addition:

```ts
mrSystemPrompt: z.string().optional(),
dynamicEnvScript: z.string().optional(),
```

If `mrSystemPrompt` remains file-backed to match `commit`, create a default prompt file and document that decision.

#### 2.2 Update config template

File: `src/adapters/config/loader.ts`

Ensure generated config includes MR defaults:

- `ollama.mrModel`;
- `dynamicEnvRepos: []`;
- `dynamicEnvScript: "hack/local/dynamic-env.sh"`;
- commented or empty `autoReviewer.username` pattern if appropriate.

---

### Phase 3 — Commit flow refactor

The MR flow needs to reuse commit behavior when staged changes exist, but the current commit feature asks `Push?` after creating the commit. MR flow must own pushing.

File: `src/features/commit/index.ts`

Refactor around an internal helper:

```ts
export async function runCommitFlow(
  ctx: Context,
  opts: { askToPush: boolean } = { askToPush: true },
): Promise<CommitResult>;
```

Then:

- existing `commit.run` calls `runCommitFlow(ctx, { askToPush: true })`;
- MR flow calls `runCommitFlow(ctx, { askToPush: false })`.

Keep current commit UX unchanged.

---

### Phase 4 — MR prompt and generation

#### 4.1 Prompt builder

New file: `src/features/merge-request/prompt.ts`

Build prompt from:

- MR system prompt;
- optional Jira issue;
- commit messages from `base..HEAD`;
- filtered diff from `origin/<base>...HEAD`.

Include an explicit output contract, such as:

```text
Return the merge request as:
Title: <single-line conventional title>

<body markdown>
```

#### 4.2 Parser

Add parser near prompt/generator code:

```ts
export interface GeneratedMr {
  title: string;
  body: string;
}

export function parseGeneratedMr(text: string): GeneratedMr;
```

Keep parsing deterministic. If model omits `Title:`, consider first non-empty line as title and remaining lines as body.

#### 4.3 Generation retry

New file option: `src/features/merge-request/generate.ts`

Behavior:

- stream via `ctx.ui.stream(ctx.llm.generate(...), "Generating merge request")`;
- parse into title/body;
- validate title with `checkFormat(title)`;
- retry up to 3 attempts;
- after final failure, throw `AbortError` with violations;
- never validate body.

---

### Phase 5 — Core feature

New file: `src/features/merge-request/index.ts`

Register in `src/core/registry.ts`:

```ts
import { mergeRequest } from "../features/merge-request";

export const features: Feature[] = [commit, init, costBreakdown, mergeRequest];
```

Suggested core structure:

```ts
export const mergeRequest: Feature<typeof args> = {
  name: "merge-request",
  description: "Create a GitLab merge request for the current branch",
  args,
  async run(ctx) {
    // ordered flow from section 3
  },
};
```

Implementation details:

- Guard if `ctx.gitHost` is null.
- Preflight before git/LLM work.
- Existing MR guard must happen before generation.
- If `ctx.vcs.hasStagedChanges()`, invoke `runCommitFlow(ctx, { askToPush: false })`.
- If no staged changes but unstaged changes exist, abort.
- Push before generation.
- Use `ctx.vcs.defaultBranch()` for base.
- Use `ctx.vcs.commitsAhead(base)` for nothing-to-merge guard.
- Use same Jira branch matching logic as commit; consider extracting shared helper later.
- Use `filterDiff(await ctx.vcs.mergeBaseDiff(base), ctx.config.diff.ignore)`.
- Present candidate with `select` over accept/edit/reject.
- For edit, use `editMultiline`; edited title/body are trusted as-is.

---

### Phase 6 — Reviewer suggestions

New file: `src/features/merge-request/reviewers.ts`

Responsibilities:

1. Find CODEOWNERS:
   - likely paths: `CODEOWNERS`, `.github/CODEOWNERS`, `.gitlab/CODEOWNERS`, `docs/CODEOWNERS`;
   - product spec allows searching a few levels deep.
2. Extract `@handle` tokens.
3. Resolve each handle through `ctx.gitHost.resolveHandle`.
4. Compute touch scores:
   - changed files from `ctx.vcs.changedFiles(base)`;
   - author counts from `touchAuthorsForFiles(files, 200)`.
5. Match git authors to GitLab members using tiered rules:
   - exact;
   - first-initial;
   - last-initial;
   - prefix;
   - first rule wins.
6. Fallback pool:
   - recent repo authors from `recentAuthors(100)`;
   - remaining raw CODEOWNERS members to pad.
7. Return top 4, excluding current user.

Suggested output:

```ts
export interface ReviewerSuggestion {
  handle: string;
  displayName: string;
  commits: number;
  source: "touch" | "recent" | "codeowners";
}
```

UI behavior:

- If no CODEOWNERS or no resolved members: skip reviewer step.
- Otherwise use `ctx.ui.multiSelect`.
- Current UI has no free-text multi-select; after suggestions, ask:
  - `Add manual reviewer handles?`
  - if yes, `editText("Reviewer handles", "")`, accepting comma/space-separated handles.

---

### Phase 7 — Auto-reviewer and assignee

- Assignee:
  - call `ctx.gitHost.currentUser()`;
  - if it succeeds, pass self as `--assignee`;
  - if it fails, continue without assignee.
- Auto-reviewer:
  - only if `ctx.config.autoReviewer?.username` is set;
  - ask y/n;
  - yes adds the configured handle to reviewers;
  - do not make it assignee.

Deduplicate reviewers before MR creation.

---

### Phase 8 — Final summary and MR creation

Before create, show:

- title;
- body;
- assignee or `(none)`;
- reviewers or `(none)`.

Ask:

1. `Create as draft?`
2. `Create merge request?`

On confirm, call `ctx.gitHost.createMr(...)`.

On success, print URL. On failure, let `PortError` preserve `glab` stderr and exit non-zero through existing error handling.

---

### Phase 9 — Dynamic environment handoff

After successful MR creation only:

1. Get repo root/name.
2. If repo is not in `dynamicEnvRepos`, do nothing.
3. If repo is listed, ask whether to run dynamic env script.
4. Script path = `ctx.config.dynamicEnvScript ?? "hack/local/dynamic-env.sh"`.
5. If missing, warn and skip.
6. If present, run with inherited TTY so the script owns all prompts.

This step must not alter MR creation success if the script is missing.

---

## 5. Test plan

### 5.1 Feature tests

New file: `src/features/merge-request/index.test.ts`

Cover:

- `glab` missing/unauthenticated aborts before git/LLM work.
- current branch equals default branch → abort message.
- existing open MR → URL printed, no generation.
- staged changes → commit helper called, then MR flow resumes.
- unstaged-only dirty tree → abort, no `git add`.
- no upstream → push with `setUpstream: true`.
- ahead of upstream → push.
- push failure propagates stderr.
- no commits ahead → `Nothing to merge`.
- Jira enabled + branch match + fetch failure aborts.
- Jira disabled/no match proceeds.
- generated invalid title retries up to 3.
- body is not format-checked.
- edit path does not re-check title.
- reject path exits without MR.
- final draft toggle maps to `draft: true`.
- MR create called with assignee/reviewers.
- dynamic-env prompt only after successful MR and configured repo.

### 5.2 Prompt/generation tests

Files:

- `src/features/merge-request/prompt.test.ts`
- `src/features/merge-request/generate.test.ts`

Cover:

- prompt includes Jira, commits, and diff;
- ignored files render stat-only;
- parser extracts title/body;
- retry loop reports final violations.

### 5.3 Reviewer tests

File: `src/features/merge-request/reviewers.test.ts`

Cover:

- CODEOWNERS discovery and handle extraction;
- group vs user handle resolution;
- touch-score ordering;
- current user exclusion;
- fallback ordering;
- no CODEOWNERS / no resolved members skips suggestions.

### 5.4 Adapter tests

Files:

- `src/adapters/git-host/glab.test.ts`
- `src/adapters/vcs/git.test.ts`

Cover command construction and parsing for:

- `glab auth status`;
- `glab api /user`;
- `glab mr list --source-branch`;
- user/group resolution;
- `glab mr create` flags;
- upstream detection;
- ahead detection;
- triple-dot diff;
- changed-file collection.

---

## 6. Acceptance mapping

| Product AC | Implementation location |
|------------|--------------------------|
| 1 glab preflight | `GlabAdapter.preflight`, MR feature first step |
| 2 default branch guard | `merge-request/index.ts` |
| 3 existing MR guard | `GitHost.findOpenMr` + feature guard |
| 4 staged changes commit detour | `runCommitFlow(ctx, { askToPush: false })` |
| 5 unstaged abort | `Vcs.hasUnstagedChanges` + feature guard |
| 6 no upstream push | `Vcs.hasUpstream` + `push({ setUpstream: true })` |
| 7 local ahead push | `Vcs.isAheadOfUpstream` + `push` |
| 8 rejected push | `GitAdapter.push` preserves stderr in `PortError` |
| 9 nothing to merge | `Vcs.commitsAhead(base)` guard |
| 10–11 Jira behavior | shared/extracted commit-style Jira helper |
| 12 diff ignore | `filterDiff` over `mergeBaseDiff` |
| 13 Ollama errors | existing `OllamaAdapter` |
| 14 title validation retries | MR generation module + `checkFormat` |
| 15 body free-form | parser/generator only validates title |
| 16–18 candidate UX | feature select/edit/reject block |
| 19–20 reviewers | `reviewers.ts` |
| 21–22 assignee | `GitHost.currentUser` optional path |
| 23–24 auto-reviewer | feature config-gated prompt |
| 25–28 final/create | feature summary + `GitHost.createMr` |
| 29–31 dynamic env | post-create dynamic-env block |

---

## 7. Risks and decisions

### Risks

- `CODEOWNERS` parsing and GitLab group resolution can become complex. Keep this isolated in `reviewers.ts`.
- Current `UiPort` lacks a combined multi-select/free-text control. Use a follow-up manual-entry prompt.
- `rangeDiff(base)` currently uses a double-dot range. Avoid semantic breakage by adding a new triple-dot method.
- Existing commit flow prompts for push. Refactor before using it as an MR sub-step.
- `mrSystemPrompt` conflicts slightly with current prompt-loader architecture. Decide before implementation.

### Open decisions

1. Should `mrSystemPrompt` live in config, prompt files, or both?
2. Should `GitHost.resolveHandle` return group members or a group reviewer handle? Product spec says groups resolve through members; implement that unless GitLab reviewer behavior requires otherwise.
3. How should repo membership in `dynamicEnvRepos` be matched: repo root basename, remote URL slug, or configured exact path? Prefer remote slug if available; basename as fallback.

---

## 8. Suggested implementation order

1. Add/adjust `Vcs` port and `GitAdapter` methods with tests.
2. Add `GlabAdapter` with tests.
3. Wire `gitHost` into `Context`.
4. Refactor commit into reusable `runCommitFlow` helper.
5. Add MR prompt/parser/generation modules with tests.
6. Implement core `merge-request` flow without reviewer intelligence.
7. Add reviewer suggestion module and tests.
8. Add auto-reviewer, assignee, final summary, and create behavior.
9. Add dynamic-env handoff.
10. Register the feature and run full validation.
