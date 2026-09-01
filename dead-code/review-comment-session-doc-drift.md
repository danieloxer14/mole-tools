# Correct obsolete review session persistence documentation

## Type
Stale documentation

## Scope
- Area: `Review setup and persistent state`
- Candidate paths: `docs/adr/0005-review-agent-port.md`, `CONTEXT.md`
- Symbols/config/docs: ADR 0005 §Session lifecycle steps 2, 4, and 6; `CONTEXT.md` Review session entry

## Evidence
- `docs/adr/0005-review-agent-port.md:103-111` claims one persisted `chatSessionId` and one `chat.ndjson` transcript. Current state schema `src/features/review/state.ts:92-100` keeps `chatSessionId` only as a read-only compatibility field and stores per-chat `sessionId`, `chats`, and `activeChatId`.
- `src/features/review/store.ts:175-210` reads the legacy session field at the file boundary, then `ensureChats` assigns it to the adopted chat; `src/features/review/store.ts:164-173` adopts legacy `chat.ndjson` once into `chats/legacy.ndjson`. Current transcript writes use `src/features/review/store.ts:122-143` and its per-chat `transcriptPath` helper; `src/features/review/paths.ts:47-64` exposes the corresponding path builder.
- `src/features/review/chat.ts:294-345,363-413` resolves and persists the active chat's session and appends turns through `readChat`/`appendChat`; `src/features/review/paths.ts:47-64` defines `chats/<chatId>.ndjson` as the live transcript location.
- `specs/review/interactive-review.md:281-295` documents the current multi-chat state and one-time legacy adoption, so it is the maintained reference that contradicts the ADR/CONTEXT wording.
- `docs/adr/0005-review-agent-port.md:115-117` and `CONTEXT.md:67-68` also claim comment drafts start fresh agent sessions. The implemented routes `src/features/review/routes.ts:895-915,955-1024` create empty local drafts and send user-authored bodies without invoking an agent; the maintained behavior is documented at `specs/review/interactive-review.md:232-240`.
- Scoped whole-repository search found no references to the obsolete path/session claims beyond these documentation entries. Targeted verification: `bun test src/features/review/setup.test.ts src/features/review/state.test.ts` passed 18 tests.

## Why this is safe to change
The documents describe superseded single-chat and comment-agent behavior, while the current state/store/chat implementation and maintained interactive-review specification define per-chat sessions, per-chat transcripts, one-time legacy migration, and local user-authored comment drafts. Updating documentation only does not change persisted state compatibility or runtime behavior; migration code remains required and covered by tests.

## Proposed change
1. Update ADR 0005 session-lifecycle steps 2 and 4 to describe per-chat `sessionId`/`chats` state and `chats/<chatId>.ndjson` transcripts, while explicitly documenting `chatSessionId`/`chat.ndjson` as read-only one-time migration inputs.
2. Replace ADR 0005 step 6 and the `CONTEXT.md` Review session entry with the implemented local-draft behavior; comment drafts do not run an agent or change chat session state.
3. Keep `specs/review/interactive-review.md` as the authoritative current behavior reference; do not change runtime code, persisted schema, or migration tests.

## Acceptance criteria
- [ ] ADR 0005 no longer presents legacy single-chat fields/paths as the live persistence contract.
- [ ] ADR 0005 and `CONTEXT.md` no longer claim comment drafts create agent sessions.
- [ ] Documentation matches per-chat transcript/session persistence and one-time legacy adoption in `state.ts`, `store.ts`, and `chat.ts`.
- [ ] No runtime code, adapter API, persisted-state compatibility, or comment behavior changes.
- [ ] Targeted review setup/state verification passes.

## Risks and open questions
- ADR 0005 is accepted architecture history; decide whether to amend historical wording in place with a dated correction or preserve it and add an explicit superseding note.
- None found for runtime compatibility: legacy `chatSessionId` and `chat.ndjson` remain read-only migration boundaries and are covered by setup/state tests.

## Assessment

- **Validated:** 2026-08-26 — `valid`
   - Live per-chat model re-checked: `state.ts:124-131` keeps `chatSessionId` read-only (null on write, `setup.ts:473`) alongside per-chat `chats`/`activeChatId`/`ChatMeta.sessionId`; `store.ts:150-159` `adoptLegacyChat` moves `chat.ndjson`→`chats/legacy.ndjson` once and `readStateFile:161-197` reads the legacy session at the file boundary, assigning it via `ensureChats` (`state.ts:161-183`); `appendChat`/`readChat` (`store.ts:108-143`) + `transcriptPath:56-60` + `paths.ts:64` write `chats/<chatId>.ndjson`; `chat.ts:317-422` `runChatTurn` resolves/persists the per-chat session and appends turns. Stale claims confirmed: ADR 0005 step 2 (`:106` single `chatSessionId`), step 4 (`:110-112` single `chat.ndjson`), step 6 (`:116-118` comment draft "starts a fresh agent session"), and `CONTEXT.md:64-69`; comment drafts actually create empty local drafts with no agent (`routes.ts:899-919` `commentDraft` `body:""`, `sendComment:974-1024` posts user-authored `draft.body` via `gitHost.createDiscussion`). Maintained reference `specs/review/interactive-review.md:283-295,233-257`. Whole-repo `grep 'chatSessionId|chat\.ndjson'` shows only these two docs carry the claim; every other hit is live migration/compat plumbing (`paths.ts:58`, `setup.ts:473`, `state.test.ts` adoptLegacyChat, test fixtures wiring `chatPath`). 67 review tests green.
- **Product impact:** `docs` — **Priority P4**
   - Pure documentation drift in accepted-ADR history plus glossary; no runtime/config/schema/API/release surface. Migration code is live and tested; the fix is prose-only, safe to defer.
- **Verification:**
   - Removal-safe (prose only): after edit `git diff --stat` shows only `docs/adr/0005-review-agent-port.md` + `CONTEXT.md` changed; `bun build`/typecheck unaffected; re-run `grep -n 'chatSessionId\|chat\.ndjson' docs/adr/0005-review-agent-port.md CONTEXT.md` returns no stale single-chat/single-transcript/comment-agent wording.
   - Behavior intact: `bun test src/features/review/setup.test.ts src/features/review/state.test.ts` (migration + per-chat + one-time legacy adoption) and `bun test src/features/review/chat.test.ts src/features/review/comments.test.ts src/features/review/routes.test.ts` (per-chat session/transcript + local-draft comment send) — 26 + 41 = 67 pass, 0 fail. `state.test.ts` `adoptLegacyChat` test proves `chat.ndjson`→`chats/legacy.ndjson` still works; `setup.ts:473`/`state.ts:124-129` prove `chatSessionId` read-only null-on-write.
- **Removal risk:** None found — dynamic loading/registration: none (static prose, no dynamic import); external/untracked consumers: none (internal docs, not published/contract); config fields: none; persisted state: legacy `chatSessionId`/`chat.ndjson` remain read-only migration boundaries, untouched by the fix and covered by setup/state tests; network/API shapes: unchanged (comment send via `gitHost.createDiscussion`, no agent); release/installer: private package, docs not in release bundle. Open: ADR is accepted history — decide amend-in-place-with-dated-correction vs superseding note (ticket Risks). Also sweep ADR "Alternatives considered" row `:151` ("A comment is an isolated generation request") as a fourth obsolete premise the fix should address, though it sits outside the ticket's stated step 2/4/6 + CONTEXT scope.

## Removal process

- [x] Temporary removal proof: added `test/dead-code/review-comment-session-doc-drift.test.ts`, observed RED before prose edits, then GREEN with `bun test test/dead-code/review-comment-session-doc-drift.test.ts`; deleted it after final validation.
- [x] Removed stale claims from `docs/adr/0005-review-agent-port.md` and `CONTEXT.md`: single-chat `chatSessionId`/`chat.ndjson` live persistence, comment-agent sessions, and the isolated-generation alternatives premise. No callers, imports, config, schema, fixtures, scripts, or API references required migration.
- [x] Updated ADR 0005 in place with dated correction; documented active-chat `sessionId`, per-chat `chats/<chatId>.ndjson`, one-time legacy adoption, and local user-authored comment drafts. Preserved `chatSessionId`/`chat.ndjson` migration boundaries and `specs/review/interactive-review.md` as maintained reference.
- [x] Retained behavior: `bun test src/features/review/setup.test.ts src/features/review/state.test.ts` — 26 pass; `bun test src/features/review/chat.test.ts src/features/review/comments.test.ts src/features/review/routes.test.ts` — 41 pass; `bun test src/features/review` — 98 pass.
- [x] Final validation: `bun run build` passed; `bun run lint` passed after formatting temporary proof; `bun test` passed with 442 tests; scoped stale-wording search returned no matches; `git diff --check` passed; source diff contained only the two target docs.
- [x] Compatibility and risk checks: no dynamic loading, registration, external consumer, config, persisted-state, network/API, release, or installer changes; accepted ADR handled by dated amend-in-place correction.
- [x] Execution: 2026-08-28 — committed `4c2c977` — corrected ADR 0005 and `CONTEXT.md` to per-chat persistence, explicit legacy migration, and local user-authored comment drafts; runtime unchanged.
