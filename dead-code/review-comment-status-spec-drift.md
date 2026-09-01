# Align positioned-comment status documentation

## Type
Stale documentation

## Scope
- Area: `Review analysis and conversations`
- Candidate paths: `specs/review/interactive-review.md`, `src/features/review/state.ts`, `src/features/review/routes.ts`, `src/features/review/ui/components/CommentDraft.tsx`
- Symbols/config/docs: `DraftSchema`, `sendComment`, `statusLabel`, `## 7. Positioned comment lifecycle`

## Evidence
- `specs/review/interactive-review.md:234-240` lists draft statuses as `draft`, `failed`, and `posted`, but `src/features/review/state.ts:44-52` defines `sending` as a supported persisted status.
- `src/features/review/routes.ts:1010-1016` persists `sending` before calling `GitHost.createDiscussion`; `src/features/review/routes.ts:1025-1037` changes it to `failed` on a post error, so the omitted status is observable during every in-flight send.
- `src/features/review/ui/components/CommentDraft.tsx:12-16,28,47-52,79-97` renders `Sending…`, disables edit/send while sending, and exposes Cancel during that state.
- `specs/review/interactive-review.md:253-256` says successful Send replaces the local draft with a read-only posted thread, while `src/features/review/routes.ts:1040-1053` retains the draft with `status: "posted"` and `postedDiscussionId`, and the UI merges the returned discussion separately.
- Targeted verification: `bun test src/features/review/layers.test.ts src/features/review/chat.test.ts src/features/review/comments.test.ts` passed 16 tests; broader `bun test src/features/review` passed 80 tests. No runtime changes are proposed.

## Why this is safe to change
The candidate is documentation only. Updating the maintained interactive-review specification to describe the already-implemented `sending` transition and retained posted draft does not alter state parsing, persistence, GitLab posting, SSE responses, or UI behavior. The implementation and UI are the compatibility boundary checked; no legacy runtime field or network contract is removed.

## Proposed change
1. Document `sending` alongside the other draft statuses, including its in-flight UI behavior and failure transition.
2. Change the successful Send description to state that the draft remains as a posted record with `postedDiscussionId` while the refreshed discussion appears in the read-only thread.
3. Keep `DraftSchema`, route transitions, persisted state, API responses, and component behavior unchanged.

## Acceptance criteria
- [ ] The positioned-comment lifecycle section names every supported draft status, including `sending`.
- [ ] The documented successful-send and failure transitions match route persistence and UI rendering.
- [ ] No runtime, persisted-state, or network API behavior changes.
- [ ] Targeted review comment and analysis verification passes.

## Risks and open questions
- None found after checking the state schema, route transitions, UI status rendering, API tests, and maintained review specification. The change must update only documentation.

## Assessment

- **Validated:** 2026-08-26 — `valid`
    - Live source re-checked: `sending` is a supported persisted status at `state.ts:81` (`status: z.enum(["draft","sending","posted","failed"])`); `routes.ts:1035-1041` persists `status:"sending"` immediately before `createDiscussion` (`:1045`); `markFailed` (`:978-986`) flips to `failed`+`error` on post error (`:1046-1049`); success path retains the draft as `status:"posted"`+`postedDiscussionId` after `refreshDiscussions` (`:1052-1063`); UI renders "Sending…" and disables edit while sending (`CommentDraft.tsx:13,28`). Spec still omits `sending` (`interactive-review.md:239`) and mis-describes success as "replace the draft with the posted thread" (`:256`). Discovery line refs drifted (`:44-52`→`:76-85`, `:1010-1053`→`:1035-1063`); all claims current. `bun test src/features/review/layers.test.ts src/features/review/chat.test.ts src/features/review/comments.test.ts` → 17 pass / 0 fail.
- **Product impact:** `docs` — **Priority P4**
    - Pure maintained-spec drift in `specs/review/interactive-review.md`; no runtime/config/schema/API/release consumer — whole-repo search shows only `README.md:337` cross-links the file, no code/CI/release reader. Safe to defer.
- **Verification:**
    - Removal/fix safety: `grep -rn "sending" src/features/review` confirms the status is live end-to-end (state enum, route transitions, UI label); the fix edits only the spec, so no code path changes — a diff review confirms edits stay inside `interactive-review.md`.
    - Supported behavior still works: `bun test src/features/review` (full review suite) passes; targeted `bun test src/features/review/layers.test.ts src/features/review/chat.test.ts src/features/review/comments.test.ts` → 17 pass / 0 fail.
- **Removal risk:** None found. Doc-only change; no dynamic loading, external/untracked consumer, config field, persisted-state, network/API shape, or release/installer path references the spec (whole-repo `grep -rn "interactive-review.md"` returns only `README.md:337` cross-link + the dead-code tickets). Scope note: a third stale spot the ticket's evidence omitted — API table row `interactive-review.md:117` ("…refetch discussions, and replace the draft with the posted thread") carries the same drift as `:256` and must be corrected in the same fix.

## Removal process

- [x] Temporary removal-proof test: added `test/dead-code/review-comment-status-spec-drift.test.ts`; `bun test test/dead-code/review-comment-status-spec-drift.test.ts` was RED before the spec edit and GREEN with 1 pass / 0 fail after it; deleted test after proof.
- [x] Updated only `specs/review/interactive-review.md` section `## 7. Positioned comment lifecycle`: all four statuses; `sending` persistence before `GitHost.createDiscussion`; “Sending…” UI; disabled Edit/Send; Cancel; and `failed` with error.
- [x] Corrected both successful-send descriptions at API row 117 and lifecycle lines 257-261: local draft retained as `status: "posted"` with `postedDiscussionId`, refreshed discussion rendered in read-only posted thread; no replacement claim remains.
- [x] No caller/import/config/schema/fixture/spec migration beyond the maintained spec wording; `DraftSchema`, route transitions, persisted state, SSE/API responses, and `CommentDraft.tsx` unchanged. Final diff has no runtime changes.
- [x] Retained behavior: `bun test src/features/review/layers.test.ts src/features/review/chat.test.ts src/features/review/comments.test.ts` — 17 pass / 0 fail; `bun test src/features/review` — 98 pass / 0 fail.
- [x] Final validation: scoped search for `sending`, `postedDiscussionId`, and stale replacement wording shows corrected spec plus live runtime references and no stale phrase; `bun run build` passed; `bun run lint` passed; `bun test` passed with 441 tests / 0 failures. No user-facing CLI, installer, release, or UI smoke command applied because documentation-only change has no affected runtime surface.
- [x] Compatibility/archive checks preserved: `sending` remains persisted observable state; no dynamic loading, external consumer, config field, persisted-state, network/API, release, installer, or archival boundary changed.
- [x] Execution: 2026-08-28 — committed `c91d18b` — corrected positioned-comment status and posted-draft documentation; runtime unchanged.
