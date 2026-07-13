# mole-tools — Registry-backed Help Feature Spec

**Status:** Draft / grilled
**Date:** 2026-07-10
**Author:** Daniel Oxer + AI Assistant
**Related context:** [../CONTEXT.md](../CONTEXT.md), [../docs/adr/0001-registry-backed-plain-help.md](../docs/adr/0001-registry-backed-plain-help.md), [architecture/code-design.md](architecture/code-design.md)

## 1. Problem

`mole-tools` now has multiple user-facing tools, but the user has to know their names ahead of time. The existing `cac`-generated `--help` output is useful as a command summary, but it does not explain each tool's workflow, examples, or option meanings.

The code already has a central feature registry (`src/core/registry.ts`) and a common feature descriptor (`src/core/feature.ts`). Help should use that structure so new registered features appear automatically without a separate central help configuration.

## 2. Goals

- Add a first-class help command:
  - `mole-tools help`
  - `mole-tools help <command>`
- List all available registered tools from the feature registry.
- Show command-specific usage, examples, notes, and options.
- Infer option names from each feature's zod args schema.
- Read option descriptions from zod `.describe(...)` metadata.
- Read option examples from zod `.meta({ examples: [...] })` metadata.
- Allow optional command-level help metadata colocated with the feature.
- Keep help available before config exists.
- Print deterministic plain text to stdout.

## 3. Non-goals

- No Ink/TUI rendering for help.
- No config loading for help.
- No feature execution from help.
- No hidden/internal command filtering yet; list all available registered tools.
- No flag aliasing or case normalization. Document actual current flags, including camelCase flags such as `--baseDir`.
- Do not replace `mole-tools --help`; standard `cac` help remains available.

## 4. User behavior

### 4.1 General help

Command:

```bash
mole-tools help
```

Expected behavior:

- exits `0`
- does not load `~/.config/mole-tools/config.json`
- does not mount Ink
- prints every entry from `features`
- includes a hint for command-specific help

Example shape:

```text
mole-tools

Available tools:
  commit            Generate a commit message for staged changes
  init              Write a default config.json template
  cost-breakdown    Show a paginated cost breakdown per past session
  worktree-prune    Scan and prune extra git worktrees

Run "mole-tools help <command>" for details.
```

The exact ordering follows `src/core/registry.ts`.

### 4.2 Command-specific help

Command:

```bash
mole-tools help worktree-prune
```

Expected behavior:

- exits `0`
- prints command name and one-line description
- prints `feature.help.usage` when provided
- prints options inferred from zod args
- prints option descriptions/examples from zod metadata
- prints command-level examples and notes when provided

Example shape:

```text
mole-tools worktree-prune

Scan and prune extra git worktrees

Usage:
  mole-tools worktree-prune [--baseDir <path>]

Options:
  --baseDir <value>
      Directory to scan recursively for git repositories with extra worktrees.
      Example: ~/dev

Examples:
  mole-tools worktree-prune --baseDir ~/dev

Notes:
  If omitted, uses worktreePrune.baseDir from config or prompts to save one.
```

### 4.3 Unknown command

Command:

```bash
mole-tools help frobnicate
```

Expected behavior:

- exits non-zero
- prints a typo-visible error
- lists valid command names
- does not fall back to general help

Example shape:

```text
Unknown command "frobnicate".

Available commands:
  commit
  init
  cost-breakdown
  worktree-prune
```

## 5. Domain model and code model

### 5.1 Feature help metadata

Extend `Feature` with optional command-level docs:

```ts
export interface FeatureHelp {
	usage?: string;
	examples?: string[];
	notes?: string[];
}

export interface Feature<A extends z.ZodTypeAny = z.ZodTypeAny, R = unknown> {
	name: string;
	description: string;
	args: A;
	help?: FeatureHelp;
	run(ctx: Context, args: z.infer<A>): Promise<R>;
}
```

`help` is for command-level docs only. It should not duplicate option descriptions.

### 5.2 Zod argument metadata

Option docs live on the option schema:

```ts
const args = z.object({
	baseDir: z
		.string()
		.optional()
		.describe("Directory to scan recursively for git repositories with extra worktrees.")
		.meta({ examples: ["~/dev"] }),
});
```

The help renderer should:

- infer `--baseDir <value>` from the field name and current CLI behavior
- use `.description` when present
- use `schema.meta()?.examples` when present and array-like
- fall back to `Set <key>` only when a description is absent

### 5.3 Help command registration

`help` is special-cased in `src/index.tsx`, not added to `features` as a normal `Feature`, because normal features load config and run inside Ink.

Register it with `cac` before or alongside feature registration:

```ts
cli.command("help [command]", "Show help for available tools")
```

The action calls pure formatting helpers and writes to stdout/stderr directly.

### 5.4 Formatter location

Add pure formatting helpers under:

```text
src/features/help/format.ts
src/features/help/format.test.ts
```

The formatter accepts `Feature[]` and an optional command name. It does not import config, Ink, ports, or adapters.

## 6. Current command documentation to add

Implement this feature with full help metadata for all current registered tools:

- `commit`
- `init`
- `cost-breakdown`
- `worktree-prune`

For no-arg commands, command-specific help should say there are no options or omit the Options section consistently.

`worktree-prune` should document its actual current flag as `--baseDir`.

## 7. Acceptance criteria

### General help

```gherkin
Given the feature registry contains commit, init, cost-breakdown, and worktree-prune
When I run `mole-tools help`
Then stdout lists all four tools with their descriptions
And stdout includes `Run "mole-tools help <command>" for details.`
And the command exits 0
And config is not loaded
And Ink is not mounted
```

### Command-specific no-arg help

```gherkin
Given the `commit` feature has command-level help metadata
When I run `mole-tools help commit`
Then stdout contains `mole-tools commit`
And stdout contains `Generate a commit message for staged changes`
And stdout contains usage and examples for commit
And stdout does not invent options
And the command exits 0
```

### Command-specific option help

```gherkin
Given the `worktree-prune` feature has a `baseDir` zod arg with description and examples metadata
When I run `mole-tools help worktree-prune`
Then stdout contains `--baseDir <value>`
And stdout contains the zod description for `baseDir`
And stdout contains the zod example for `baseDir`
And the command exits 0
```

### Registry-backed generation

```gherkin
Given a new feature is added to `features`
When I run `mole-tools help`
Then the new feature appears without editing a central help list
```

### Unknown command

```gherkin
Given no registered feature named `frobnicate`
When I run `mole-tools help frobnicate`
Then stderr or stdout contains `Unknown command "frobnicate".`
And the output lists valid command names
And the command exits non-zero
```

## 8. Testing requirements

- Unit test pure formatting in `src/features/help/format.test.ts`:
  - general help formatting
  - command help with no options
  - command help with option description/example metadata
  - unknown command result
  - registry-backed inclusion using a synthetic feature list
- Add CLI-level coverage if practical for `src/index.tsx` behavior:
  - `help` path does not call `loadConfig` or `runInInk`
  - unknown command sets non-zero exit code

## 9. Open questions

None. The grilled decisions are recorded in `CONTEXT.md` and ADR 0001.
