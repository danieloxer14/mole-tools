# mr-review — Implementation Plan

## Context

`specs/mr-review/mr-review.md` is a product-grilled spec for a new `mole-tools
mr-review <mr-url>` command: fan out file-defined review agents against a
GitLab MR, collect structured findings, and publish them back via `glab`. It
reuses this repo's existing ports (`GitHost`, `IssueTracker`, `Llm`,
`CostTracker`) and mirrors `mr-reviewer`'s finding shape and publishing
fidelity. A follow-up grill session resolved every open implementation
question (module shape, port extensions, scheduler design, test strategy) and
surfaced one real spec gap: §5.9 says findings are "deduped" before
publishing but never defines how. The resolution was to add a **built-in
dedupe agent** (LLM-driven, not a user-authored reviewer file) — this plan
folds that addition in alongside the rest of the build.

Everything below reuses existing mole-tools conventions found in
`src/features/merge-request/`, `src/adapters/git-host/glab.ts`,
`src/adapters/prompts/loader.ts`, `src/core/context.ts`, and
`src/shared/cost/`. No new architectural layer is introduced except one
deliberate, explicitly-approved deviation (fine-grained note below).

---

## 1. Spec update (do first)

Edit `specs/mr-review/mr-review.md` to add a new subsection under §5
(**5.9a Dedupe pass**) and update §7/§3 accordingly:

- A **built-in dedupe agent** runs after all selected reviewer agents finish,
  whenever total findings across all agents ≥ 2. It is **not** shown in the
  §5.1 multi-select (not a reviewer `.md` file) — fully automatic.
- Routed like `commit`/`mergeRequest`: new `models.mrReview` config key
  (`ModelRoute`: `{provider, name}`) + new prompt file
  `mr-review-dedupe-system` (via `loadPrompt`, same pattern as `mr-system`).
- Input: all raw `ParsedComment[]` findings from every successful reviewer
  agent, tagged by `category` (agent id). Output: same `ParsedComment[]`
  shape, near-duplicate clusters collapsed to one canonical entry.
- **Unlike per-reviewer-agent failures (§5.12, isolated/non-fatal), a dedupe
  failure (LLM error or unparseable output) is fatal** — aborts before the
  confirm/publish step. Rationale (per user): risk of publishing
  duplicate/conflicting findings is worse than losing the run to a retry.
  This is a deliberate asymmetry vs. §5.12 — call it out explicitly in the
  spec so a future reader doesn't "fix" it into consistency.
- Cost is recorded via `CostTracker.record` same as reviewer agents,
  `task: "mr-review-dedupe"`.
- Update §3 config table (add `models.mrReview`) and §7 acceptance criteria
  (add: dedupe skipped at ≤1 finding; dedupe failure aborts the run before
  publish; dedupe output cost is recorded and shown in the cost table).

---

## 2. Config & port changes

**`src/adapters/config/schema.ts`**
- `ModelsConfigSchema`: add `mrReview: ModelRouteSchema`.
- `ConfigSchema`: add `mrReview: z.object({ concurrency: z.number().int().positive().default(2), authorUsername: z.string().min(1).optional() }).optional()`.
- `RoutingPurpose`: add `"mrReview"`.
- Update `resolveLlmProvider`'s `purpose` switch and the provider-existence
  validation list (`["models.commit", ...]` array) to include
  `["models.mrReview", config.models.mrReview]`.

**`src/adapters/config/loader.ts`** — add `models.mrReview` (and commented
`mrReview.concurrency`) to `CONFIG_TEMPLATE_TEXT`, same style as existing keys.

**`src/adapters/prompts/loader.ts`** — add `"mr-review-dedupe-system"` to the
`PromptName` union and its `DEFAULT_PROMPTS` entry (instructs the model:
given N findings as JSON tagged by agent, return one deduped JSON array of
the same `ParsedComment` shape, preferring the more specific/actionable
wording when merging a cluster).

**`src/ports/git-host.ts`** — extend `GitHost` with one verb per capability
(mirrors existing granularity: `preflight`/`currentUser`/`findOpenMr`/etc.):
```ts
export interface MrRef { project: string; iid: string }
export interface MrDetails { title: string; description: string; diffRefs: { baseSha: string; headSha: string; startSha: string } }
export interface MrDiscussionNote { id: string; body: string }
export interface InlineCommentInput {
  project: string; iid: string; body: string;
  position: { baseSha: string; headSha: string; startSha: string; oldPath: string; newPath: string; newLine?: number; oldLine?: number };
}

parseMrUrl(url: string): MrRef;              // pure — no glab call
fetchMr(ref: MrRef): Promise<MrDetails>;
fetchMrDiff(ref: MrRef): Promise<FileDiff[]>;  // reuses existing FileDiff shape from ports/vcs
fetchDiscussions(ref: MrRef): Promise<MrDiscussionNote[]>;
postInlineComment(input: InlineCommentInput): Promise<void>;
postNote(ref: MrRef, body: string): Promise<void>;
```
(`parseMrUrl` can live as a plain exported function instead of a port method
if that reads cleaner in context — it's pure and glab-independent; decide at
implementation time, doesn't affect the plan.)

**`src/adapters/git-host/glab.ts`** — implement the five glab-calling methods
via `glab api <path>` (same `_exec`/`PortError` pattern as `resolveUser`/
`resolveGroup`): `GET /projects/:id/merge_requests/:iid`, `GET
.../merge_requests/:iid/changes` (→ map to `FileDiff[]`), `GET
.../merge_requests/:iid/discussions` (paginated, same pattern as
`resolveGroup`), `POST .../discussions` with a `position` body _(optionally including `author_id` resolved from config)_, `POST .../notes` _(optionally with `author_id`)_. When `mrReview.authorUsername` is set in config, resolve it via the existing `resolveHandle` method and use its GitLab user id as author. If resolution fails, abort before publishing.

**`test/fakes/FakeGitHost.ts`** — add stub implementations for the five new
methods (scriptable via constructor options, same style as `FakeVcs`).

**`src/core/context.ts`** — `getLlmFor`'s `purpose` param type gains
`"mrReview"`; `RoutingLlmProxy` needs an `mrReviewProxy` cache field mirroring
`mrProxy`, resolved via `config.models.mrReview` (used only by the dedupe
agent's default routing — reviewer-agent calls always pass an explicit
`providerKey` and never hit this default).

**`test/fakes/fakeContext.ts`** — widen the `getLlmFor` type signature to
match.

---

## 3. New feature module: `src/features/mr-review/`

Six files, each with a co-located `.test.ts`, mirroring
`src/features/merge-request/`'s split:

| File | Responsibility | Depends on |
|------|-----------------|------------|
| `reviewers.ts` | Parse+validate one reviewer `.md` file (frontmatter via `gray-matter`+`js-yaml`, zod-validated against §4.1's field table incl. the `codebase`+non-agentic-provider load-fail rule from §4.3); separately, `discoverReviewers(globalDir, projectDir)` walks both dirs via `node:fs/promises`, project overrides global by id. | `gray-matter`, `js-yaml` (new deps), `node:fs/promises` |
| `scheduler.ts` | Pure admission policy: `canAdmit(inFlight: ScheduledAgent[], candidate: ScheduledAgent, cap: number): boolean` implementing §5.7 (in-flight < cap AND (candidate.parallel \|\| no other non-parallel in flight)); a driver loop (`runAgentsWithPolicy`) that starts tasks as slots free using `Promise.race`. | none (pure + plain promises) |
| `diff-line-resolver.ts` (shared, not GitHost-specific — actually place at `src/shared/diff-line-resolver.ts` since it's diff-format logic, reusable) | Port of mr-reviewer's `diffLineResolver.ts`: parse `@@ -old,+new @@` hunks from a per-file unified-diff string, resolve `{new_line?, old_line?, snappedFrom?}` for a target line, with nearest-line snapping fallback (full fidelity, per grill decision). | none (pure string parsing) |
| `findings.ts` | `parseFindingsJson(raw: string): ParsedFinding[]` — defensive parse mirroring mr-reviewer's `parseFindingsJson` (bad JSON/non-array → `[]`; per-item validation drops only the bad item, never throws). `ParsedFinding` type = spec's §5.8 shape. | none (pure) |
| `dedupe.ts` | `dedupeFindings(ctx, findings): Promise<ParsedFinding[]>` — skip (return input unchanged) when `findings.length <= 1`; else call `ctx.getLlmFor("mrReview")` with `loadPrompt("mr-review-dedupe-system")`, parse output via `findings.ts`'s parser, **throw a fatal error on unparseable/empty output** (per §5.9a); records cost via `ctx.costTracker.record(...)`, `task: "mr-review-dedupe"`. | `findings.ts`, `context.ts`, `prompts/loader.ts` |
| `context.ts` | Fetch+write run context (§5.5/§5.6): best-effort Jira via `ctx.issues`, MR description+discussions via new `GitHost` methods, diff via new `GitHost` methods; writes `story.md`/`mr.md`/`diff.patch` into `.mr-review/<iid>-<slug>/` (overwriting). | `ctx.issues`, `ctx.gitHost`, `node:fs/promises` or `Bun.write` |
| `publish.ts` | §5.9 publishing: for each critical/important/minor finding, resolve inline position via `diff-line-resolver` + the fetched `diffRefs`, else fall back to `postNote`; collapse `recommendation`-tier into one grouped note sub-grouped by agent; render `suggestion` blocks (`` ```suggestion:-0+N``` ``) when eligible (clean in-diff range, no nested triple-backticks — mirror mr-reviewer's `suggestionEligible` gate). | `diff-line-resolver.ts`, `ctx.gitHost` |
| `index.ts` | Orchestrates the full §5 UX flow (preflight → parse URL → discover+validate reviewers → multi-select → fetch context → prune story-only agents when no issue → run agents via scheduler, each fed only its declared inputs via `ctx.llm.generate`/`ctx.llm.runAgent` per §5.4 → parse+record cost per agent → dedupe → summary+confirm → publish → own per-agent cost table via `renderTable`). Registers as a `Feature` like `merge-request`'s `index.ts`. | everything above + `ctx.ui`, `ctx.vcs` (cwd branch check §5.10) |

**Cost table**: build with `src/shared/table-renderer.ts`'s `renderTable`
(already used by `cost-breakdown/format.ts`) — NOT `formatRalphCostSummary`
(that one is keyed by Ralph's phase/iteration shape, not applicable here).
Rows keyed by agent id/name, columns name/model/in/out/USD+source, plus a
total row and failed-agents shown with zero/partial cost, per §5.11. The
CLI's outer `formatCostSavingsTable` (the generic "$ saved vs Claude" line in
`src/index.tsx`) still fires automatically on top of this — no extra wiring
needed for that part.

**`src/core/registry.ts`** — add `mrReview` to the `features` array.

---

## 4. TDD build order (Red-Green, one slice at a time)

Write the failing test for each slice before its implementation, in this
order (pure logic first, fake-backed I/O last — confirmed with user):

1. **`reviewers.test.ts`** — pure parse/validate: missing field → error naming
   file+field; unknown `provider`/unpriced `model` → error at validation call
   site (validation function takes the resolved config so it can check
   `config.providers`/cost catalog); `codebase` input + non-agentic
   capabilities → error; two dirs with same id → project wins.
   *(discovery half — real `.md` fixture reads — uses `bun:test mock()` over
   `node:fs/promises`, confirmed deviation from this repo's usual
   real-fs-in-tmpdir pattern, since it's exactly one place mocking buys real
   isolation value.)*
2. **`scheduler.test.ts`** — `canAdmit` table-driven: cap boundary, two
   `parallel:false` never both admitted, `parallel:true` overlaps a running
   non-parallel agent, cap counts all in-flight regardless of `parallel`.
3. **`diff-line-resolver.test.ts`** — exact match on added/removed/context
   lines; snapping fallback when target line isn't in any hunk (`snappedFrom`
   set); multi-hunk file.
4. **`findings.test.ts`** — bad JSON → `[]`; non-array root → `[]`; per-item
   bad severity/missing description → item dropped, rest kept; `filePath:
   null` forces `lineStart`/`lineEnd`/`suggestion` to `null`.
5. **`dedupe.test.ts`** (uses `FakeLlm`) — ≤1 finding skips the LLM call
   entirely (assert `FakeLlm.requests` stays empty); 2+ findings calls
   `ctx.getLlmFor("mrReview")` with the loaded prompt; unparseable output
   throws (fatal); cost entry recorded with `task: "mr-review-dedupe"`.
6. **`context.test.ts`** (uses `FakeIssueTracker`/`FakeGitHost`) — Jira
   key found → `story.md` written; no key/disabled/fetch-fails → empty
   `story.md`; discussions+diff written to `mr.md`/`diff.patch`; re-run
   overwrites the subfolder.
7. **`publish.test.ts`** (uses extended `FakeGitHost`) — resolvable
   critical/important/minor → inline `postInlineComment` call with correct
   position; unresolvable → `postNote` fallback; recommendation-tier findings
   collapsed into one grouped note; clean suggestion range → `suggestion`
   block body; nested triple-backtick suggestion → not suggestion-eligible;
   configured `authorUsername` resolved and passed through as author on
   each post call; unresolvable username → fatal abort before any post.
8. **`index.test.ts`** — full flow integration wiring `FakeGitHost`/
   `FakeLlm`/`FakeIssueTracker`/`FakeVcs`/`FakeUiPort`, mirroring
   `merge-request/index.test.ts`'s structure: zero agents selected → exit
   early with a message, no fetch; story-only agent pruned with a warning
   when no Jira match; concurrency cap respected (scripted `FakeLlm` delays);
   one agent fails → run continues, reported, remaining findings still
   publish; user rejects confirm → nothing posted, cost table still shown;
   current branch ≠ MR source branch → warning printed, continues.

Each slice's test file is written and run (`bun test <file>`) to confirm it
fails for the right reason before writing the implementation, then re-run
green. Full suite (`bun test`) at the end of each slice to guard against
regressions in already-green modules.

---

## 5. New dependencies

- `gray-matter` + `js-yaml` (+ `@types/js-yaml` if needed) — reviewer
  frontmatter parsing (explicit deviation from the lean-dep default,
  confirmed with user for YAML robustness over a hand-rolled parser).

No other new dependencies — scheduler, diff-line-resolver, findings parser,
and dedupe orchestration are all hand-rolled per the grill decisions.

---

## 6. Verification

- `bun test` — full suite green, including all new co-located tests above.
- `bunx tsc --noEmit` (or the repo's existing typecheck script) — no type
  errors from the widened `GitHost`/`Context`/`fakeContext` signatures.
- Manual smoke run against a real (or throwaway) GitLab MR:
  `mole-tools mr-review <mr-url>` from a checkout of that MR's source branch,
  with at least one project-level reviewer `.md` file in
  `.mole-tools/reviewers/` — walk the full flow (select → context files
  written under `.mr-review/<iid>-<slug>/` → findings JSON per agent →
  dedupe pass fires when 2+ findings exist → summary/confirm → posted
  comments visible on the real MR → cost table printed).
- Re-run the same command against the same MR and confirm the run subfolder
  is overwritten (fresh files, not appended).
