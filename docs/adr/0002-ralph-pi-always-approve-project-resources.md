# ADR 0002: Ralph Pi adapter approves project resources

- **Status:** Accepted
- **Date:** 2026-07-12

## Context

When the configured Ralph provider is Pi, `mole-tools ralph init` asks the
provider-neutral LLM port to inspect a target repository and generate a durable
task file. Pi does not load project-local `.pi` settings, extensions, or skills
under its default non-interactive trust behavior unless its invocation supplies
`--approve` or the project has an applicable saved trust decision.

Skipping those project resources makes generated task files less representative
of the environment that a later Ralph worker will use. Conversely, approving
resources permits repository-controlled Pi extensions and settings to execute.

## Decision

Ralph agent requests express an auto-approval permission policy. `PiAdapter`
maps that policy to `--approve` for every Pi session it starts, including
task-file generation, workers, and reflections. The port and Ralph feature do
not expose the Pi-specific flag.

## Consequences

- Pi-backed Ralph sessions load target-repository Pi-local settings,
  extensions, and skills without relying on a pre-existing Pi trust record.
- Other providers map the same semantic permission policy to their own
  supported mechanism; providers without workspace-agent capability are
  rejected at preflight.
- Invoking Ralph remains an explicit trust decision by the caller; it must not
  be used on repositories whose agent resources the caller is unwilling to
  execute.
- There is no per-command trust override in the initial design. Adding one
  later would require revisiting this ADR.
