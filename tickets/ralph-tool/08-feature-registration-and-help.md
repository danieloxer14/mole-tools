# 08 — Register `ralph` feature + help

## What to build

Wire the Ralph commands into the mole-tools CLI registry so they appear in `mole-tools help`, register proper command-line usage/help for both `ralph init` and `ralph run`, and document all documented behavior (source forms, kebab-case names, state locations, no-overwrite rule, continuous run mode).

## Blocked by

**05** — `ralph init` must be wired up first; help text documents both commands but only init needs to actually run. Run can be stubbed for help purposes initially if needed, though a working implementation is better from ticket 07.

## Status

completed (reviewed 2026-07-13)

## Acceptance criteria

- [x] `ralph` feature registered in `src/core/registry.ts` so it appears alongside existing features (`commit`, `init`, `cost-breakdown`, `merge-request`)
- [x] `mole-tools help` lists `ralph` with a description like "Create and run durable implementation loops"
- [x] `mole-tools help ralph` or equivalent shows subcommand usage for both `ralph init` and `ralph run` matching spec §10:

  ```
  mole-tools ralph init <name> <source> --model <model> [--maxIterations <number>] [--reflectEvery <number>]
  mole-tools ralph run <name> [--maxIterations <total>]
  ```

- [ ] Command help explains `<source>` forms (local path, URL, inline brief), kebab-case loop name constraint (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), `.ralph/` artifact locations, no-overwrite rule for `init`, and continuous mode for `run`
- [ ] Existing help tests in `src/features/help/format.test.ts` updated to include Ralph feature in test fixtures or the formatter is proven robust enough that no fixture update is needed
- [ ] Running `mole-tools ralph` with no subcommand shows a usage error listing available subcommands (`init`, `run`)

## Test approach

**Test type:** unit
**Test file/area:** `src/features/ralph/index.test.ts` (registry wiring), existing `src/features/help/format.test.ts` (help text)
**Validate with:** `bun test src/features/ralph/index.test.ts` and `bun test src/features/help/format.test.ts`

### Red-Green strategy

1. **Red**: Write tests asserting `features` in registry includes a Ralph entry; help output for unknown subcommand shows usage; help text matches expected format from spec §10
2. **Green**: Register the Ralph feature(s) in `src/core/registry.ts`; wire CLI args so subcommands route to their implementation modules
3. **Refactor**: Ensure Ralph feature registration follows existing pattern (single import, single array entry); verify help formatter handles subcommand structures correctly

## Implementation notes

- The existing CLI uses `cac` which supports subcommands; inspect how current features register and follow that pattern for Ralph's two subcommands (`init`, `run`)
- Consider whether to register `ralph` as one Feature that internally dispatches based on subcommand, or as two separate Features (`ralph-init`, `ralph-run`). Follow the existing CLI convention — if other features use a flat command model, adapt; if subcommand nesting already exists, reuse it
- Help text is defined via `Feature.help` field (spec §10): `usage`, `examples[]`, `notes[]`
- Import from `src/core/registry.ts`; export a Ralph feature object from `src/features/ralph/index.ts`
- The top-level help for `mole-tools help` already iterates `features` — adding to the array is the only wiring needed

## Out of scope

- Full Ralph runtime behavior (worker loops, reflection) — those are tickets 06 and 07. This ticket only ensures commands are discoverable and correctly routed.
- Integration testing the full command pipeline end-to-end

## Open questions

- How does `cac` handle nested subcommands in the current mole-tools setup? If it doesn't support nesting natively, we may need to parse `<name>` as a positional and dispatch from within one `ralph` feature's `run()` method. This is an implementation detail but affects test structure.
