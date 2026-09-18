# T04 — Review header mutually exclusive icon toggles

- status: done
- issue: #14
- priority: high
- dependencies: T03

## Issue

The review header is cramped and overflows because each view/action icon is implemented as an independent button. Related choices need a mutually exclusive icon toggle control. Checked items must render as filled orange.

## Image evidence

- Image #8 (1102×200): crowded review header controls with separate icon buttons and a checkbox.

## Proposed fix

Update the review header controls in `src/features/review/ui/components/DiffView.tsx` and supporting toggle primitives/styles:

1. Group each mutually exclusive choice into an accessible single-select toggle group. Preserve the existing group labels and state values for rendered/diff, inline/side-by-side, and whole-file/diff-only modes where applicable.
2. Use icon-only controls with accessible names/tooltips. Selected items must expose pressed/selected semantics and use a filled orange background.
3. Keep independent actions (refresh, sync, external link, approve, collapse comments, and Viewed checkbox) independent; do not force unrelated actions into one group.
4. Make the toolbar wrap or shrink safely without horizontal page scrolling. Preserve all existing keyboard shortcuts, callbacks, and disabled states.

## Acceptance

- Related view choices are mutually exclusive: selecting one deselects its sibling.
- Selected toggle has filled orange visual treatment plus `aria-pressed`/equivalent semantic state.
- Unselected, hover, focus, and disabled states remain distinguishable.
- Header fits at supported narrow widths without hiding controls or causing horizontal overflow.
- Existing view-mode, diff-mode, whole-file, viewed, and comment-collapse behavior remains unchanged.

## Tests and verification

- Extend `DiffView.test.tsx` for one-selected-at-a-time behavior, pressed state, and callback transitions.
- Add a focused keyboard interaction test if current coverage does not exercise arrow/tab navigation.
- Launch the review UI at wide and narrow viewport sizes; click each group and confirm only one option remains selected.
- Task 1 must finish with all gates green: `bun run lint && bun run build && bun test`.

## Focused verification command

```sh
bun test src/features/review/ui/components/DiffView.test.tsx
```
