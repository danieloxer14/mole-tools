# T01 — Agent pane composer, dropdown sizing, and long-path layout

- status: done
- issues: #1, #9, #19
- priority: high
- dependencies: none

## Issue

The Agent view presents the keyboard hint as one cramped line. Long file paths and other agent content can force horizontal overflow. Agent chat dropdown text is also too large, including its menu entries.

## Image evidence

- Image #2 (606×212): agent/chat dropdown trigger text is oversized and truncated.
- Image #12 (686×552): Agent view contains long path content and cramped composer controls.

Images are embedded evidence, not repository files. Do not add image copies to the repository.

## Proposed fix

Update `src/features/review/ui/components/ChatPane.tsx` and its supporting styles:

1. Render the composer hint as two separate lines: `Enter to send` and `Shift+Enter for a new line`. Keep the current keyboard behavior and accessible textarea label unchanged.
2. Apply `min-width: 0`, `overflow-wrap: anywhere`/equivalent safe wrapping, and bounded flex children to agent message bodies, tags, file references, and dropdown labels. Paths must wrap without widening the center or chat column.
3. Reduce agent switcher trigger and menu typography to the normal small control scale. Preserve the active-chat, busy-chat, keyboard, and selection behavior.
4. Avoid changing chat state, file-reference click delegation, or composer submission semantics.

## Acceptance

- Hint displays on two visible lines in the Agent composer.
- Enter submits a non-composing draft; Shift+Enter inserts a newline; Cmd/Ctrl behavior remains unchanged.
- A path longer than the available chat width wraps inside its message/tag/menu item and does not create horizontal page scrolling.
- Dropdown trigger and menu text use the agreed smaller control size while remaining readable and accessible.

- Existing active-chat check, busy indicator, new-chat, settings, send, stop, tag removal, and file-reference behavior remain intact.

## Tests and verification

- Extend `src/features/review/ui/components/ChatPane.test.tsx` for the two-line hint, long-path wrapping classes/structure, and smaller dropdown semantic controls.
- Run focused behavior tests for `ChatPane` and `composer-keydown`.
- Launch the review UI and exercise: open switcher, select busy and inactive chats, send with Enter, insert newline with Shift+Enter, and render a deliberately long path.
- Task 1 must finish with all gates green: `bun run lint && bun run build && bun test`.

## Focused verification command

```sh
bun test src/features/review/ui/components/ChatPane.test.tsx src/features/review/ui/components/composer-keydown.test.ts
```

## Stage 1 result — 2026-09-17

- Implementation: split composer keyboard hint into two visible lines; bounded agent message cards, markdown/file references, tags, tool names, and dropdown labels with `min-width: 0` and safe wrapping; reduced chat switcher trigger/menu typography to `xs`.
- Changed files: `src/features/review/ui/components/ChatPane.tsx`, `src/features/review/ui/components/ChatPane.test.tsx`.
- Focused tests: `bun test src/features/review/ui/components/ChatPane.test.tsx src/features/review/ui/components/composer-keydown.test.ts` — 25 pass, 0 fail.
- Lint: `bun run lint` — passed.
- Build: `bun run build` — passed.
- Full tests: `bun test` — 830 pass, 0 fail.
- UI smoke: browser executable unavailable in environment. Behavioral substitute exercised through focused interactive ChatPane tests: switcher open/active/busy/inactive selection, Enter send, composer accessibility, long-path DOM wrapping evidence, and unchanged file-reference delegation.

## Stage 2 result — 2026-09-17

- Requirements reviewed: two-line hint, Enter/Shift+Enter/Cmd/Ctrl behavior, bounded wrapping, dropdown typography, active/busy/selection behavior, accessibility, and preserved chat/file-reference/composer contracts.
- Findings: none.
- Rework: none.
- Verification: reused Stage 1 focused and canonical gate evidence; no source or test changes during review.

## Final status

`done`
