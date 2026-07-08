# mole-tools — Architecture

**Status:** Ideation / grilled. No implementation yet.
**Date:** 2026-07-08
**Author:** Daniel Oxer
**Companion:** [commit-tool.md](./commit-tool.md)

Architecture decisions for the `mole-tools` CLI — tech stack, how it's built,
and how it's installed globally on PATH.

---

## 1. Decision summary

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Language | **TypeScript** | Matches the whole stack (studio-service, frontend-monorepo); Node already present |
| Runtime / binary | **Bun**, `bun build --compile` | Single standalone executable, closest to npm habits, built-in `$` shell + `fetch` |
| Interaction layer | **Ink (React for CLI)** | React fluency; components for select/confirm; editable-prefill via `ink-text-input`; live-streaming generation |
| Generation display | **Live streaming** | Ollama tokens rendered as produced — good feedback on slow local models |
| Git access | **Shell out to `git`** (Bun `$`) | Exact git behavior, zero deps, git always on PATH |
| Ollama access | **Raw `fetch` → `/api/generate`, `stream: true`** | Minimal deps, full control, feeds the streaming UI |
| Config validation | **zod** | Schema-validated load with precise errors |
| Arg parsing | **cac** | Clean subcommand routing, hands off to Ink |
| Lint/format | **Biome** | Single fast dep, fits lean ethos |
| Tests | **`bun test`** | Native to Bun, no extra runner |
| CLI shape | **Subcommands** | `mole-tools commit` / `merge-request` / `init` — idiomatic, scales |
| Distribution | **curl install script + GitHub Releases** | Clean install UX without cloning |
| Release build | **Manual local build + upload** | Solo/personal; no CI pipeline needed yet |
| Target platform | **macOS arm64 only** | Personal machine; no cross-compile |
| Install location | **`/usr/local/bin`** | Usually already on PATH; installer handles sudo |
| Repo | **`~/dev/mole-tools`**, hosted on **GitHub** | Dedicated repo matching project name; GitHub for Releases |

---

## 2. Why this shape

- Stated driver for a standalone CLI over the existing Claude skills: **speed +
  zero token cost** (local Ollama, no Claude round-trip). Everything leans lean.
- **Not** a stated goal: shipping a single binary to non-Node teammates. So the
  binary is a convenience (fast startup, no `node` invocation), not a
  cross-platform distribution mandate — hence macOS-arm64-only is fine.
- Ink is heavier than the lean ethos would suggest, but justified by: React
  skillset, live-streaming generation UX, and clean editable-prefill for the
  commit-message inline edit.

---

## 3. Tech stack

### Runtime: Bun + compile
- Dev: `bun run src/index.tsx`.
- Build: `bun build src/index.tsx --compile --target=bun-darwin-arm64 --outfile mole-tools`.
- Produces a single standalone executable embedding the Bun runtime — no `node`
  needed at runtime.

### Interaction: Ink
- React components render the flow: spinner/stream view → action select
  (accept / edit / reject) → inline edit (`ink-text-input`, prefilled + editable)
  → push confirm.
- **Live streaming:** consume Ollama's streaming response; append tokens to
  component state so they render as they arrive.

### Git: Bun `$` shell
- `git diff --staged`, `git rev-parse --abbrev-ref HEAD`, `git commit -F -`,
  `git push [-u origin <branch>]`, etc.
- Parse stdout/stderr; surface git errors verbatim (per commit-tool spec).

### Ollama: raw HTTP
- POST `http://localhost:11434/api/generate` (base URL from config) with
  `stream: true`.
- Read the chunked stream, feed tokens to the Ink view.
- Daemon down / model missing → mapped to the clear-error-exit behavior in the
  commit spec.

### Config: zod
- Load `~/.config/mole-tools/config.json`, validate against a zod schema,
  produce precise errors on bad/missing keys.
- Schema mirrors the config table in [commit-tool.md](./commit-tool.md).

---

## 4. CLI structure

```
mole-tools <command> [flags]

commands:
  commit          Generate a commit message for staged changes (see commit-tool.md)
  merge-request   Create a GitLab/GitHub MR  (next session)
  init            Write a default config.json template
```

- `cac` parses argv and routes to a command module.
- Each command mounts an Ink app for its interactive flow.
- Suggested layout:
  ```
  src/
    index.tsx           # cac setup + command routing
    commands/
      commit.tsx        # Ink app for commit flow
      merge-request.tsx # (later)
      init.ts           # writes config template
    lib/
      config.ts         # zod schema + loader
      git.ts            # Bun $ git wrappers
      ollama.ts         # streaming client
      jira.ts           # optional ticket fetch
      format.ts         # commit message format check
  ```

---

## 5. Distribution & install

### Build (manual, local)
1. Bump version.
2. `bun build ... --compile --target=bun-darwin-arm64 --outfile mole-tools`.
3. Create a GitHub Release for the tag, upload the `mole-tools` binary as an asset.

### Install (`install.sh`, curl-piped)
```
curl -fsSL https://raw.githubusercontent.com/<you>/mole-tools/main/install.sh | bash
```
Script responsibilities:
1. Resolve the latest release asset URL from GitHub (arm64 macOS binary).
2. Download → `chmod +x`.
3. Move to `/usr/local/bin/mole-tools` (use `sudo` only if the dir isn't
   user-writable; prompt clearly first).
4. Verify `/usr/local/bin` is on PATH; warn + print the export line if not.
5. Print installed version + a one-line "run `mole-tools init` next" hint.

### Update
- Re-run the install script (pulls latest release). No auto-update mechanism in
  scope.

---

## 6. Risks / spikes before build

1. **Ink under `bun build --compile` (HIGH) — RESOLVED, PASS.** Spiked
   ([spike-ink-bun-compile.md](./spike-ink-bun-compile.md)): `bun 1.3.14`
   compiles `ink@7.1.0` (incl. `yoga-layout`) into a working standalone
   `bun-darwin-arm64` binary, ~62.3 MB. Layout, prefilled/editable
   `TextInput`, key-driven actions, and streaming-append re-render all work
   in the compiled binary, including from a cwd with no `node_modules`.
   **Required dependency:** add `react-devtools-core` alongside `ink` —
   Bun's bundler statically resolves `ink`'s optional devtools import and
   fails to compile without it present in `node_modules`.
2. **`/usr/local/bin` permissions:** may require sudo on some setups — install
   script must detect and handle gracefully rather than fail opaquely.
3. **Ollama streaming + Ink render cadence:** ensure token-by-token state
   updates don't thrash the terminal; may need light batching.

---

## 7. Out of scope (this phase)

- Cross-platform builds (x64, Linux, Windows).
- CI/CD release pipeline (manual for now).
- Homebrew tap / npm publish.
- Auto-update.
- The merge-request command internals (next session) — but the subcommand slot,
  `cac` routing, and config keys (`ollama.mrModel`, `mrSystemPrompt`,
  `dynamicEnvRepos`, `autoReviewer`) are reserved for it.
