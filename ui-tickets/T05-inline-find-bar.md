# T05 — Inline find-in-file control

- status: done
- issue: #15
- priority: medium
- dependencies: T04

## Issue

Find-in-file currently spreads its input, match counter, and navigation icons across separate controls. The control should be one compact inline search component with coherent spacing and alignment.

## Image evidence

- Image #7 (1365×200): find input, match count, and previous/next icons appear as a cramped toolbar group.

## Proposed fix

Update `src/features/review/ui/components/DiffView.tsx` and add a small local component only if existing primitives cannot express the layout:

1. Compose search icon, input, result counter, previous button, and next button in one inline group.
2. Keep placeholder `Find in file…`, `aria-label`, query state, match highlighting, current-match tracking, and disabled navigation behavior.
3. Preserve Cmd/Ctrl-F focus, Enter next, Shift+Enter previous, and Escape clear/blur behavior.
4. Prevent the search group from pushing the file title or other toolbar controls beyond available width.

## Acceptance

- Search input, counter, and navigation controls read visually as one inline component.
- Counter remains live and correct for zero, one, and many matches.
- Previous/next buttons are disabled when no matches exist and navigate with the same wraparound behavior.
- Keyboard shortcuts and match highlighting remain unchanged.
- No horizontal overflow is introduced by the find control.

## Tests and verification

- Extend `DiffView.test.tsx` for inline group structure, zero/multiple match counts, disabled navigation, and keyboard behavior.
- Launch the review UI, search a file with zero and multiple matches, and exercise mouse plus keyboard navigation.
- Task 1 must finish with all gates green: `bun run lint && bun run build && bun test`.

## Focused verification command

```sh
bun test src/features/review/ui/components/DiffView.test.tsx
```

## Stage 1 — Implement

- Completed 2026-09-17.
- Implementation: composed search icon, input, live counter, and previous/next navigation into one constrained `data-find-control` inline group; preserved query state, highlighting, current-match tracking, disabled navigation, wraparound, Cmd/Ctrl-F, Enter, Shift+Enter, and Escape behavior.
- Changed files: `src/features/review/ui/components/DiffView.tsx`, `src/features/review/ui/components/DiffView.test.tsx`.
- Focused verification: `bun test src/features/review/ui/components/DiffView.test.tsx` — 40 passed, 0 failed, 176 expect() calls.
- Initial canonical run exposed formatter-only lint failure in the new test helper. Ran `bunx biome format --write src/features/review/ui/components/DiffView.tsx src/features/review/ui/components/DiffView.test.tsx`; reran all gates successfully.
- Final canonical gates: `bun run lint` passed; `bun run build` passed; `bun test` passed with 849 tests and 0 failures.
- UI smoke: static interactive DOM smoke covered zero/multiple matches, disabled navigation, mouse wraparound, Cmd/Ctrl-F, Enter, Shift+Enter, and Escape. `bun run src/index.tsx help review` passed and printed review UI usage. Browser/viewport launch with a live MR was unavailable because no authenticated MR/agent runtime was available; no visual browser result claimed.

## Stage 2 — Review

- Completed 2026-09-17.
- Requirements reviewed: inline composition, zero/one/many counter behavior, live counter accessibility, disabled navigation, wraparound, Cmd/Ctrl-F, Enter, Shift+Enter, Escape, match highlighting/current tracking, keyboard focus, and width constraints.
- Findings: navigation buttons used the default 32px icon size inside a 32px clipped group, risking clipped focus rings.
- Rework: changed Previous/Next controls to `size="icon-xs"` and added an explicit `aria-live="polite"` test assertion for the live counter.
- Verification rerun after rework: focused test 40 passed; `bun run lint` passed; `bun run build` passed; `bun test` passed with 849 tests and 0 failures. Verification was not reused.

## Final status

- `done`
