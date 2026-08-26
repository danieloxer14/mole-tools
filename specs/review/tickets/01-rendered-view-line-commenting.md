# 01 — Rendered markdown view: add per-block Tag/Comment ability

## What to build

The diff table already lets a reviewer hover a line and hit **Tag** / **Comment**
(`LineActions`, `DiscussionCard`, `CommentDraft` in
`src/features/review/ui/components/DiffView.tsx`). The **rendered** view for
markdown files (`RenderedMarkdown`/`MarkdownView`, same file) has none of that —
it's just sanitized `dangerouslySetInnerHTML` with no line or callback context.
Give each top-level rendered block (heading, paragraph, code fence, blockquote,
list, table, hr, mermaid diagram) a hover/focus-reveal **Tag** and **Comment**
affordance, matching the diff table's UX, and post the resulting comment as a
GitLab **general MR note** (unpositioned discussion) since a rendered file view
has no diff hunk/side to anchor a positioned line comment to.

## Blocked by

None — independent of the mermaid/syntax-highlight/table-squish fixes already
shipped in this file, though it touches the same functions
(`renderMarkdown`/`RenderedMarkdown`) and should rebase on top of them.

## Status

needs-design-review — the source-line mapping approach below is the
investigated design, not yet validated against every edge case (see Open
questions).

## Acceptance criteria

- [ ] Hovering (or focusing via keyboard) a rendered block in the markdown view
      reveals **Tag** and **Comment** buttons, styled/positioned like
      `.diff-table .line-actions` (reveal on `:hover`/`:focus-within`).
- [ ] **Tag** adds a markdown-block chat tag (new `ChatTag` discriminant — the
      current schema requires `side`/`hunk`, which rendered blocks don't have).
- [ ] **Comment** opens a `CommentDraft`-style editable draft anchored to
      `{ path, startLine, endLine, quote }` (no diff side/hunk).
- [ ] Sending a rendered-view comment posts a **general MR note** via
      `gitHost.createDiscussion({ ref, body })` (the existing unpositioned path
      already supported by `src/adapters/git-host/glab.ts`), with `body`
      formatted as file path + source line range + quoted block + user text.
      It must NOT attempt `buildPosition`/positioned `createDiscussion` (that
      requires diff refs a rendered file view doesn't have).
- [ ] Existing diff-table Tag/Comment flow (positioned discussions) is
      unchanged — this is an additive path, not a refactor of the diff path.
- [ ] Draft/tag actions are keyboard accessible (buttons reachable via Tab,
      visible on `:focus-within`, not only `:hover`).

## Test approach

**Test type:** Unit (pure line-mapping helper) + route/schema tests.
**Test file/area:** new pure-function tests for the block→source-line mapper;
`src/features/review/routes.test.ts` for the new unpositioned-comment branch;
`src/features/review/state.test.ts`/store tests for the new `Draft`/`ChatTag`
variants.
**Validate with:** `bun test && bun run lint && bun run build`

**Known environment gap (discovered while fixing the 3 rendered-markdown bugs
above):** `bun:test` has no DOM (no jsdom/happy-dom configured), and
`dompurify`'s default export requires one — `renderMarkdownHtml(...)` throws
`DOMPurify.sanitize is not a function` under `bun:test` for *any* input,
independent of this feature. `RenderedMarkdown`/`renderMarkdown` therefore
cannot be exercised with `renderToStaticMarkup` today. Either:
- add `happy-dom`/`jsdom` + a bun-test DOM registrar as a scoped follow-up, or
- keep the new line-mapping logic in a small pure function
  (`source: string, tokens: Token[] → BlockRange[]`) that takes no DOM/DOMPurify
  dependency and is unit-testable in isolation, and test the marked-renderer
  wiring only via the route/schema layer (payload shape), not through
  `RenderedMarkdown` itself.

### Red-Green strategy

1. **Red:** Add pure tests for the source-line mapper (headings, fences,
   duplicate/normalized `token.raw`, tables); add a route test asserting a
   rendered-view comment send calls `createDiscussion({ ref, body })` with no
   `position` field and a body containing path + line range + quote.
2. **Green:** Implement the mapper, new `ChatTag`/`Draft` variants, the new
   route branch, and the block-wrapper renderer + hover UI.
3. **Refactor:** Keep the existing diff `Draft`/`ChatTag`/`sendComment` path
   untouched; the markdown path is a sibling branch, not a shared rewrite.

## Implementation notes

- `src/shared/markdown.ts` — `renderMarkdownHtml` needs a decoration hook (or
  the caller keeps overriding `heading`/`paragraph`/`code`/`blockquote`/`list`/
  `table`/`hr`/`html` renderers, as `renderMarkdown` in `DiffView.tsx` already
  does for `code`/`html`/`table`). Add `data-source-line-start` /
  `data-source-line-end` (and a stable block id) to `ADD_ATTR` alongside the
  existing `data-mermaid-id`/`data-code-block-id`.
- `src/features/review/ui/components/DiffView.tsx` — compute each top-level
  token's source line range via a monotonic cursor:
  `source.indexOf(token.raw, cursor)` → 1-based start/end line, since marked
  16.4.2 tokens expose only `raw`/`text` (no `loc`/`startLine`). Wrap each
  renderer's output in `<div class="markdown-block" data-source-line-start="…"
  data-source-line-end="…">`; the mermaid placeholder gets the same attributes.
  Because content is `dangerouslySetInnerHTML`, wire Tag/Comment via delegated
  click handling in the existing `useEffect`, not React `onClick` props.
- `src/features/review/ui/app.css` — `.rendered-markdown .markdown-block {
  position: relative }` + `.markdown-block-actions` hidden by default, revealed
  on `:hover`/`:focus-within`, mirroring `.diff-table .line-actions`
  (~1076-1096). Check `:first-child`/`:last-child` margins on wrapped blocks.
- `src/features/review/state.ts` — current `DraftSchema` requires a diff
  `LineSelection` (`path`, `side`, `startLine`, `endLine`). Add a discriminated
  markdown/general-note draft variant: `{ path, startLine, endLine, quote,
  status, ... }`, no `side`/`hunk`.
- `src/features/review/store.ts` — current `ChatTagSchema` is strict and
  requires `side`/`hunk`. Add a `kind: "markdown"` variant carrying `path`,
  `startLine`, `endLine`, optional `quote`; update tag dedup/removal.
- `src/features/review/routes.ts` — the `/api/comments/draft` route validates
  `LineSelectionSchema`, and `sendComment` always calls `diffForDraft` +
  `buildPosition` (positioned discussion). Add a markdown-draft branch:
  validate `{ path, startLine, endLine, quote }`, and on send call
  `gitHost.createDiscussion({ ref, body })` with **no** `position`/`diffRefs` —
  this is the already-supported unpositioned path.
- `src/ports/git-host.ts` / `src/adapters/git-host/glab.ts` — confirmed:
  `UnpositionedCreateDiscussionInput { ref, body }` already exists;
  `glab.ts`'s `createDiscussion` posts body-only `POST /discussions` when no
  position is supplied. No adapter change needed.
- `src/shared/gitlab-position.ts` — confirmed incompatible with rendered
  source lines (requires exactly one old/new diff side + valid line codes);
  do not attempt to force rendered content through this contract.

## Out of scope

- Diff-table (positioned) commenting — unchanged.
- Positioned/inline GitLab line comments on rendered markdown (impossible
  without diff context; general MR notes are the only available anchor).
- The mermaid label / shiki syntax highlighting / table-squish fixes — already
  shipped separately in this file.
- Adding a jsdom/happy-dom bun-test environment — call out as a possible
  follow-up, don't bundle it into this ticket unless it turns out required to
  hit the acceptance criteria's test approach.

## Open questions

- Source-line ranges go stale if the underlying doc changes between render and
  send (MR gets updated, file re-fetched with different content). Do we
  re-validate the quoted range against current `fileContents` before posting,
  or just post best-effort with a "source may have changed" note?
- Granularity for list items / table rows: tag the whole top-level block
  (whole list, whole table) or allow per-item/per-row selection? Whole-block
  first is simpler and matches the investigated design; per-row is a likely
  follow-up ask once this ships.
- Duplicate/normalized `token.raw` (e.g. two identical one-line paragraphs)
  can collide in the `indexOf`-with-cursor mapping — confirm the conservative
  fallback (mark ambiguous blocks non-commentable) is acceptable, or require a
  more robust mapping (e.g. marked's `lexer.inlineTokens` position hooks, or
  patching in a source-map-preserving lexer option) before shipping.
