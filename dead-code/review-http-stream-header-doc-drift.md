# Correct review stream request-header documentation

## Type
Stale documentation

## Scope
- Area: `Review HTTP server and routes`
- Candidate paths: `specs/review/interactive-review.md`, `src/features/review/ui/main.tsx`, `src/features/review/sse.ts`
- Symbols/config/docs: stream request headers, `consumeChatStream`, `consumeLayerStream`, `consumeSseResponse`, SSE response content type

## Evidence
- `specs/review/interactive-review.md:90-93` states that stream POST requests use `Content-Type: text/event-stream`, while the next sentence correctly says chat and draft requests have JSON bodies.
- Chat sends `content-type: application/json` and `accept: text/event-stream` at `src/features/review/ui/main.tsx:194-202`.
- Layer requests send `accept: text/event-stream` without a request `Content-Type` at `main.tsx:325-331`; comment-send requests do the same at `:1023-1031`.
- The server sets `content-type: text/event-stream; charset=utf-8` on responses in `src/features/review/sse.ts:84-89`; this is response metadata, not the request header.
- `specs/review/interactive-review.md:99-117` and the route tests document and exercise all stream endpoints, so the drift is limited to header wording and does not indicate a dead endpoint.
- Targeted verification: `bun test src/features/review/routes.test.ts src/features/review/server.test.ts` passed 34 tests, including SSE completion and heartbeat behavior.

## Why this is safe to change
Updating the specification to distinguish request headers from SSE response headers changes no runtime behavior, route, or network API shape. The current UI and server already use the correct request/response roles; documentation is the stale artifact.

## Proposed change
1. Rewrite the stream paragraph to state that stream responses use `Content-Type: text/event-stream`; chat requests send JSON bodies with `Content-Type: application/json`, while layer and comment stream requests have no body content type.
2. Retain the `Accept: text/event-stream` behavior and JSON-body explanation for chat.
3. Re-read the endpoint table and run focused HTTP/SSE verification after the documentation-only update.

## Acceptance criteria
- [x] Specification no longer claims stream POST requests use `Content-Type: text/event-stream` as their request header.
- [x] Specification identifies SSE response content type and current chat/layer/comment request headers accurately.
- [x] No runtime code or supported endpoint behavior changes.
- [x] Focused HTTP/SSE verification passes.

## Risks and open questions
- None found for runtime compatibility. Documentation consumers may rely on the current incorrect request-header wording; correction is required to prevent malformed clients.

## Assessment

- **Validated:** 2026-08-27 — `valid`
   - Re-checked: spec `specs/review/interactive-review.md:90-93` still conflates the request `Content-Type` with the SSE response content type. Runtime is correct: chat `main.tsx:196-205` sends `content-type: application/json` + `accept: text/event-stream`; layer `main.tsx:327-333` and comment-send `main.tsx:1077-1086` send `accept: text/event-stream` with no request content-type; server `sse.ts:84-89` sets response `content-type: text/event-stream; charset=utf-8`. `bun test src/features/review/routes.test.ts src/features/review/server.test.ts` → 34 pass / 0 fail. Note: the ticket's evidence line pointers drifted — chat now `196-205` (was `194-202`), layer `327-333` (was `325-331`), comment-send `1077-1086` (was `1023-1031`, which now falls inside `updateCommentDraft`'s `.catch`); drift claim still holds.
- **Product impact:** `docs` — **Priority P4**
   - Pure prose drift in the maintained spec `specs/review/interactive-review.md`; the actual request/response header roles are already correct in `main.tsx`/`sse.ts`, so only the spec wording is stale. No runtime, config, API-shape, or release surface touched. Safe to defer.
- **Verification:**
   - Fix/proof safe: `grep -rn "text/event-stream" specs/ src/features/review` shows the only spec occurrence is the drifted paragraph at `interactive-review.md:90`; the fix edits only that paragraph, and a diff review confirms edits stay inside `interactive-review.md` (same docs-only scope established by `review-comment-status-spec-drift.md` and `review-comment-session-doc-drift.md`).
   - Supported behavior still works: `bun test src/features/review/routes.test.ts src/features/review/server.test.ts` → 34 pass / 0 fail (covers SSE completion + heartbeat); broader `bun test src/features/review` for the full suite.
- **Removal risk:** None found after checking dynamic loading (the spec is markdown, not runtime-loaded; `consumeChatStream`/`consumeLayerStream`/`consumeSseResponse` are private module functions in `main.tsx` with a single definition each and no dynamic import), external/untracked consumers (whole-repo `grep -rn "interactive-review.md"` returns only the `README.md:337` cross-link plus the dead-code tickets; `package.json` marks the package private and the bundled UI is the sole API client), CLI options (none), config fields (none), persisted state (none), network/API shapes (the actual request/response headers are unchanged — only the prose is corrected), and release/installer paths (UI is served via Bun HTML import at `server.ts:6`; `bun build` emits one binary, no shipped UI artifact).

## Removal process

- [x] Added temporary `test/dead-code/review-http-stream-header-doc-drift.test.ts` with source assertions for request/response header roles. `bun test test/dead-code/review-http-stream-header-doc-drift.test.ts` was RED before documentation edit (`0 pass`, `1 fail`) and GREEN after edit (`1 pass`, `0 fail`); deleted temporary test after proof.
- [x] Rewrote only stream paragraph in `specs/review/interactive-review.md`: SSE `Content-Type` is documented as response metadata; chat documents JSON `Content-Type` plus `Accept`; layer/comment stream requests document `Accept` without request `Content-Type`.
- [x] Re-read endpoint table and verified `main.tsx`, `sse.ts`, routes, and SSE framing were unchanged. Scoped search confirmed corrected spec wording and runtime headers: chat sends JSON `Content-Type` plus `Accept`, layer/comment send `Accept`, and `sse.ts` sets response `text/event-stream; charset=utf-8`.
- [x] Retained behavior passed: `bun test src/features/review/routes.test.ts src/features/review/server.test.ts` → `34 pass`, `0 fail`; `bun test src/features/review` → `98 pass`, `0 fail`.
- [x] Final validation passed: `bun run build` compiled `mole-tools`; `bun run lint` checked 146 files with no fixes; `bun test` passed `442` tests across `60` files; `bun run src/index.tsx help review` printed supported review help and exited successfully. Scoped search found no obsolete request-header claim; source diff stayed confined to `specs/review/interactive-review.md`.
- [x] Preserved assessment caveats: package remains private, bundled UI remains sole repository API client, no dynamic/config/CLI/persisted-state/release paths changed, and request/response network shape remains unchanged.
