# Commit `--auto` mode

**Status:** Planned
**Date:** 2026-07-14
**Scope:** `mole-tools commit`

## Goal

Add `mole-tools commit --auto`: a strictly non-interactive way to create a
local commit from staged changes using the generated, format-valid commit
message.

This document is an addendum to `specs/commit/commit-tool.md`. Where the two
documents differ, this document defines `--auto` behavior.

## Command interface

```sh
mole-tools commit --auto
```

- `--auto` is a bare boolean flag; it takes no value.
- Omitting `--auto` preserves the existing interactive commit flow.
- No `--auto true` or `--no-auto` form is supported.
- `mole-tools help commit` documents the flag, its no-prompt behavior, and that
  it does not push.

## Behavior

`--auto` retains all pre-commit work performed by the interactive flow:

1. Require staged changes; otherwise fail with `No staged changes`.
2. Fetch Jira context when the configured branch-pattern rules require it.
3. Collect and filter the staged diff.
4. Generate a commit message with the configured commit LLM route.
5. Enforce existing commit-message format validation and bounded regeneration.
6. Create a local git commit using the generated valid message.

Unlike the interactive flow, it must:

- not render or await the **Accept / Edit / Reject** selection;
- never open an editor;
- not ask **Push?**;
- never push, including when the branch has an upstream; and
- remain strictly non-interactive.

It must continue printing informational output, including the generated commit
message and the resulting commit SHA/summary. The flag suppresses input
requests, not progress or result output.

## Non-interactive safety contract

`--auto` must not silently choose answers for future commit-flow decisions.
If a future flow change introduces a decision that has no explicit safe auto
behavior, auto mode must fail with a clear error instead of prompting or
choosing a default. Any such future decision needs an explicit `--auto`
behavior and corresponding test before it is reachable in auto mode.

Generation, Jira, git, validation, and commit failures retain their existing
error behavior; auto mode must not recover by prompting.

## Design and change points

- In `src/features/commit/index.ts`, extend the command argument schema with
  `auto: z.boolean().default(false)` and user-facing Zod metadata.
- Pass the parsed value into `runCommitFlow` through an explicit option such as
  `auto?: boolean`. Keep `askToPush` for the merge-request caller, whose
  current behavior must remain interactive for message acceptance while
  suppressing only its standalone push prompt.
- When auto is enabled, use the generated validated message directly and skip
  both `ctx.ui.select(...)` and `ctx.ui.confirm(...)` in the commit flow.
- Extend generic CLI-option registration in `src/index.tsx` so a Zod boolean
  is registered as a valueless CAC flag (`--auto`) rather than as
  `--auto <value>`.
- Extend `src/features/help/format.ts` so boolean options render without a
  value placeholder in generated help and usage.

## Acceptance criteria

- [ ] `mole-tools commit --auto` parses as `{ auto: true }`.
- [ ] `mole-tools commit` parses as `{ auto: false }` and preserves existing
  interactive behavior.
- [ ] CLI and generated help show `--auto` without a value placeholder.
- [ ] With valid staged changes, `--auto` generates a valid message, creates
  exactly one local commit, and does not invoke `select`, `editText`, or
  `confirm`.
- [ ] `--auto` does not invoke `vcs.push`.
- [ ] The generated message and committed SHA/summary remain in informational
  output.
- [ ] All existing pre-commit failures still abort without creating a commit.
- [ ] Existing merge-request behavior using `runCommitFlow({ askToPush: false
  })` remains unchanged.
- [ ] A test double that fails on UI input requests proves the auto path cannot
  block on current prompts.

## Test plan

Add focused commit-flow tests covering auto and default interactive paths, plus
CLI/help formatter tests for bare boolean flags. Use fake VCS, LLM, issue, and
UI ports; the auto-mode UI fake should throw if any input method is called.
Run the focused tests with `bun test`, then the full suite with `bun test`.

## Out of scope

- Automatically pushing commits.
- Applying `--auto` to merge-request, Ralph, worktree-prune, or other features.
- Changing existing commit generation, Jira, diff, or format-validation rules.
- Adding configurable default answers for interactive prompts.
