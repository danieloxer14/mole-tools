
# 02 — Reviewer file parsing and validation

## What to build

Parse review agent markdown files from `~/.config/mole-tools/reviewers/` (global) and `<repo-root>/.mole-tools/reviewers/` (project). Project files override global files by id. Validate frontmatter fields at load time, aborting on first failure with a message naming the file and field. Each validated reviewer is returned as a structured object ready for scheduling.

## Blocked by

01 — depends on widened config schema for provider/cost-catalog lookups

## Status

ready-for-agent

## Acceptance criteria

- [ ] Given a `.md` file with valid frontmatter, `parseReviewer(fileContent)` returns a structured reviewer object with name, description, provider, model, parallel boolean, and inputs array
- [ ] Missing required frontmatter field → error naming the file path (or id) + missing field name
- [ ] `provider` not in `config.providers` → abort naming file + provider key
- [ ] `model` not priced in cost catalog → abort naming file + model name
- [ ] `inputs` contains `"codebase"` but named provider/model lacks `agentic-workspace` capability → abort naming file and explaining agentic provider required
- [ ] `discoverReviewers(globalDir, projectDir)` returns merged set where project files override globals by id (filename without `.md`)
- [ ] Both directories empty / no matching `.md` files → throws "no reviewers configured" error
- [ ] Invalid YAML in frontmatter → parse error naming the file

## Test approach

**Test type:** unit
**Test file/area:** `src/features/mr-review/reviewers.test.ts`
**Validate with:** `bun test src/features/mr-review/reviewers.test.ts`

### Red-Green strategy

1. **Red**: Write tests for `parseReviewer` that assert a valid frontmatter object parses correctly, then a second test that asserts missing `name` field throws with the right message. Fails because function doesn't exist yet.
2. **Green**: Implement `parseReviewer` using `gray-matter` for YAML extraction + zod validation against spec's §4.1 field table. Wire up config-provider and cost-catalog lookup in the validation step. Parse tests pass.
3. **Red (discovery)**: Write tests for `discoverReviewers` that mock `node:fs/promises` readdir/readdir to simulate fixtures, asserting project overrides global.
4. **Green**: Implement discovery with `readdir` + merge logic. Discovery tests pass.
5. **Refactor**: Extract the zod schema for reviewer frontmatter into its own small type/module if it grows. Run full suite (`bun test`) green.

## Implementation notes

- Use `gray-matter` + `js-yaml` for frontmatter parsing (explicit deviation from lean-dep default, confirmed in implementation plan).
- The agent id is the filename without `.md`. Used as the output filename prefix and dedup key.
- Validation function should take `(parsedReviewer, config, costCatalog, capabilitiesLookup)` so tests can inject fakes easily — avoid depending on real `Context` here.
- Discovery uses `node:fs/promises.readdirSync` or async equivalent. Mock with `bun:test mock()` as approved in the plan (single place where mocking buys isolation value).
- The merged set is keyed by id; last writer wins, so project always overrides global.

## Out of scope

- Running agents (ticket 03/09)
- Context fetching (ticket 07)
- Any LLM calls — purely file I/O + validation

## Open questions

None
