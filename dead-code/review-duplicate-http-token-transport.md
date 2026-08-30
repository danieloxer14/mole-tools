# Remove duplicate review API token transport

## Type
Redundant code

## Scope
- Area: `Review HTTP server and routes`
- Candidate paths: `src/features/review/ui/main.tsx`, `src/features/review/routes.ts`, `specs/review/interactive-review.md`
- Symbols/config/docs: `apiUrl`, `hasToken`, `t` query parameter, `X-Mole-Token` header

## Evidence
- `src/features/review/ui/main.tsx:55-57` appends `t=<token>` to every API URL.
- Every UI API request also sends `X-Mole-Token`; representative calls cover state/approval/refresh at `main.tsx:75-120`, chat and layer streams at `:194-200,325-330`, comments/progress at `:871-904,944-949`, and cancel/chat/sync endpoints at `:987-989,1130-1133,1296-1301,1321-1326,1363-1368`.
- `src/features/review/routes.ts:120-125` accepts either transport, so bundled UI requests authenticate successfully with the header alone. No UI call to `apiUrl` lacks the header.
- `specs/review/interactive-review.md:85-87` explicitly documents both query and header authentication, so the server-side query path remains a supported compatibility boundary for direct clients.
- `package.json:1-5` marks the package private and the bundled UI is the only in-repository API client. Whole-repository search found no other UI/API caller requiring both credentials.
- Targeted verification: `bun test src/features/review/routes.test.ts src/features/review/server.test.ts` passed 34 tests, including token rejection and authorized server requests.

## Why this is safe to change
Bundled UI requests already carry the same token in the `X-Mole-Token` header on every API call. Removing only the UI query suffix eliminates duplicate credential transport and reduces token exposure in request URLs, while retaining server query-token support for documented direct clients and compatibility. Page startup still reads token from the review URL; only subsequent API URLs change.

## Proposed change
1. Change `apiUrl` in `src/features/review/ui/main.tsx` to leave API paths unchanged instead of appending `t`.
2. Keep `hasToken` support for both `t` and `X-Mole-Token`; keep the documented direct-client query-token behavior.
3. Update or add focused UI/request tests to assert every bundled API call uses the header and no longer duplicates the token in its URL.

## Acceptance criteria
- [ ] Bundled UI API requests authenticate with `X-Mole-Token` and do not append a duplicate `t` query parameter.
- [ ] Server requests using either documented token transport continue to work.
- [ ] No API caller loses authorization or JSON/SSE behavior.
- [ ] Targeted route/server and UI verification passes.

## Risks and open questions
- Browser tooling or undocumented scripts may inspect token-bearing API URLs; preserve server query-token support and confirm no supported caller depends on UI-generated query strings before changing `apiUrl`.
## Assessment

- **Validated:** 2026-08-26 — `valid`
     - Re-checked `apiUrl` (main.tsx:57-60) still appends `t=<token>`; all 19 UI `fetch` callsites (78,87,100,120,152,196,268,280,327,887,915,947,998,1041,1078,1184,1350,1375,1417) also set `X-Mole-Token`, and 19 `fetch(` == 19 `apiUrl` callsites + 1 def (main.tsx:57) so none bypass it; `hasToken` (routes.ts:123-129) authorizes header-alone and the auth gate (routes.ts:1221-1228) covers every `/api*`. Evidence current; the ticket's cited call lines drifted (file grew to 1660 lines) but the claim holds.
- **Product impact:** `code` — **Priority P2**
     - UI runtime credential transport (main.tsx) changes the request URL network shape; behavior-preserving security/hygiene cleanup (token leaves the URL, stays in the header). Not P1: nothing is broken and this is a local single-user 127.0.0.1 server with a per-run UUID token, so the token-in-URL leak surface is minimal. Not P3 (UI runtime plus a transport-contract change, not test/internal) and not P4 (code, not docs). P2 = the "API/network shapes" boundary.
- **Verification:**
     - Removal safe: after dropping the `t` suffix in `apiUrl`, run `bun test src/features/review/routes.test.ts src/features/review/server.test.ts src/features/review/comments.test.ts` — the server authorizes a header-only request (routes.test.ts:268 → 200, 401 at :264); add a UI test asserting `apiUrl` output contains no `t=` while the request carries `X-Mole-Token`. No existing test pins the `t` suffix (grep for `apiUrl`/`X-Mole-Token` in tests hits only the routes.test.ts header case), so nothing regresses.
     - Supported behavior after removal: keep the server query-token acceptance (`hasToken` routes.ts:126) and the startup page URL token (`server.ts:59`); exercise the review UI end-to-end (load `/api/state`, run a chat/layer stream, send a comment) confirming auth still succeeds via header, and confirm a direct client using `?t=` still passes.
- **Removal risk:** None found after checking dynamic loading (none — `apiUrl` is a private module function with a single definition, no dynamic import), external/untracked consumers (none — used only in main.tsx, no export, the bundled UI is the only runtime API client), CLI options (none), config fields (none), persisted state (none), and release/installer paths (UI is served via Bun HTML import at `server.ts:6`; `bun build` emits one binary; no shipped UI artifact). The one boundary to preserve is the network/API shape: the documented direct-client query-token path (spec `interactive-review.md:85-87`, `hasToken` routes.ts:126) and the startup URL (`server.ts:59`) MUST stay; drop only the UI's redundant suffix. Residual: historical token-in-URL logs — a reason to keep server query support (retained), not a blocker.
- **Needs investigation:** 2026-08-30 — removal iteration stopped before editing because required baseline is not green. `bun test src/features/review/routes.test.ts src/features/review/server.test.ts src/features/review/comments.test.ts` passed 37 tests with 0 failures and 164 expectations but exited 1 under the enforced 90% coverage gate (63.01% functions / 69.14% lines). `bun run build` passed. `bun run lint` passed. Full `bun test` passed 440 tests with 0 failures and 1073 expectations but exited 1 under the enforced 90% coverage gate (84.99% functions / 88.36% lines). Missing evidence: a green focused and full baseline after the coverage gate is restored or coverage is raised above 90%; no removal-proof test or source change was attempted.
## Removal process

- [x] Capture baseline before editing (2026-08-30): focused route/server/comments tests passed 37/0 with 164 expectations but exited 1 at 63.01% functions / 69.14% lines against the enforced 90% coverage gate; `bun run build` passed; `bun run lint` passed; full `bun test` passed 440/0 with 1073 expectations but exited 1 at 84.99% functions / 88.36% lines. Baseline is not green, so removal did not start.
- [ ] Add temporary `src/features/review/ui/main.test.ts` request-contract test that reads/calls private `apiUrl` with a token, asserts no `t=` in returned URL, and verifies each request still supplies `X-Mole-Token`; run `bun test src/features/review/ui/main.test.ts` and observe RED before production removal. Deferred because baseline is not green.
- [ ] Remove only the UI query transport in `src/features/review/ui/main.tsx`: change `apiUrl` so it returns the API path without appending `?t=<token>` (including preserving existing query strings correctly), and migrate every bundled UI `fetch` call to continue sending `X-Mole-Token`; do not change `hasToken`, route authentication, stream handling, page-start token parsing, or direct-client query support.
- [ ] Run `bun test src/features/review/ui/main.test.ts` again and record GREEN, proving header-only UI requests omit `t=`; keep the temporary test until the final contract coverage is established.
- [ ] Retain and extend authorization/transport coverage with `bun test src/features/review/routes.test.ts src/features/review/server.test.ts src/features/review/comments.test.ts`: verify header-only requests succeed, missing/invalid tokens remain rejected, documented `?t=` direct requests still succeed, and JSON plus SSE endpoints retain response behavior.
- [ ] Exercise bundled UI behavior through the review server: load `/api/state`, run one chat stream and one layer stream, send a comment, refresh/sync, and cancel an in-flight operation; inspect requests to confirm each carries `X-Mole-Token` without token-bearing URLs and responses remain authorized.
- [ ] Final validation: run `bun test src/features/review/routes.test.ts src/features/review/server.test.ts src/features/review/comments.test.ts src/features/review/ui/main.test.ts`, `bun run build`, `bun run lint`, and full `bun test`; smoke the supported review surface with `bun run src/index.tsx review --no-open`, exercising `/api/state`, chat/layer streams, comment send, refresh/sync, and cancellation while confirming header-only authorization. Deferred because baseline is not green.
- [ ] Risk caveat: preserve `specs/review/interactive-review.md`'s documented query-token compatibility and `server.ts` startup URL token; do not remove server-side `?t=` acceptance, alter the API auth gate, or rewrite historical logs. Check browser tooling/undocumented scripts for dependence on UI-generated query strings before release.
