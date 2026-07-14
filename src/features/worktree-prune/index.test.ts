import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../adapters/config/schema";
import * as loader from "../../adapters/config/loader";
import { FakeUiPort } from "../../../test/fakes/FakeUiPort";
import { fakeContext } from "../../../test/fakes/fakeContext";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import { resolveBaseDir, runWorktreePrune } from "./index";

let dir: string;

function makeConfig(overrides?: Partial<Config>): Config {
	const base: Config = {
		providers: {},
		models: {
			commit: { provider: "ollama", name: "qwen3.6" },
			mergeRequest: { provider: "ollama", name: "qwen3.6" },
			ralph: {
				init: { provider: "ollama", name: "qwen3.6" },
				implement: { provider: "ollama", name: "qwen3.6" },
				reflect: { provider: "ollama", name: "qwen3.6" },
			},
		},
		jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
		diff: { ignore: [] },
	};
	return { ...base, ...overrides };
}

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("runWorktreePrune — base-dir resolution", () => {
	test("prompts via editText and persists the answer when no flag and no config exist", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-"));
		const promptedPath = join(dir, "prompted-base");

		// Spy on updateConfig to verify persistence call
		let persistArgs: string | undefined;
		spyOn(loader, "updateConfig").mockImplementation(async (_partial) => {
			persistArgs = (
				_partial as { worktreePrune?: { baseDir: string } }
			)?.worktreePrune?.baseDir;
		});

		const ui = new FakeUiPort([{ editText: promptedPath }]);
		const config = makeConfig(); // no worktreePrune.baseDir
		const ctx = fakeContext({ config, ui, vcs: new FakeVcs() });

		const result = await runWorktreePrune(ctx, {});

		expect(result.baseDir).toBe(promptedPath);
		expect(ui.transcript).toContainEqual(
			expect.objectContaining({ kind: "editText" }),
		);
		expect(persistArgs).toBe(promptedPath);
	});

	test("--baseDir overrides config without prompting or persisting", async () => {
		const cliPath = "/cli/override";
		const configPath = "/config/path";
		let persistenceCalled = false;
		spyOn(loader, "updateConfig").mockImplementation(async () => {
			persistenceCalled = true;
		});

		const ui = new FakeUiPort();
		const config = makeConfig({ worktreePrune: { baseDir: configPath } });
		const ctx = fakeContext({ config, ui, vcs: new FakeVcs() });

		const result = await runWorktreePrune(ctx, { baseDir: cliPath });

		expect(result.baseDir).toBe(cliPath);
		// No interactive prompts (editText/select/multiSelect/confirm) — just the info report
		interactiveCalls(ui.transcript);
		expect(interactiveEntryCount(ui.transcript)).toBe(0);
		expect(persistenceCalled).toBe(false); // CLI flag never persisted
	});

	test("saved config is used directly without prompting", async () => {
		const configPath = "/saved/config/path";
		let persistenceCalled = false;
		spyOn(loader, "updateConfig").mockImplementation(async () => {
			persistenceCalled = true;
		});

		const ui = new FakeUiPort(); // would fail if prompt was needed
		const config = makeConfig({ worktreePrune: { baseDir: configPath } });
		const ctx = fakeContext({ config, ui, vcs: new FakeVcs() });

		const result = await runWorktreePrune(ctx, {});

		expect(result.baseDir).toBe(configPath);
		// No interactive prompts — just the info report
		expect(interactiveEntryCount(ui.transcript)).toBe(0);
		expect(persistenceCalled).toBe(false); // config path already exists, no persistence needed
	});
});

describe("runWorktreePrune — selection and removal", () => {
	test("prompts once per repo with path/ref choices and removes selected worktrees", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-selection-"));
		const repo = join(dir, "repo");
		const extra = join(repo, "feature");
		await mkdir(join(repo, ".git"), { recursive: true });
		const vcs = new FakeVcs({ worktrees: [
			{ path: repo, ref: "main" },
			{ path: extra, ref: "feature/x" },
		] });
		const ui = new FakeUiPort([{ multiSelect: [extra] }]);
		const ctx = fakeContext({ config: makeConfig({ worktreePrune: { baseDir: dir } }), ui, vcs });

		const result = await runWorktreePrune(ctx, {});

		expect(ui.transcript.filter((entry) => entry.kind === "multiSelect")).toHaveLength(1);
		const prompt = ui.transcript.find((entry) => entry.kind === "multiSelect");
		expect((prompt?.opts as { label: string }[])[0]?.label).toContain("feature/x");
		expect(vcs.worktreeCalls).toEqual([{ path: extra, repoRoot: repo }]);
		expect(result.removals).toEqual([{ path: extra, repoRoot: repo, status: "removed" }]);
	});

	test("issues one path/ref multi-select prompt for each repository with extras", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-multi-repo-"));
		const repoA = join(dir, "repo-a");
		const repoB = join(dir, "repo-b");
		const extraA = join(repoA, "feature-a");
		const extraB = join(repoB, "feature-b");
		await mkdir(join(repoA, ".git"), { recursive: true });
		await mkdir(join(repoB, ".git"), { recursive: true });
		const vcs = new FakeVcs();
		vcs.worktrees = async (repoRoot) => repoRoot === repoA
			? [{ path: repoA, ref: "main" }, { path: extraA, ref: "feature/a" }]
			: [{ path: repoB, ref: "main" }, { path: extraB, ref: "feature/b" }];
		const ui = new FakeUiPort([
			{ multiSelect: [extraA] },
			{ multiSelect: [extraB] },
		]);
		const ctx = fakeContext({
			config: makeConfig({ worktreePrune: { baseDir: dir } }),
			ui,
			vcs,
		});

		await runWorktreePrune(ctx, {});

		const prompts = ui.transcript.filter((entry) => entry.kind === "multiSelect");
		expect(prompts).toHaveLength(2);
		expect(prompts.map((prompt) => prompt.q)).toEqual([
			expect.stringContaining(repoA),
			expect.stringContaining(repoB),
		]);
		for (const [prompt, path, ref] of [
			[prompts[0], extraA, "feature/a"],
			[prompts[1], extraB, "feature/b"],
		] as const) {
			const labels = (prompt?.opts as { label: string }[]).map((choice) => choice.label);
			expect(labels).toHaveLength(1);
			expect(labels[0]).toContain(path);
			expect(labels[0]).toContain(ref);
		}
	});

	test("does not prompt for a repository with no extra worktrees", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-no-extra-prompt-"));
		const repo = join(dir, "primary-only");
		await mkdir(join(repo, ".git"), { recursive: true });
		const vcs = new FakeVcs({ worktrees: [{ path: repo, ref: "main" }] });
		const ui = new FakeUiPort();
		const ctx = fakeContext({
			config: makeConfig({ worktreePrune: { baseDir: dir } }),
			ui,
			vcs,
		});

		const result = await runWorktreePrune(ctx, {});

		expect(result.extraWorktreeCount).toBe(0);
		expect(ui.transcript.filter((entry) => entry.kind === "multiSelect")).toHaveLength(0);
	});

	test("continues removing selected worktrees after an individual failure", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-failure-"));
		const repo = join(dir, "repo");
		await mkdir(join(repo, ".git"), { recursive: true });
		const first = join(repo, "a");
		const second = join(repo, "b");
		const vcs = new FakeVcs({
			worktrees: [{ path: repo, ref: "main" }, { path: first, ref: "a" }, { path: second, ref: "b" }],
			removeWorktreeError: new Error("busy"),
		});
		const ui = new FakeUiPort([{ multiSelect: [first, second] }, { confirm: false }, { confirm: false }]);
		const ctx = fakeContext({ config: makeConfig({ worktreePrune: { baseDir: dir } }), ui, vcs });

		const result = await runWorktreePrune(ctx, {});

		expect(vcs.worktreeCalls.map((call) => call.path)).toEqual([first, second]);
		expect(result.removals.filter((removal) => removal.status === "declined")).toHaveLength(2);
	});
});

describe("runWorktreePrune — force-delete fallback", () => {
	test("prompts individually for every normal-removal failure and names its worktree", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-fallback-"));
		const repo = join(dir, "repo");
		await mkdir(join(repo, ".git"), { recursive: true });
		const first = join(repo, "a");
		const second = join(repo, "b");
		const vcs = new FakeVcs({
			worktrees: [{ path: repo, ref: "main" }, { path: first, ref: "a" }, { path: second, ref: "b" }],
			removeWorktreeError: new Error("busy"),
		});
		const ui = new FakeUiPort([{ multiSelect: [first, second] }, { confirm: false }, { confirm: false }]);
		const ctx = fakeContext({ config: makeConfig({ worktreePrune: { baseDir: dir } }), ui, vcs });

		await runWorktreePrune(ctx, {});

		const confirms = ui.transcript.filter((entry) => entry.kind === "confirm");
		expect(confirms).toHaveLength(2);
		expect(String(confirms[0]?.q)).toContain(first);
		expect(String(confirms[1]?.q)).toContain(second);
	});

	test("displays a successful loss summary before asking to force-delete", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-summary-"));
		const repo = join(dir, "repo");
		await mkdir(join(repo, ".git"), { recursive: true });
		const extra = join(repo, "feature");
		const vcs = new FakeVcs({
			worktrees: [{ path: repo, ref: "main" }, { path: extra, ref: "feature/x" }],
			removeWorktreeError: new Error("dirty"),
			showWorktreeStatusOutput: " M important.ts",
		});
		const ui = new FakeUiPort([{ multiSelect: [extra] }, { confirm: false }]);
		const llm = new (await import("../../../test/fakes/FakeLlm")).FakeLlm({ generationAttempts: [["loses important.ts"]] });
		const ctx = fakeContext({ config: makeConfig({ worktreePrune: { baseDir: dir } }), ui, vcs, llm });

		await runWorktreePrune(ctx, {});

		const summaryIndex = ui.transcript.findIndex((entry) => entry.kind === "info" && String(entry.text).includes("loses important.ts"));
		const confirmIndex = ui.transcript.findIndex((entry) => entry.kind === "confirm");
		expect(summaryIndex).toBeGreaterThanOrEqual(0);
		expect(summaryIndex).toBeLessThan(confirmIndex);
	});

	test("asks only once when one removal fails among three", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-one-failure-"));
		const repo = join(dir, "repo");
		await mkdir(join(repo, ".git"), { recursive: true });
		const paths = ["a", "b", "c"].map((name) => join(repo, name));
		const failing = paths[1];
		const base = new FakeVcs({ worktrees: [{ path: repo, ref: "main" }, ...paths.map((path) => ({ path, ref: path.split("/").pop()! }))] });
		const vcs = Object.assign(base, {
			removeWorktree: async (path: string, repoRoot: string) => {
				base.worktreeCalls.push({ path, repoRoot });
				if (path === failing) throw new Error("busy");
			},
		});
		const ui = new FakeUiPort([{ multiSelect: paths }, { confirm: false }]);
		const ctx = fakeContext({ config: makeConfig({ worktreePrune: { baseDir: dir } }), ui, vcs });

		await runWorktreePrune(ctx, {});

		expect(ui.transcript.filter((entry) => entry.kind === "confirm")).toHaveLength(1);
	});

	test("does not retry a declined force-delete", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-decline-"));
		const repo = join(dir, "repo");
		await mkdir(join(repo, ".git"), { recursive: true });
		const extra = join(repo, "feature");
		const vcs = new FakeVcs({ worktrees: [{ path: repo, ref: "main" }, { path: extra, ref: "feature/x" }], removeWorktreeError: new Error("busy") });
		const ui = new FakeUiPort([{ multiSelect: [extra] }, { confirm: false }]);
		const ctx = fakeContext({ config: makeConfig({ worktreePrune: { baseDir: dir } }), ui, vcs });

		const result = await runWorktreePrune(ctx, {});

		expect(vcs.forceWorktreeCalls).toHaveLength(0);
		expect(result.removals[0]?.status).toBe("declined");
	});
});

describe("runWorktreePrune — final reporting", () => {
	test("reports normal, force-removed, declined, and unresolved counts separately", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-report-"));
		const repo = join(dir, "repo");
		await mkdir(join(repo, ".git"), { recursive: true });
		const paths = ["normal", "force", "declined", "unresolved"].map((name) => join(repo, name));
		const base = new FakeVcs({
			worktrees: [{ path: repo, ref: "main" }, ...paths.map((path) => ({ path, ref: path.split("/").pop()! }))],
		});
		const vcs = Object.assign(base, {
			removeWorktree: async (path: string, repoRoot: string) => {
				base.worktreeCalls.push({ path, repoRoot });
				if (path !== paths[0]) throw new Error("busy");
			},
			forceRemoveWorktree: async (path: string, repoRoot: string) => {
				base.forceWorktreeCalls.push({ path, repoRoot });
				if (path === paths[3]) throw new Error("still busy");
			},
		});
		const ui = new FakeUiPort([
			{ multiSelect: paths },
			{ confirm: true },
			{ confirm: false },
			{ confirm: true },
		]);
		const ctx = fakeContext({ config: makeConfig({ worktreePrune: { baseDir: dir } }), ui, vcs });

		await runWorktreePrune(ctx, {});

		const report = ui.transcript.find((entry) => entry.kind === "info" && String(entry.text).includes("Normal removals"));
		expect(String(report?.text)).toContain("Normal removals: 1");
		expect(String(report?.text)).toContain("Force-removed: 1");
		expect(String(report?.text)).toContain("Declined/retained: 1");
		expect(String(report?.text)).toContain("Unresolved failures: 1");
	});
});

describe("runWorktreePrune — empty-result behavior", () => {
	test("reports 'nothing to prune' and makes no VCS calls when discovery finds zero results", async () => {
		const ui = new FakeUiPort();
		const vcs = new FakeVcs();
		const config = makeConfig({ worktreePrune: { baseDir: "/empty/dir" } });
		const ctx = fakeContext({ config, ui, vcs });

		// Stubs to detect if VCS methods were called
		let worktreesCalled = false;
		vcs.worktrees = async () => { worktreesCalled = true; return []; };

		const result = await runWorktreePrune(ctx, {});

		expect(result.baseDir).toBe("/empty/dir");
		// Nothing to prune message should appear
		const infoEntry = ui.transcript.find(
			(t) => t.kind === "info" && String(t.text).toLowerCase().includes("nothing to prune"),
		);
		expect(infoEntry).toBeDefined();
		// No VCS calls should be made for the empty path
		expect(worktreesCalled).toBe(false);
	});

	test("reports nothing to prune and does not attempt VCS removals when repos have no extras", async () => {
		dir = await mkdtemp(join(tmpdir(), "mole-tools-wtprune-primary-only-"));
		const repo = join(dir, "repo");
		await mkdir(join(repo, ".git"), { recursive: true });
		const vcs = new FakeVcs({ worktrees: [{ path: repo, ref: "main" }] });
		const ui = new FakeUiPort();
		const ctx = fakeContext({
			config: makeConfig({ worktreePrune: { baseDir: dir } }),
			ui,
			vcs,
		});

		const result = await runWorktreePrune(ctx, {});

		expect(result.extraWorktreeCount).toBe(0);
		expect(ui.transcript.some((entry) =>
			entry.kind === "info" && String(entry.text).toLowerCase().includes("nothing to prune"),
		)).toBe(true);
		expect(ui.transcript.filter((entry) =>
			["multiSelect", "confirm"].includes(entry.kind),
		)).toHaveLength(0);
		expect(vcs.worktreeCalls).toHaveLength(0);
		expect(vcs.forceWorktreeCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function interactiveCalls(transcript: typeof FakeUiPort.prototype.transcript): void {
	// no-op type guard — ensures we only test against transcript type
}

/** Count entries that are interactive prompts (not info/warn/error/logs). */
function interactiveEntryCount(
	transcript: typeof FakeUiPort.prototype.transcript,
): number {
	const interactiveKinds = new Set([
		"confirm", "select", "multiSelect", "editText", "editMultiline",
	]);
	return transcript.filter((e) => interactiveKinds.has(e.kind)).length;
}
