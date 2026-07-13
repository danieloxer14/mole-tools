# 03 — Task file validator

## What to build

A pure-function module that parses a Markdown task file, extracts the required sections and checklist items, validates structural integrity on both initial creation and post-worker/reflection edits, and detects illegal checkbox mutations. This is what makes safe retries (ticket 06) and reflection gates (ticket 07) possible.

## Blocked by

**01** — needs `RalphTaskFile` interface from the types module to know what a valid parse result looks like.

## Status

done

## Acceptance criteria

- [x] `parseTaskFile(rawMd: string): RalphTaskFile | ParseError` extracts required headings (`## Goal`, `## Deliverable`, `## Task checklist`, `## Stale-prompt guard`, `## Completion gate`, `## Iteration protocol`) and fails if any are missing or duplicated
- [x] Checklist extraction returns an array of `{ checked: boolean, text: string }` items parsed from `- [x]` and `- [ ]` patterns under the Task checklist heading
- [x] A parse result that has zero unchecked tasks is rejected as invalid on initial creation (spec §5.5)
- [x] `nextUncheckedTask(parsed: RalphTaskFile): { index: number; text: string } | null` returns the first unchecked item or null when fully checked
- [x] `validateCheckboxChange(before: string, after: string, selectedItem: string)` determines: (a) exactly the selected checkbox was checked and nothing else changed = success; (b) wrong checkbox changed or multiple checkboxes changed = failure with restored snapshot
- [x] All validation failures use the `RalphError` from ticket 01

## Test approach

**Test type:** unit
**Test file/area:** `src/features/ralph/validator.test.ts`
**Validate with:** `bun test src/features/ralph/validator.test.ts`

### Red-Green strategy

1. **Red**: Write tests for each validation path — valid task file with checkboxes, missing headings, duplicate headings, empty checklist, checkbox-change detection (correct single check, wrong item changed, multiple items changed)
2. **Green**: Implement `parseTaskFile`, `nextUncheckedTask`, and `validateCheckboxChange` using regex or a minimal Markdown-aware parser
3. **Refactor**: Extract regex helpers; ensure no I/O functions exist in the module — those go in ticket 04

## Implementation notes

- Place validation functions in `src/features/ralph/validator.ts`
- The Markdown parsing can be line-based regex since Ralph task files have a known, controlled structure (no nested lists or complex formatting expected in the checklist)
- Checklist items: `- [ ]` is unchecked, `- [x]` is checked (case-insensitive)
- `validateCheckboxChange` compares two full-file texts but focuses only on checklist-section checkbox state — useful for retry restoration and reflection reopening detection
- Import `RalphTaskFile` and `RalphError` from `./schema`

## Out of scope

- Reading/writing task files from disk (that's ticket 04)
- Prompt content validation (the configured provider is expected to produce conformant output; structural check only)

## Open questions

- None
