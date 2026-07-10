# mole-tools — Help Feature Implementation Plan

## 1. Status and source documents
**Status**: Draft
**Source Documents**:
- `CONTEXT.md`
- `docs/adr/0001-registry-backed-plain-help.md`
- `specs/help-feature.md`

## 2. Resolved decisions
- The `help` command is registry-backed but operates outside the standard `Feature` execution lifecycle.
- Help output must be plain, deterministic text (stdout/stderr) to ensure it can be used in scripts without dependencies on the Ink UI or configuration loading.
- `mole-tools --help` will remain the default `cac`-generated command summary.
- Command-level documentation is contained within a `help` property on a feature object.
- Option-level documentation (flags) is extracted from Zod schema definitions via `.describe()` and `.meta()`.

## 3. Phase 1 — Help model + pure formatter
**Files**:
- `src/core/feature.ts`
- `src/features/help/format.ts`
- `src/features/help/format.test.ts`

**Tasks**:
- **Type Definition**: Define `FeatureHelp` type consisting of optional `usage` (string), `examples` (string array), and `notes` (string array).
- **Interface Extension**: Update the `Feature` interface to include an optional `help: FeatureHelp` property.
- **Formatter Implementation**: Implement pure logic in `src/features/help/format.ts`:
    - `formatGeneralHelp(features: Feature[])`: Renders a list of all registered features.
    - `formatCommandHelp(features: Feature[], command: string)`: Renders help specific to the requested command.
- **Flag Inference Engine**:
    - Map Zod object keys to flag strings (e.g., `baseDir` becomes `--baseDir <value>`).
    - Extract descriptions from `schema.description`.
    - Extract example arrays from `schema.meta()?.examples`.
    - Handle edge cases for schemas with no arguments.
- **Error Handling**: Ensure that requests for unknown commands return a non-zero exit code and provide a list of valid command names in the error output.

## 4. Phase 2 — Command docs and zod option metadata
**Files**:
- `src/features/commit/index.ts`
- `src/features/init/index.ts`
- `src/features/cost-breakdown/index.ts`
- `src/features/worktree-prune/index.ts`

**Tasks**:
- Inject help metadata into all current registered features using the new `FeatureHelp` structure.
- For the `worktree-prune` feature, implement Zod metadata for the `baseDir` option to include its flag description and usage examples via `.meta()`.

## 5. Phase 3 — Special CLI wiring
**File**:
- `src/index.tsx`

**Tasks**:
- Add a specific command parser: `cli.command("help [command]", "Show help for available tools")`.
- **Routing Logic**:
    - If no argument is provided: Output general help to stdout and exit with `0`.
    - If a known command is provided: Output command-specific help to stdout and exit with `0`.
    - If an unknown command is provided: Output error message to stderr and exit with non-zero status.
- **Lifecycle Constraint**: The `help` execution path must explicitly bypass high-level orchestration (no calls to `loadConfig`, `buildContext`, or anything that initializes the Ink runtime).

## 6. Phase 4 — Registry/worktree alignment
**Tasks**:
- Ensure any new features added to the registry are automatically included in the general help output without requiring manual updates to a central list.

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
Implement Phase 1.