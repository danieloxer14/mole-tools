# mole-tools — Code Design & Patterns

**Status:** Grilled / agreed. No implementation yet.
**Date:** 2026-07-08
**Author:** Daniel Oxer
**Companions:** [architecture.md](./architecture.md), [../commit-tool.md](../commit-tool.md), [../merge-request-tool.md](../merge-request-tool.md)

The binding design contract for `mole-tools`: how the code is layered, how
features register and run, how third-party systems are abstracted, how the UI is
decoupled, and how it is all tested. Every new tool follows this.

---

## 1. Guiding principles (from the grill)

1. **Abstract every third party behind a port.** Features depend on interfaces
   (`IssueTracker`, `GitHost`, `Vcs`, `Llm`), never on Jira/glab/git/Ollama
   directly. Concrete adapters are swappable without touching a feature.
2. **One entry point, self-registering features.** A registry of `Feature`
   objects drives the CLI. Adding a tool = adding one entry.
3. **Linear feature flows, thin orchestration.** A feature's `run()` reads the
   story top-to-bottom. Heavy lifting is delegated: I/O to ports, transforms to
   pure functions, interaction to an async `UiPort`. UI is decoupled — the flow
   `await`s UI responses, it never renders.
4. **Testable by construction.** Ports are faked for whole-flow e2e tests; pure
   functions are unit-tested with no mocks; adapters are unit-tested by mocking
   their transport (fetch / subprocess).

---

## 2. Layered architecture

```
                 ┌──────────────────────────────────────────┐
   entry point   │  index.tsx  — cac + registry + composition │
                 └───────────────┬──────────────────────────┘
                                 │ builds Context, calls run(ctx, args)
                 ┌───────────────▼──────────────────────────┐
   features      │  features/<name>  — linear run() flow      │
                 │  + colocated pure fns                      │
                 └───┬───────────────┬───────────────┬───────┘
                     │ ports          │ pure          │ ui
        ┌────────────▼───┐   ┌────────▼──────┐  ┌─────▼─────────┐
   ports│ Vcs Llm Issue  │   │ shared/ + own │  │  UiPort       │
        │ GitHost (ifaces)│   │ pure helpers  │  │  (interface)  │
        └────────▲───────┘   └───────────────┘  └─────▲─────────┘
                 │ implements                          │ implements
        ┌────────┴───────┐                    ┌────────┴─────────┐
 adapters│ git ollama jira│                    │ Ink UiHost +     │
        │ gitlab config   │                    │ controller       │
        └────────────────┘                    └──────────────────┘
```

**Dependency rule:** features depend only on `ports/`, `shared/`, and `core/`.
`adapters/` depend on `ports/`. Nothing in `ports/`, `features/`, or `shared/`
imports an adapter. Adapters are wired only in the composition root.

---

## 3. Directory layout

```
src/
  index.tsx                 # entry: cac setup, iterate registry, per-cmd action
  app.tsx                   # mounts UiHost + runs feature.run() alongside React

  core/
    context.ts              # Context type + buildContext(config) composition root
    feature.ts              # Feature interface
    registry.ts             # features: Feature[]  (the one place to add a tool)
    errors.ts               # AbortError / UserRejectedError / PortError + handleError

  ports/                    # INTERFACES ONLY — no implementation
    ui.ts                   # UiPort
    vcs.ts                  # Vcs (git)
    llm.ts                  # Llm (Ollama-shaped, but abstract)
    issue-tracker.ts        # IssueTracker (Jira today)
    git-host.ts             # GitHost (GitLab today, GitHub later)

  adapters/                 # CONCRETE IMPLEMENTATIONS
    ui/ink/
      UiHost.tsx            # the single long-lived Ink component
      controller.ts         # current-request store (useSyncExternalStore source)
      InkUiPort.ts          # UiPort impl writing to the controller
    vcs/git.ts              # shell-out via Bun $
    llm/ollama.ts           # raw fetch → /api/generate, stream:true
    issue-tracker/jira.ts
    git-host/gitlab.ts
    config/
      schema.ts             # zod schema + Config type
      loader.ts             # load + validate + first-run template bootstrap

  shared/                   # cross-feature PURE functions (no ports, no I/O)
    diff.ts                 # filterDiff (noise globs → patch vs stat-only)
    format.ts               # checkFormat (Conventional Commits + ≤72 + blank line)
    prompt.ts               # shared prompt-assembly helpers

  features/
    commit/
      index.ts              # Feature descriptor + run(ctx, args)
      prompt.ts             # buildCommitPrompt (pure, colocated)
    merge-request/
      index.ts              # Feature descriptor + run(ctx, args)
      reviewers.ts          # rankReviewers / touch-score (pure, colocated)

test/
  fakes/                    # FakeUiPort, FakeVcs, FakeLlm, FakeIssueTracker, FakeGitHost
  features/                 # whole-flow e2e specs
  # unit specs live next to source as *.test.ts
```

---

## 4. Feature model & registration (Principle 2)

A feature is a single object exporting a descriptor and its `run()`.

```ts
// core/feature.ts
import type { z } from "zod";
import type { Context } from "./context";

export interface Feature<A extends z.ZodTypeAny = z.ZodTypeAny, R = unknown> {
  /** CLI subcommand name, e.g. "commit" */
  name: string;
  /** One-line help description */
  description: string;
  /** zod schema for this feature's args; drives cac options + validation */
  args: A;
  /** The linear flow. Receives the composed Context + validated args. */
  run(ctx: Context, args: z.infer<A>): Promise<R>;
}
```

```ts
// core/registry.ts
import { commit } from "../features/commit";
import { mergeRequest } from "../features/merge-request";

export const features: Feature[] = [commit, mergeRequest];
// Add a tool == add it here. Nothing else changes.
```

### CLI shape

- **Subcommands**, not flags: `mole-tools commit`, `mole-tools merge-request`,
  `mole-tools init`. This **supersedes** the `--commit` / `--merge-request`
  phrasing in the tool specs.
- `index.tsx` iterates `features`, registers one `cac` command per feature
  (options declared from the `args` schema), and the command action:
  1. zod-parses the argv `cac` collected → typed `args` (validation error →
     print + exit non-zero),
  2. loads + validates config, builds the `Context` (composition root),
  3. mounts the Ink `UiHost` and calls `feature.run(ctx, args)`,
  4. routes any thrown error through the central handler (§7).

```ts
// index.tsx (shape)
const cli = cac("mole-tools");
for (const f of features) {
  const cmd = cli.command(f.name, f.description);
  applyZodOptions(cmd, f.args);          // derive --flags from the schema
  cmd.action(async (raw) => {
    const args = f.args.parse(normalize(raw));
    const config = await loadConfig();   // adapters/config/loader
    await runInInk(async (ui) => {
      const ctx = buildContext({ config, ui });
      return f.run(ctx, args);
    });
  });
}
cli.help(); cli.parse();
```

### Feature composition

Features compose by calling another feature's `run()` with the **same
`Context`**. `run(ctx, args): Promise<Result>` returns a typed result the caller
inspects — no argv re-parsing on the sub-call.

```ts
// inside merge-request run(): the commit detour (spec §5.3)
if (await ctx.vcs.hasStagedChanges()) {
  const res = await commit.run(ctx, {});   // reuse, default args
  if (!res.committed) throw new AbortError("commit step aborted");
}
```

---

## 5. Context — dependency injection (Principle 1 wiring)

No DI framework. A plain `Context` is assembled once in the composition root and
passed down. Optional ports are `null` when disabled.

```ts
// core/context.ts
export interface Context {
  config: Config;              // plain, zod-validated value (NOT a port)
  ui: UiPort;                  // always present
  vcs: Vcs;                    // git, always present
  llm: Llm;                    // Ollama, always present
  issues: IssueTracker | null; // null when jira.enabled === false
  gitHost: GitHost | null;     // null until a feature needs it / provider unset
  log: Logger;
}

export function buildContext(input: { config: Config; ui: UiPort }): Context {
  const { config, ui } = input;
  return {
    config,
    ui,
    vcs: new GitAdapter(),
    llm: new OllamaAdapter(config.ollama),
    issues: config.jira.enabled ? new JiraAdapter(config.jira) : null,
    gitHost: makeGitHost(config),   // provider switch: "gitlab" → GitLabAdapter
    log: makeLogger(),
  };
}
```

- **Config is a value, not a port** — a zod-validated data object. Its *loader*
  is an adapter function; the loaded value rides on `ctx.config`.
- **Optional-port contract:** a flow that needs Jira checks `if (ctx.issues)`.
  The commit/MR specs already gate Jira on `jira.enabled` + branch match, so the
  null check is where "no ticket context, proceed" lives.
- **Provider selection** (`GitLab` now, `GitHub` later) is a switch inside
  `makeGitHost(config)` — the only place that knows the concrete host.

---

## 6. Ports catalog (Principle 1)

Cohesive, domain-level interfaces. Rich rather than one-method-per-file.

```ts
// ports/vcs.ts  — shell-out git, but abstracted
export interface Vcs {
  currentBranch(): Promise<string>;
  defaultBranch(): Promise<string>;
  hasStagedChanges(): Promise<boolean>;
  stagedDiff(): Promise<FileDiff[]>;         // raw; noise-filtering is a pure fn
  commit(message: string): Promise<{ sha: string }>;
  push(opts: { setUpstream: boolean; branch: string }): Promise<void>;
  commitsAhead(base: string): Promise<CommitMeta[]>;
  rangeDiff(base: string): Promise<FileDiff[]>;
  log(opts: LogQuery): Promise<CommitMeta[]>;
}

// ports/llm.ts  — streaming IS the interface
export interface Llm {
  /** Yields token chunks. Non-streaming callers just collect them. */
  generate(req: LlmRequest): AsyncIterable<string>;
}

// ports/issue-tracker.ts
export interface IssueTracker {
  fetchIssue(key: string): Promise<Issue>;   // { key, summary, description }
}

// ports/git-host.ts
export interface GitHost {
  currentUser(): Promise<HostUser | null>;
  findOpenMr(sourceBranch: string): Promise<{ url: string } | null>;
  resolveHandle(handle: string): Promise<HostMember | null>; // user vs group
  createMr(input: CreateMrInput): Promise<{ url: string }>;
}
```

- **Ollama shapes the `Llm` port but does not leak into it** — no `baseUrl`,
  no `/api/generate` in the interface. That detail lives in `OllamaAdapter`.
- The `Vcs` port returns **structured** data (`FileDiff[]`, `CommitMeta[]`); the
  adapter parses git's stdout, so features never touch raw text.

---

## 7. Control flow & errors (Principle 3)

Flows are **linear and fail-fast via typed throws**. No `Result`-union plumbing
threading through every step; the flow reads like the spec's ordered list.

```ts
// core/errors.ts
export class AbortError extends Error {}          // guard tripped, expected exit
export class UserRejectedError extends AbortError {} // user chose reject
export class PortError extends Error {             // infra failure
  constructor(msg: string, readonly stderr?: string, readonly code = 1) { super(msg); }
}

export async function handleError(e: unknown, ui: UiPort): Promise<number> {
  if (e instanceof UserRejectedError) return 1;   // silent-ish, non-zero
  if (e instanceof AbortError)  { await ui.error(e.message); return 1; }
  if (e instanceof PortError)   { await ui.error(e.stderr ?? e.message); return e.code; }
  await ui.error(String(e));
  return 1;
}
```

- Adapters throw `PortError` carrying **verbatim** git/glab stderr (specs demand
  verbatim surfacing). The flow doesn't catch it — the entry-point handler does,
  prints it, sets the exit code.
- User "reject" throws `UserRejectedError` from the `UiPort` call site, so the
  flow's happy path stays unbranched.
- **Only two return values a flow reasons about:** its typed success `Result`, or
  a throw. That keeps `run()` at spec-altitude.

---

## 8. UI decoupling — the async UiPort ↔ Ink bridge (Principle 3)

The flow runs **outside React**. Ink renders once and reacts to a controller.

```ts
// ports/ui.ts — fixed primitive vocabulary
export interface UiPort {
  info(text: string): Promise<void>;
  warn(text: string): Promise<void>;
  error(text: string): Promise<void>;
  confirm(q: string): Promise<boolean>;
  select<T>(q: string, opts: Choice<T>[]): Promise<T>;
  multiSelect<T>(q: string, opts: Choice<T>[]): Promise<T[]>;
  editText(prompt: string, initial: string): Promise<string>;      // prefilled
  editMultiline(prompt: string, initial: string): Promise<string>;
  /** Render tokens live as they arrive; resolve with the full text. */
  stream(source: AsyncIterable<string>, label?: string): Promise<string>;
}
```

**Mechanism:**

1. `app.tsx` calls `render(<UiHost controller={c} />)` **once**.
2. The flow starts alongside: `await feature.run(ctx, args)`.
3. Each `ctx.ui.*` call sets the controller's **single current-request slot**
   and returns a `Promise`. The flow is sequential, so exactly one request is
   ever active — no queue needed.
4. `UiHost` subscribes to the controller (React 19 `useSyncExternalStore`),
   renders the current request (a `confirm`, `select`, `editText`, `stream`…),
   and on user action calls the stored `resolve`, unblocking the flow.
5. `stream()` sets a streaming request; `UiHost` consumes the async iterable,
   appends chunks to render state live, and resolves with the accumulated text.

```ts
// adapters/ui/controller.ts (shape)
type Request =
  | { kind: "confirm"; q: string; resolve: (b: boolean) => void }
  | { kind: "select"; q: string; opts: Choice[]; resolve: (v: unknown) => void }
  | { kind: "stream"; source: AsyncIterable<string>; resolve: (s: string) => void }
  | ...;

export class UiController {
  current: Request | null = null;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = () => this.current;
  request<T>(make: (resolve: (v: T) => void) => Request): Promise<T> {
    return new Promise((resolve) => { this.current = make(resolve); this.emit(); });
  }
  private emit() { for (const l of this.listeners) l(); }
}
// InkUiPort methods are thin wrappers over controller.request(...)
```

- **Fixed vocabulary, no custom-component escape hatch.** Every screen (incl. the
  MR final summary) is composed from these primitives, so every screen is
  faked by a single `FakeUiPort`.
- The MR "final summary + draft toggle" (spec §4.14) = an `info` render of the
  assembled summary + a `confirm`/`select` for draft + confirm. No bespoke Ink
  screen needed.

---

## 9. Pure services (Principle 3 delegation)

Non-I/O logic is **pure functions**, no `ctx`, no side effects — data in, data
out. The flow orchestrates; the functions transform.

- `shared/diff.ts` → `filterDiff(files, ignoreGlobs)` → patch body vs stat-only.
- `shared/format.ts` → `checkFormat(message)` → `{ ok } | { ok: false, violations }`.
- `features/commit/prompt.ts` → `buildCommitPrompt(system, issue, diff)`.
- `features/merge-request/reviewers.ts` → `rankReviewers(changedFiles, log, codeowners, self)`.

Cross-feature helpers live in `shared/`; feature-specific ones colocate in the
feature folder. All trivially unit-tested with zero mocks.

Example of the flow reading like the spec (commit, abbreviated):

```ts
// features/commit/index.ts
export const commit: Feature<typeof args, CommitResult> = {
  name: "commit",
  description: "Generate a commit message for staged changes",
  args,
  async run(ctx, _args) {
    if (!(await ctx.vcs.hasStagedChanges())) throw new AbortError("No staged changes");

    const issue = await maybeFetchIssue(ctx);                 // uses ctx.issues, gated
    const diff  = filterDiff(await ctx.vcs.stagedDiff(), ctx.config.diff.ignore);
    const prompt = buildCommitPrompt(ctx.config.commitSystemPrompt, issue, diff);

    const message = await generateValid(ctx, prompt);         // stream + format-check + retry
    const choice  = await ctx.ui.select("Commit message", ACCEPT_EDIT_REJECT);
    const final   = choice === "edit" ? await ctx.ui.editText("Edit", message)
                  : choice === "reject" ? (() => { throw new UserRejectedError(); })()
                  : message;

    const { sha } = await ctx.vcs.commit(final);
    if (await ctx.ui.confirm("Push?")) await pushCurrent(ctx);
    return { committed: true, sha };
  },
};
```

---

## 10. Testing strategy (Principle 4)

Three tiers, each with a clean seam:

| Tier | What | How |
|------|------|-----|
| **Feature e2e** | Whole `run()` flow | Build `Context` from **fake ports** + a **scripted, recording `FakeUiPort`**; call `run()`; assert on the returned `Result`, the recorded port calls, and the UI transcript. |
| **Adapter unit** | Each adapter's request-building + response-parsing | Instantiate the real adapter but **mock its transport** (mock `fetch` for Ollama, mock the Bun `$`/subprocess for git & glab). Assert the outbound request/command is correct and the mocked response parses to the right structured value. No live network. |
| **Pure unit** | `shared/` + feature pure fns | Plain input→output assertions, no mocks. |

- `FakeUiPort` both **scripts** responses (a queued answer per interaction) and
  **records** a transcript so tests assert *what the user was shown*.
- `FakeLlm.generate()` yields scripted chunks — exercises the streaming path
  deterministically.
- Fakes throw the same `PortError`/`AbortError` types on demand, so failure-path
  acceptance criteria (Ollama down, push rejected, Jira fetch fails) are e2e-testable
  without real infra.

Example e2e seam:

```ts
const ui  = new FakeUiPort([{ select: "accept" }, { confirm: true }]);
const ctx = fakeContext({ ui, vcs: fakeVcsWithStaged(diff), llm: fakeLlm(["feat: x"]) });
const res = await commit.run(ctx, {});
expect(res).toEqual({ committed: true, sha: expect.any(String) });
expect(ui.transcript).toContainEqual({ kind: "select", q: "Commit message" });
expect(ctx.vcs.commit).toHaveBeenCalledWith("feat: x");
```

---

## 11. How to add a new tool (the whole checklist)

1. Add any new external boundary as a **port** in `ports/` (interface only).
2. Implement its **adapter** in `adapters/`; wire it into `buildContext`.
3. Create `features/<name>/index.ts` exporting a `Feature` (`name`,
   `description`, `args` zod schema, `run`). Keep `run()` linear — push logic
   into pure fns (colocated or `shared/`) and I/O into ports.
4. Register it: add to the `features` array in `core/registry.ts`.
5. Interactions go through `ctx.ui.*` primitives — no new Ink components.
6. Tests: feature e2e with fakes, adapter unit with mocked transport, pure unit
   for the new pure fns.

That is the entire surface. No entry-point edits, no router edits, no UI edits.

---

## 12. Decisions resolved trivially (not grilled)

- Language/runtime/deps fixed by [architecture.md](./architecture.md): Bun + TS,
  Ink (+ mandatory `react-devtools-core`), `cac`, `zod`, Biome, `bun test`.
- Config path `~/.config/mole-tools/config.json`, first-run template bootstrap,
  plaintext secrets — from [../commit-tool.md](../commit-tool.md) §3.
- Non-zero exit on every abort/guard — from the specs' acceptance criteria.
- One active UI request at a time (sequential flow) → controller needs a single
  current-request slot, no queue.
- Controller subscription via React 19 `useSyncExternalStore` (implementation
  detail, not a spec-level choice).
- Verbatim git/glab stderr is carried on `PortError` and surfaced by the central
  handler — satisfies the specs' "print verbatim" rules.
```
