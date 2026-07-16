
# Tickets for mr-review

**Source spec:** `specs/mr-review/mr-review.md`
**Implementation plan:** `specs/mr-review/implementation-plan.md`
**Generated:** 2025-07-18
**Output format:** local files

## Ticket list (dependency order)

| # | Title | Blocked by | Purpose |
|---|-------|-----------|---------|
| 01 | Config & port scaffolding for mr-review | None | Extend config schema, GitHost port, prompt loader, and Context with shapes required by all downstream tickets |
| 02 | Reviewer file parsing and validation | 01 | Parse frontmatter from `.md` files, validate fields against config, discover from global + project dirs with override precedence |
| 03 | Scheduler admission policy and driver loop | None | Pure admission function implementing concurrency cap + ≤1 non-parallel rule, plus promise-based driver loop |
| 04 | Findings JSON defensive parsing | None | Type definition + safe parser that never throws on malformed agent output |
| 05 | Diff-line resolver (port from mr-reviewer) | None | Parse unified diff hunks and resolve line positions for inline comment anchoring |
| 06 | Dedupe pass (built-in LLM-driven agent) | 01, 04 | Collapse near-duplicate findings across agents; fatal abort on unparseable output |
| 07 | Context fetching and run-folder writing | 01 | Fetch Jira story, MR description, discussions, diff; write to `.mr-review/` subfolder as separate files |
| 08 | Publishing findings to the MR | 01, 05 | Post inline comments, global notes, grouped recommendations, suggestion blocks; resolve configured author username |
| 09 | Full mr-review orchestration flow | ALL of 01–08 | Wire together preflight → select → run → publish → cost table; register as Feature in registry |

## Cross-ticket risks

- `git-host` port extension in ticket 01 must be stable by the time tickets 07/08 depend on it. The five new methods are defined up front so 07 and 08 can work in parallel during implementation.
- `FakeGitHost` needs to be extended before tickets 07, 08, and 09 can test. Ticket 01 covers the extension.
- The dedupe pass (ticket 06) depends on both config scaffolding (01) and findings parsing (04). Ensure the `getLlmFor("mrReview")` proxy is wired before starting 06.
