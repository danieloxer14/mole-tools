# Spike — Ink under `bun build --compile`

**Status:** DONE — PASS. Ink confirmed viable. See Outcomes below.
**Type:** Technical spike / de-risk.
**Priority:** HIGH — blocks the interaction-layer decision.
**Parent:** [architecture.md](./architecture.md) §6, risk #1.

---

## Why

The architecture picks **Ink** (React for CLI) as the interaction layer and
**Bun `--compile`** for the standalone binary. Ink depends on `yoga-layout`, a
wasm/native binding. It is **unproven** that `bun build --compile` bundles that
binding into a working standalone executable. If it doesn't, Ink is off the
table and we fall back to `@clack/prompts` + Node `readline`.

Resolve this **before** building any real feature on Ink.

---

## Goal

Prove (or disprove) that a minimal Ink app, compiled to a single Bun binary,
runs correctly when executed standalone — including layout and interactive
input.

---

## Steps

1. Scaffold a throwaway dir (e.g. `/tmp/ink-bun-spike`, not in the repo).
2. `bun init`, add deps: `ink`, `react`, and `ink-text-input`.
3. Write a minimal `app.tsx` that exercises the pieces mole-tools actually needs:
   - A `<Box>`/`<Text>` layout (forces yoga-layout).
   - A `<TextInput>` with a prefilled, editable value (the commit inline-edit need).
   - A simple select or key-driven action (accept / edit / reject stand-in).
   - A stream simulation: append characters to state on an interval to mimic
     live Ollama token rendering.
4. Run in dev first: `bun run app.tsx` — confirm it works pre-compile.
5. Compile: `bun build app.tsx --compile --target=bun-darwin-arm64 --outfile ink-spike`.
6. Run the standalone binary: `./ink-spike`.
7. Move/rename the binary and run it from a different cwd to confirm no
   reliance on local `node_modules` / relative asset paths.

---

## Acceptance criteria

- [x] `bun build --compile` completes without errors bundling `yoga-layout`.
- [x] The standalone binary launches and renders the Ink layout correctly.
- [x] `TextInput` prefilled value is editable in place (backspace/edit works).
- [x] Keyboard interaction (select/confirm) works in the compiled binary.
- [x] Streaming-append re-render is smooth, no visible corruption/flicker.
- [x] Binary runs from an arbitrary cwd with no `node_modules` present.
- [x] Note the resulting binary size (sanity check it's reasonable).

---

## Outcomes

- **PASS.** Ink confirmed. Proceed with the interaction layer as specced.

**Result details (run 2026-07-08):**

- Environment: macOS arm64, `bun 1.3.14`, `ink@7.1.0`, `react@19.2.7`,
  `ink-text-input@6.0.0`.
- `bun build app.tsx --compile --target=bun-darwin-arm64 --outfile ink-spike`
  bundled 544 modules (incl. `yoga-layout`) and compiled in ~145ms, no errors.
- **Gotcha:** the bare `ink` package's `build/devtools.js` statically imports
  the optional peer dep `react-devtools-core`. Bun's bundler resolves imports
  statically at compile time (unlike Node's runtime lazy `require`), so
  compile fails with `Could not resolve: "react-devtools-core"` unless it's
  installed as a real dependency. **Action for real implementation:** add
  `react-devtools-core` to `package.json` dependencies alongside `ink`.
- Binary size: **62.3 MB** (Mach-O 64-bit arm64, single self-contained file).
  Reasonable for a dev tool; no further slimming attempted in this spike.
- Verified via a `script`-wrapped pty (this sandbox has no real interactive
  terminal) driving synthetic keystrokes into both `bun run app.tsx` (dev)
  and the compiled `./ink-spike` binary:
  - Box/Text layout rendered correctly (yoga-layout works under compile).
  - `TextInput` prefilled value accepted character input and backspace
    in place, confirmed in both dev and compiled binary.
  - Key-driven action selection (`a`/`e`/`r`) worked in the compiled binary.
  - Interval-driven streaming-append re-rendered cleanly, no visible
    corruption across frames.
  - Copied the binary to a directory with no `node_modules` anywhere on
    the path and ran it there — launched and worked identically, confirming
    no reliance on local `node_modules` or relative asset paths.
- **Open note:** synthetic byte-level keystroke injection via `script` showed
  occasional non-deterministic dropped/merged keystrokes when multiple keys
  were sent with no delay between them (a test-harness artifact of synthetic
  input, not observed as a rendering/state corruption issue). Recommend a
  quick manual smoke test in a real terminal once the real CLI feature lands,
  but this doesn't block treating the spike as a PASS.

---

## Notes / open questions

- If it PASSES but streaming re-render thrashes the terminal, consider light
  token batching (architecture.md §6, risk #3) — but that's a tuning follow-up,
  not a spike blocker.
- Bun/Ink versions used should be pinned in the spike notes so a later failure
  can be tied to a version bump.
