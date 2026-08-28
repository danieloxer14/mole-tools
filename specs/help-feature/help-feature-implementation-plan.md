# mole-tools — Help Feature Implementation Plan

## 1. Status and source documents
**Status**: Implemented
**Source Documents**:
- `../../CONTEXT.md`
- `../../docs/adr/0001-registry-backed-plain-help.md`
- `help-feature.md`

## 2. Resolved decisions
- The `help` command is registry-backed but operates outside the standard `Feature` execution lifecycle.
- Help output must be plain, deterministic text (stdout/stderr) to ensure it can be used in scripts without dependencies on the Ink UI or configuration loading.
- `mole-tools --help` will remain the default `cac`-generated command summary.
- Command-level documentation is contained within a `help` property on a feature object.
- Option-level documentation (flags) is extracted from Zod schema definitions via `.describe()` and `.meta()`.

## 3. Phase 1 — Help model + pure formatter (implemented)
**Files**:
- `src/core/feature.ts`
- `src/features/help/format.ts`
- `src/features/help/format.test.ts`

**Implemented**:
- `FeatureHelp` defines optional `usage`, `examples`, and `notes` fields.
- `Feature` accepts optional command-level help metadata.
- `formatGeneralHelp(features)` renders registered features in registry order.
- `formatCommandHelp(features, command)` renders command-specific usage, options, examples, and notes.
- Zod object keys infer option names; descriptions and examples come from schema metadata.
- Unknown commands return an error result with valid command names.

## 4. Phase 2 — Command docs and Zod option metadata (implemented)
**Files**:
- `src/features/commit/index.ts`
- `src/features/init/index.ts`
- `src/features/merge-request/index.ts`
- `src/features/worktree-prune/index.ts`
- `src/features/review/index.ts`

**Implemented**:
- All five registered features carry colocated help metadata.
- `worktree-prune` exposes `baseDir` help metadata through its Zod argument schema.

## 5. Phase 3 — Special CLI wiring (implemented)
**File**:
- `src/index.tsx`

**Implemented**:
- `help [command]` is registered as a special command path.
- General help, known-command help, and unknown-command errors route to the appropriate output and exit status.
- Help bypasses config loading, context construction, and Ink initialization.

## 6. Phase 4 — Registry/worktree alignment (implemented)
**Implemented**:
- General help consumes the feature registry, so registered features appear without a second help list.

## 7. BDD test coverage matrix
| Scenario | Expected Behavior |
| :--- | :--- |
| General help registry order | Help lists all registered tools in order of registration |
| No-arg command help | `mole-tools help` displays the full tool registry |
| Option metadata | `--baseDir` documentation includes description and examples from Zod meta |
| Synthetic feature inclusion | A mock/temporary feature proves it is picked up by the registry |
| Unknown command | Error message + valid command list provided; exit code != 0 |
| CLI Smoke: Help | `mole-tools help` outputs text correctly |
| CLI Smoke: Command help | `mole-tools help commit` outputs specific command docs |
| CLI Smoke: Invalid command | `mole-tools help frobnicate` fails as expected |
| Lifecycle Bypass | Verification that `help` does not trigger config loading or Ink UI initialization |

## 8. Validation commands
**Test Suites**:
```sh
bun test
bun test src/features/help/format.test.ts
```

**Build & Lint**:
```sh
bun run build
bun run lint
```

**Manual Smoke Tests**:
```sh
bun run src/index.tsx help
bun run src/index.tsx help commit
bun run src/index.tsx help frobnicate
```

## 9. Risks and mitigations
- **Risk: API Breaking Changes**: Modifying the `Feature` interface might impact existing feature implementations.
  - **Mitigation**: Use optional properties for all new `help` related fields to ensure backward compatibility.
- **Risk: Incomplete Documentation**: Zod schema updates might not be reflected if `.meta()` is forgotten.
  - **Mitigation**: Standardize help documentation as part of the feature definition process.

## 10. Next step
No implementation step remains. Keep this record aligned with registry-backed help behavior when command metadata changes.