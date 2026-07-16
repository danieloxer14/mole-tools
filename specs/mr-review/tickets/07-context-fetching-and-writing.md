
# 07 — Context fetching and run-folder writing

## What to build

Fetch MR context: best-effort Jira story from keys in MR title/description, MR description + existing discussion comments via GitHost, diff (with base/head/start sha) via GitHost. Write each as a separate file into `.mr-review/<iid>-<slug>/` under cwd (`story.md`, `mr.md`, `diff.patch`). Creating or overwriting the subfolder for fresh reviews on re-run.

## Blocked by

01 — depends on widened GitHost port methods and FakeGitHost stubs

## Status

ready-for-agent

## Acceptance criteria

- [ ] Given an MR with a Jira key in title/description (e.g., "MOLE-42"), `fetchAndWriteContext` resolves the issue via `ctx.issues.fetchIssue()` and writes its summary + description to `.mr-review/<iid>-<slug>/story.md`
- [ ] When Jira is unconfigured or key lookup fails, `story.md` is written as empty (no abort — best-effort)
- [ ] MR description and existing discussion notes are fetched via extended GitHost methods and written to `mr.md` with a clear section header for each comment
- [ ] The diff (unified, including file paths and hunks) is fetched via GitHost and written to `diff.patch`. The fetched response must include baseSha/headSha/startSha needed for inline anchoring.
- [ ] Run folder path follows pattern: `<cwd>/.mr-review/<iid>-<slug>/` where slug is lowercase, non-alnum replaced with `-`, collapsed
- [ ] Re-running on the same MR overwrites existing context files (fresh review)
- [ ] All three files (`story.md`, `mr.md`, `diff.patch`) are present in the subfolder after completion

## Test approach

**Test type:** unit (fake-backed)
**Test file/area:** `src/features/mr-review/context.test.ts`
**Validate with:** `bun test src/features/mr-review/context.test.ts`

### Red-Green strategy

1. **Red**: Write a test using `FakeIssueTracker` (scripted to return a Jira issue) and extended `FakeGitHost` (scripted for MR details, discussions, diff). Call `fetchAndWriteContext`. Assert `story.md` contains the issue's summary. Fails because function doesn't exist yet.
2. **Green**: Implement Jira fetch path + file write. Test passes.
3. **Red (no jira)**: Write test where `ctx.issues` is null. Assert `story.md` is written but empty. Fails because unconfigured path not handled yet.
4. **Green**: Add best-effort Jira handling with fallback to empty file. Test passes.
5. **Red (mr + diff)**: Write test asserting `mr.md` contains fetched description and discussion notes, and `diff.patch` contains the diff payload with sha refs. Fails because those paths not implemented yet.
6. **Green**: Implement MR description/discussions fetch, diff fetch with sha extraction, file writes. Test passes. Regress full suite (`bun test`).
7. **Refactor**: Extract slug-generation helper if used from multiple places. Run full suite green.

## Implementation notes

- Jira key extraction: regex `/\b[A-Z][A-Z0-9]+-\d+\b/` on the MR title + description text. Best-effort — no abort on failure.
- Fetch sequence: extract keys → fetch issue(s) if configured → fetch MR details (for desc + diffRefs) → fetch discussions → fetch diff → write all files.
- The diff response must preserve baseSha/headSha/startSha for later inline anchoring (ticket 08). Return these as part of the context payload alongside the patch content.
- File writes use `Bun.write` or `node:fs/promises.writeFile`. Ensure parent directories exist via `mkdirSync(p, { recursive: true })`.
- For testing file writes, consider running tests in a tmpdir (like existing patterns) or verifying write calls were made rather than asserting filesystem state. The mock approach depends on what's cleaner in practice.

## Out of scope

- Agent execution (ticket 03/09)
- Publishing to MR (ticket 08)
- Reviewer discovery and validation (ticket 02)

## Open questions

None
