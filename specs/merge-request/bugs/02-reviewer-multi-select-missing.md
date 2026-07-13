# Bug 02 — Reviewer suggestion step is skipped; no multi-select presented

## What to fix

The merge-request flow did not present a reviewer-suggestion step or any multi-select for choosing reviewers from the CODEOWNERS + touch-score pool. The PR was created without reviewers assigned.

### Observed behavior

After accepting the generated MR title/body, the flow went straight to final summary and creation without:
- Presenting Codeowners-based reviewer candidates in a multi-select list
- Allowing the user to pick 1+ or type a custom handle

### Expected behavior

Per spec §5.7 and step 12 in the UX flow:
1. If CODEOWNERS exist and resolve → present top match as multi-select with labels like `Display Name · @username · N commits`
2. User picks reviewer(s) or types a handle
3. Auto-reviewer prompt (if configured) follows
4. Reviewers appear in the final summary before confirmation

## Blocked by

None — investigate why the reviewer step is not triggering.

## Status

fixed

### Root cause

`selectReviewers()` returned early with an empty array when:
1. CODEOWNERS file was not found (`if (!path) return []`)
2. CODEOWNERS handles resolved to no members (`if (members.length === 0) return []`)

This prevented the reviewer selection UI from appearing at all, even though `rankReviewerSuggestions` already supports fallback using touch/recent authors.

### Fix applied

- Removed hard early-returns when CODEOWNERS is missing or resolves to empty members
- Added `buildFallbackReviewerSuggestions()` function that constructs reviewer candidates directly from git history (touch authors + recent authors) when no CODEOWNERS member pool exists
- Updated `selectReviewers()` to fall back to git history suggestions when the CODEOWNERS-based ranking produces no candidates
- Added tests for the new fallback function

## Acceptance criteria

- [ ] When CODEOWNERS are present and handles resolve, a multi-select reviewer list is rendered after MR accept.
- [ ] The multi-select shows display name, handle, and touch-score for each candidate.
- [ ] User can select one or more reviewers via multi-select (or type a custom handle).
- [ ] Selected reviewers appear in the final summary before the confirm/reject step.
- [ ] `glab mr create` passes `--reviewer <handle>` for each selection.

## Reproduction steps

1. Ensure the repo has a CODEOWNERS file with resolves handles.
2. Run `mole-tools --merge-request` on a branch with commits and push access.
3. Accept the generated MR content.
4. Note that no reviewer selection UI appears.
5. Check final summary — reviewers field is empty or missing.

## Test approach

**Test type:** integration (mock glab) + manual
**Validate with:** stub `glab mr create` and verify `--reviewer` args are passed for each user-selected handle; manual test in a real repo with CODEOWNERS to confirm multi-select renders.

## Implementation notes

- Check whether the reviewer suggestion code path is reachable (imports, feature flag, early return).
- May be caused by CODEOWNERS not being found or handles resolving to an empty list — verify fallback pool logic still triggers the UI with at least recent authors as candidates.
- Multi-select rendering depends on Ink's `SelectableList`; confirm it's imported and conditionally rendered in the MR flow state machine.

## Out of scope

- Touch-score algorithm correctness (that's a separate concern; we only need the UI to appear).
