# ADR 0001: Registry-backed plain help command

- **Status:** Accepted
- **Date:** 2026-07-09

## Context

`mole-tools` exposes multiple user-facing tools through a central feature registry. The existing CLI help from `cac` lists commands, but it does not provide rich discoverability: users cannot easily see what each tool does, how to call it, or which options are available.

The architecture already defines each feature with a name, description, zod argument schema, and run function. That structure should allow help to stay synchronized as new tools are added.

## Decision

Add a first-class `help` command:

```bash
mole-tools help
mole-tools help <command>
```

The help command will be registry-backed but will not be registered as a normal `Feature`. It will be special-cased in `src/index.tsx` so it can:

- run before `mole-tools init`
- avoid config loading
- avoid mounting Ink
- print deterministic plain text to stdout
- exit non-zero for unknown command-specific help

General help lists all available registered tools. Command-specific help combines:

- feature `name`
- feature `description`
- inferred option names from the zod args object
- option descriptions and examples from zod `.describe(...)` / `.meta({ examples })`
- optional command-level `feature.help` metadata for usage, examples, and notes

`mole-tools --help` remains the standard `cac` summary. Rich generated docs live under the new `help` command.

## Consequences

- Adding a tool still requires adding it to `src/core/registry.ts`; once registered, it appears in `mole-tools help` automatically.
- Option-level docs stay with the option schema instead of a central help config.
- Command-level examples and notes are optional and colocated with each feature.
- Help output can be tested as pure formatting logic without fake ports, config, or Ink.
- Current actual flag names are documented as-is, including camelCase flags like `--baseDir`; flag aliasing is a separate future CLI ergonomics decision.
