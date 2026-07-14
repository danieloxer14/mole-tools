# 01 — Bare `--auto` commit flow

## What to build

Make `mole-tools commit --auto` a complete non-interactive local-commit path.
It accepts the generated, format-valid commit message, prints the existing
candidate and commit-result information, and creates one local commit without
opening any input UI or pushing. Omitting the flag retains the current
interactive commit flow. The existing merge-request caller retains its current
interactive commit-message decision while skipping its standalone push prompt.

## Blocked by

None — can start immediately.

## Status

ready-for-agent

## Acceptance criteria

- [ ] `mole-tools commit --auto` parses `auto` as `true`; omitting the flag
  parses it as `false` and preserves the interactive flow.
- [ ] Generic CLI registration and `mole-tools help commit` render `--auto` as
  a valueless boolean flag, with no `<auto>` placeholder.
- [ ] Given staged changes and a format-valid generated message, auto mode
  creates exactly one local commit with that message.
- [ ] Auto mode invokes none of `UiPort.select`, `UiPort.editText`, or
  `UiPort.confirm`, and invokes no `Vcs.push` operation.
- [ ] Auto mode retains informational output containing the generated message
  and the resulting commit SHA/summary.
- [ ] Existing staged-change, Jira, LLM, format-validation, and git-commit
  failures still abort without an interactive recovery path.
- [ ] `runCommitFlow({ askToPush: false })`, used by merge-request flow,
  remains interactive for commit-message acceptance and never adds a push.
- [ ] `bun test` passes.

## Test approach

**Test type:** Unit and feature-level integration with fakes.

**Test file/area:** Add commit-flow coverage alongside
`src/features/commit/index.ts`; extend `src/features/help/format.test.ts` for
boolean-option rendering. Add a focused CLI parsing test only if extracting the
option registration seam is necessary to test bare CAC flags.

**Validate with:** `bun test src/features/help/format.test.ts` and `bun test`.

### Red-Green strategy

1. **Red:** Add a help-format test expecting bare `--auto`, then a commit-flow
   test using `FakeVcs`, `FakeLlm`, and a `UiPort` fake whose input methods
   throw. Assert one committed message, no push calls, and retained info
   transcript entries.
2. **Green:** Add the boolean commit argument and teach generic option/help
   introspection to identify booleans. Thread `auto` into `runCommitFlow` and
   bypass the message selection and push confirmation only for that mode.
3. **Refactor:** Keep the commit flow's explicit options readable; preserve
   `askToPush` semantics for merge-request and avoid provider- or UI-adapter
   specific branching.

## Implementation notes

- `src/features/commit/index.ts` currently owns the command schema and calls
  `ctx.ui.select` for **Accept/Edit/Reject**, then conditionally calls
  `ctx.ui.confirm("Push?")`. `runCommitFlow` already accepts
  `askToPush?: boolean` for the merge-request caller.
- `src/index.tsx` currently registers every Zod-object field as
  `--<key> <value>`; a Zod boolean needs a valueless CAC registration.
- `src/features/help/format.ts` derives option display from Zod object fields
  and currently always displays a value placeholder.
- `test/fakes/FakeUiPort.ts` records all calls in `transcript` and throws when
  an unscripted input method is called; `FakeVcs` exposes `committedMessages`
  and `pushCalls`. These are the existing seams for proving the no-prompt and
  no-push contract.
- Respect the **Commit auto mode** glossary term in `CONTEXT.md`: a future
  decision without explicit safe auto semantics must fail rather than prompt or
  silently select a default.

## Out of scope

- Pushing in auto mode.
- Auto mode for merge-request or any other feature.
- Changes to commit generation, Jira lookup, diff filtering, or format rules.
- Configurable prompt defaults or `--no-auto` / `--auto true` variants.

## Open questions

None.
