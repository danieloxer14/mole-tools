# Bug 01 — Duplicate async processing appears concurrent instead of sequential

## What to fix

The merge-request flow currently shows two async spinners running at the same time, making it look like Jira fetching and MR generation are happening concurrently. The expected UX is a clear step-by-step progression where each async operation completes before the next one begins.

### Observed behavior

```
Fetching Jira issue AST-3350...
Fetched AST-3350: FT experience - Change the default number of outputs from 4 to 1
⠦ Fetching merge request diff...
⠴ Generating merge request
```

Both spinner states (`⠦` and `⠴`) are rendered simultaneously instead of showing one at a time.

### Expected behavior

Each async step should display its progress indicator sequentially — complete one spinner, then start the next — so the user can follow the flow linearly:

```
Fetching Jira issue AST-3350...
Fetched AST-3350: FT experience - Change the default number of outputs from 4 to 1
⠦ Fetching merge request diff...
Diff collected (N files changed).
⠴ Generating merge request title + body...
[streamed output]
```

## Blocked by

None — should be investigated as an Ink rendering or task-scheduling issue.

## Status

confirmed-bug

## Acceptance criteria

- [ ] Only one async spinner is active at any given time during the MR flow.
- [ ] Each step (diff collection, Ollama generation, etc.) renders its spinner after the previous step completes and clears.
- [ ] No overlapping spinner frames or duplicate in-flight indicators appear on the terminal.

## Reproduction steps

1. Run `mole-tools --merge-request` on a branch with a Jira key and ahead-of-base commits.
2. Observe the spinner output during diff collection and MR generation.
3. Note if multiple spinners are rendered simultaneously.

## Test approach

**Test type:** manual + snapshot
**Validate with:** run the merge-request flow and visually confirm sequential spinner rendering; consider an Ink renderer unit test that checks only one task indicator is mounted at a time.

## Implementation notes

- Likely caused by Ink's `Task` or `Spinner` components being rendered concurrently instead of conditionally (e.g., both diff and generation tasks are in the tree at once).
- Check whether the flow should use a sequential state machine that activates/deactivates each spinner, rather than rendering all possible steps with hidden placeholders.

## Out of scope

- Rewriting the entire task pipeline — this is purely about rendering correctness.
