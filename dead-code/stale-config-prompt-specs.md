# Replace superseded configuration and prompt claims in specs

## Type
Stale documentation

## Scope
- Area: `Configuration and prompt loading`
- Candidate paths: `specs/commit/commit-tool.md`, `specs/merge-request/merge-request-tool.md`, `specs/architecture/implementation-plan.md`, `specs/architecture/code-design.md`, `specs/merge-request/merge-request-implementation-plan.md`, `docs/adr/0004-explicit-per-phase-model-routing.md`, `specs/explicit-model-routing/explicit-model-routing.md`, `README.md`, `CONTEXT.md`
- Symbols/config/docs: legacy `commit.provider` / `commit.model` and `mergeRequest.provider` / `mergeRequest.model` routes, `commitSystemPrompt`, `mrSystemPrompt`, `providers.pi.command`, Ralph config, prompt-loading decisions, contradictory legacy-migration claims, and the LLM model-route glossary example

## Evidence
- `src/adapters/config/schema.ts:23-35,53-72` defines the live model contract as `models.commit` and `models.mergeRequest`, each `{ provider, name }`, with provider profiles using `binary` for Pi; there is no `commit` or `mergeRequest` top-level route and no `ralph` field.
- `src/adapters/config/loader.ts:11-48` writes the live template with `providers`, `models`, Jira, diff, optional dynamic-environment/worktree/review settings, and no `commitSystemPrompt` or `mrSystemPrompt` fields.
- `src/adapters/prompts/defaults.ts:1-28` and `src/adapters/prompts/loader.ts:11-23` define five prompt slots as files beside `config.json`, seed missing files, and preserve user edits; prompts are not config-string fields.
- `src/features/commit/index.ts:2-3,63-66` and `src/features/merge-request/generate.ts:1-2,28-31` load prompt files and resolve `models` routes at runtime.
- `specs/commit/commit-tool.md:59-79` documents `commit.provider`, `commit.model`, `mergeRequest.provider`, `mergeRequest.model`, `ralph.provider`, `providers.pi.command`, and config prompt fields; `:88-90` sends `commitSystemPrompt`; `:123-125` resolves the obsolete route shape.
- `specs/merge-request/merge-request-tool.md:47-61,88-89` repeats obsolete route keys and `mrSystemPrompt`, while `specs/merge-request/merge-request-implementation-plan.md:39,207-218,559-564` treats `ollama.mrModel` and `mrSystemPrompt` as unresolved implementation decisions despite the current file-backed prompt loader.
- `specs/architecture/implementation-plan.md:101-108` says the schema mirrors the old commit-tool table and lists removed `ollama.mrModel` / `mrSystemPrompt`; `specs/architecture/code-design.md:411-414` still passes `ctx.config.commitSystemPrompt` to the commit prompt builder.
- `docs/adr/0004-explicit-per-phase-model-routing.md:9-15,42-50` and `specs/explicit-model-routing/explicit-model-routing.md:8,46-70` state that legacy migration/fallbacks are not accepted, while `src/adapters/config/loader.ts:76-121,129-169` normalizes legacy `ollama` and `providers` + `llm`/`models.default` configs and returns compatibility fields. `src/adapters/config/loader.test.ts:48-79,201-266` and `src/adapters/config/schema.ts:80-115` explicitly exercise that compatibility.
- `specs/architecture/code-design.md:84-105` shows obsolete source paths (`config/`, `git-host/gitlab.ts`, and `shared/prompt.ts`) and `:411-414` still passes nonexistent `ctx.config.commitSystemPrompt`; current implementations are under `src/adapters/config`, `src/adapters/git-host/glab.ts`, `src/adapters/prompts`, and load prompt files.
- `README.md:39` says every other feature auto-creates config although the help command explicitly bypasses config loading (`src/index.tsx:21-22`); `README.md:249` says the MR GitLab host is configured through the `pi` provider or environment although `src/core/context.ts:151` always constructs the GitLab adapter independently. These are documentation-contract mismatches to reconcile.
- `README.md:62` says unknown or legacy fields are rejected without distinguishing the supported legacy migration paths. `README.md:19-24,64-75` uses inconsistent default model examples (`gemma4:12b` versus `gemma3:12b`), and `README.md:331-337` says `review.model` is for OMP even though the configuration contract supports both OMP and Claude. The README otherwise documents the current `providers`/`models` shape and file-backed prompt overrides, contradicting the older specs. `bun test src/adapters/config src/adapters/prompts` passed 22 tests, confirming the current loader/schema/prompt behavior.
- `CONTEXT.md:19-20` gives `LLM model route` as `commit: { provider: "ollama", name: "qwen3" }`, but the live schema and README use `models.commit` and `models.mergeRequest`; the glossary therefore teaches a top-level route shape that `ConfigSchema` does not accept.

## Why this is safe to change
These documents contain current-looking configuration tables, flow steps, and implementation guidance that contradict the validated runtime contract and user-facing README. Updating or explicitly labeling them archival changes no application behavior, config parsing, or prompt loading. The legacy migration code is covered by tests and must be documented accurately or separately retired only after an explicit compatibility decision.

## Proposed change
1. Rewrite configuration tables and flow references in the listed specs to use `providers.*`, `models.commit` / `models.mergeRequest`, Pi `binary`, and prompt files under the configured prompts directory.
2. Remove or clearly mark Ralph and obsolete in-config prompt references as historical; remove unresolved prompt-storage decisions now settled by `src/adapters/prompts/`.
3. Reconcile ADR/explicit-routing claims and README wording with actual legacy migration behavior; either document the supported upgrade path or label the strict-break decision as superseded, without changing runtime behavior in this ticket.
4. Align README model examples with the template's `gemma4:12b` default, and state that `review.model` applies to both supported review agents.
5. Update nearby examples and implementation snippets without changing source code; preserve the separate CLI-invocation cleanup tracked by `dead-code/cli-specs-superseded-flags.md`.
6. Search the documentation/spec set for the obsolete keys and either migrate each current-looking reference or label intentional historical material.
7. Update `CONTEXT.md:19-20` to show the live `models.commit` / `models.mergeRequest` route shape, keeping provider connection details separate and preserving the glossary's conceptual meaning.

## Acceptance criteria
- [ ] Current-looking configuration examples and tables no longer advertise obsolete route keys, Ralph config, Pi `command`, or in-config prompt fields.
- [ ] Documentation names `models.commit` / `models.mergeRequest` and file-backed prompt overrides consistently with the live schema and loaders.
- [ ] All affected docs, implementation plans, and examples are migrated or explicitly labeled archival; no stale unresolved prompt-storage decision remains presented as current.
- [ ] No application code or supported configuration behavior changes as part of the documentation cleanup.
- [ ] Targeted config/prompt tests remain green after documentation changes.

## Risks and open questions
- Determine which planning documents are intentionally historical before editing; label rather than rewrite if external links depend on their original proposal.
- Legacy config migration remains live in `src/adapters/config/loader.ts` and is covered by tests; confirm its supported upgrade window separately before removing or narrowing it.
- `README.md:39` and `:249` wording may be intentionally scoped to feature flows or deployment environments; confirm intended user-facing contract before editing.

## Assessment

- **Validated:** 2026-08-27 — `valid`
   - Re-ran ticket evidence: live contract is `models.commit`/`models.mergeRequest` `{provider,name}` + `providers.*` with Pi `binary`, all `.strict()` (schema.ts:23-72); template has no `commitSystemPrompt`/`mrSystemPrompt`/`ralph` (loader.ts:11-48); prompts are 5 files beside config, seeded (defaults.ts:1-6, prompts/loader.ts:11-23). `grep -rn "commitSystemPrompt|mrSystemPrompt|ralph|commit.provider|commit.model|providers.pi.command" src` → 0 matches, so the obsolete keys are docs-only. Legacy migration is live + tested (loader.ts:76-121,129-170 `normalizeConfig` + schema.ts:80-115 `resolveLlmProvider`, loader.test.ts:48-79,201-266), contradicting ADR 0004:42 / explicit-model-routing:50,70 "no legacy shims / not accepted / drop legacy transforms." `bun test src/adapters/config src/adapters/prompts` → 22 pass / 0 fail. CONTEXT.md:19-20 teaches top-level `commit: {…}` (live is `models.commit`); README:19-24 vs :64-75 disagree `gemma4:12b` vs `gemma3:12b` (template `gemma4:12b`, loader.ts:21-22); README:250 "via pi provider or environment" but `gitHost: new GlabAdapter()` is unconditional (context.ts:161, ticket cited :151); README:333 says `review.model` "for OMP" but `ReviewConfigSchema` supports omp+claude (schema.ts:38-45).
- **Product impact:** `docs` — **Priority P4**
   - Every affected surface is a spec/ADR/README/CONTEXT doc; no runtime code, config parsing, or prompt loading changes. Doc/spec drift only; safe to defer.
- **Verification:**
   - Safe (no live consumer of the documented strings): `grep -rn "commitSystemPrompt|mrSystemPrompt|ralph|commit.provider|commit.model|providers.pi.command|mrModel" src` → expect 0 matches; `bun test src/adapters/config src/adapters/prompts` → expect 22 pass / 0 fail (live contract unaffected by doc edits).
   - After (supported behavior unchanged): full `bun test` unchanged; `bun src/index.tsx help` and `bun src/index.tsx --version` still exit 0 (docs are off the help/config path; help bypasses `loadConfig`, index.tsx:21-22).
- **Removal risk:** Docs-only; no runtime/CI/release consumer of these files. Two real caveats, not `None found`: (1) ADR 0004 + `specs/explicit-model-routing` + `specs/architecture` are `Accepted`/`Draft` 2026-07-14 historical artifacts external proposals/links may reference — label archival rather than hard-rewrite per ticket Risks #1; (2) the live legacy-migration code (loader.ts:76-121,129-170 + schema.ts:80-115, covered by loader.test.ts) must NOT be retired by this docs cleanup — its supported upgrade window is a separate compatibility-boundary decision (ticket Risks #2).

## Removal process

- [x] Re-verified live contract and references: `ConfigSchema` accepts `providers.*`, `models.commit`, and `models.mergeRequest` routes with `{ provider, name }`; `CONFIG_TEMPLATE_TEXT` has no in-config prompt or Ralph fields; `loadPrompt` loads five files beside `config.json`; exact obsolete-key scan of `src` found no matches.
- [x] Baseline captured before edits: `bun test src/adapters/config src/adapters/prompts` — 22 pass / 0 fail; `bun run build` passed; `bun run lint` passed; `bun test` — 441 pass / 0 fail; `bun run src/index.tsx help` and `bun run src/index.tsx --version` exited 0.
- [x] Temporary removal-proof test: added `test/dead-code/stale-config-prompt-specs.test.ts`, scanning all nine listed documents and allowing only explicitly historical/superseded documents; `bun test test/dead-code/stale-config-prompt-specs.test.ts` was RED with 4 pass / 5 fail, then GREEN with 9 pass / 0 fail; deleted the temporary test after proof.
- [x] Updated exact documentation scope: `specs/commit/commit-tool.md`, `specs/merge-request/merge-request-tool.md`, and `specs/merge-request/merge-request-implementation-plan.md` now identify archival proposals and point to live routes/prompt files; implementation-plan and code-design paths/snippets use shipped config, prompt, and `glab` locations; ADR 0004 and explicit-model-routing are marked superseded with current compatibility notes.
- [x] Updated maintained user/context docs: `README.md` now uses `gemma4:12b`, distinguishes supported legacy normalization from rejected unknown fields, limits auto-bootstrap wording to configuration-backed features, documents direct `glab` authentication, and applies `review.model` to OMP or Claude; `CONTEXT.md` uses `models.commit` / `models.mergeRequest`.
- [x] No caller/import/config/schema/fixture migration required: documentation-only cutover; `src/adapters/config/loader.ts`, `src/adapters/config/schema.ts`, prompt loader/defaults, feature wiring, and compatibility tests remained unchanged.
- [x] Retained behavior after temporary-test cleanup: `bun test src/adapters/config src/adapters/prompts` — 22 pass / 0 fail.
- [x] Final validation: exact obsolete-key scan of `src` found no matches; `bun run src/index.tsx help` and `bun run src/index.tsx --version` exited 0; `bun run build` passed; `bun run lint` passed; `bun test` — 441 pass / 0 fail; documentation diff review confirmed no application-code changes.
- [x] Compatibility/archive checks preserved: live legacy normalization in `src/adapters/config/loader.ts` and its loader/schema tests were not removed or narrowed; historical proposal/ADR material was labeled rather than erased; no dynamic-loading, release, installer, or external-consumer path changed.
- [ ] Execution: commit and push `dead-code-removal-loop`, then record final short SHA and outcome here.
