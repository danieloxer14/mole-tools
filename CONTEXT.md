# mole-tools Context

This glossary captures domain language for the single `mole-tools` bounded context.

## Terms

### Feature
A user-facing tool capability represented by a `Feature` object in `src/core/feature.ts` and registered in `src/core/registry.ts`. A feature has a command name, one-line description, zod argument schema, and a `run(ctx, args)` flow.

### Registered command
A CLI command exposed to users. Most registered commands come directly from the feature registry. The `help` command is intentionally special-cased because it must run without config loading or Ink.

### Help feature
The discoverability capability that lists available tools and explains how to call each one. It is registry-backed so newly registered features appear automatically.

### Feature help metadata
Optional command-level documentation colocated on a feature. It may include usage, examples, and notes. It does not replace generated data from the feature's name, description, or zod args.

### Zod argument metadata
Descriptions and examples attached to individual zod argument schemas with `.describe(...)` and `.meta({ examples: [...] })`. This is the canonical place for option-level help text.

### Plain stdout help
Deterministic text printed directly to stdout, without mounting Ink and without loading config. Used for `mole-tools help` and `mole-tools help <command>`.
