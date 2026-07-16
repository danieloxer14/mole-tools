import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	readState,
	resetRalphDirForTesting,
	setRalphDirForTesting,
	writeState,
	writeTaskFile,
} from "../../src/features/ralph/persistence";
import { runRalphRun } from "../../src/features/ralph/run";
import type { AgentRequest, AgentResult } from "../../src/ports/llm";
import { aggregateRalphCosts } from "../../src/shared/ralph-cost";
import { CostAccountingError } from "../../src/shared/cost/errors";
import { FakeLlm } from "../fakes/FakeLlm";
import { FakeUiPort } from "../fakes/FakeUiPort";
import { fakeContext } from "../fakes/fakeContext";

const TASK = `# Project: demo\n\n## Goal\nDo it.\n\n## Deliverable\nDone.\n\n## Task checklist\n- [ ] First task\n\n## Stale-prompt guard\nGuard.\n\n## Completion gate\nGate.\n\n## Iteration protocol\nProtocol.\n`;

class LoopLlm extends FakeLlm {
	private calls = 0;
	override async runAgent(_req: AgentRequest): Promise<AgentResult> {
		const result: AgentResult = {
			ok: true,
			output: "done",
			usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" },
			usdCost: { source: "unavailable" },
		};
		if (this.calls++ === 0)
			await writeTaskFile(
				"demo",
				TASK.replace("- [ ] First task", "- [x] First task"),
			);
		return result;
	}
}

const stateFor = (overrides: Record<string, unknown> = {}) => ({
	name: "demo",
	source: "brief" as const,
	taskFile: ".ralph/demo.md",
	models: {
		init: { provider: "pi", name: "claude-sonnet-4" },
		implement: { provider: "pi", name: "claude-sonnet-4" },
		reflect: { provider: "pi", name: "claude-sonnet-4" },
	},
	iteration: 0,
	maxIterations: 3,
	reflectEvery: 0,
	active: false,
	status: "ready" as const,
	lastReflectionAt: 0,
	phase: "ready" as const,
	awaitingReview: false,
	costLedger: [],
	...overrides,
});

describe("ralph run cost ledger", () => {
	let dir = "";
	afterEach(async () => {
		resetRalphDirForTesting();
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	test("failed worker consumes an iteration and is included in totals", async () => {
		dir = await mkdtemp(join(process.cwd(), ".ralph-run-"));
		setRalphDirForTesting(dir);
		await writeTaskFile("demo", TASK);
		await writeState("demo", {
			name: "demo",
			source: "brief",
			taskFile: ".ralph/demo.md",
			models: {
				init: { provider: "pi", name: "claude-sonnet-4" },
				implement: { provider: "pi", name: "claude-sonnet-4" },
				reflect: { provider: "pi", name: "claude-sonnet-4" },
			},
			iteration: 0,
			maxIterations: 1,
			reflectEvery: 0,
			active: false,
			status: "ready",
			lastReflectionAt: 0,
			phase: "ready",
			awaitingReview: false,
			costLedger: [],
		});
		const llm = new FakeLlm({
			agentResults: [
				{
					ok: false,
					output: "",
					stderr: "worker failed",
					usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" },
				},
			],
		});
		await expect(
			runRalphRun(fakeContext({ llm, ui: new FakeUiPort() }), { name: "demo" }),
		).rejects.toThrow("Maximum iterations reached");
		const state = await readState("demo");
		expect(state.iteration).toBe(1);
		expect(state.costLedger).toHaveLength(1);
		expect(state.costLedger[0]).toMatchObject({
			provider: "pi",
			model: "claude-sonnet-4",
			phase: "implement",
			iteration: 1,
			ok: false,
		});
		expect(state.costLedger[0]?.usage).toEqual({
			inputTokens: 12,
			outputTokens: 3,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			source: "reported",
		});
		expect(aggregateRalphCosts(state.costLedger).total.usage).toMatchObject({
			inputTokens: 12,
			outputTokens: 3,
		});
	});

	test("persists workers and periodic/final reflections in order with summaries", async () => {
		dir = await mkdtemp(join(process.cwd(), ".ralph-run-"));
		setRalphDirForTesting(dir);
		await writeTaskFile("demo", TASK);
		await writeState("demo", {
			name: "demo",
			source: "brief",
			taskFile: ".ralph/demo.md",
			models: {
				init: { provider: "pi", name: "claude-sonnet-4" },
				implement: { provider: "pi", name: "claude-sonnet-4" },
				reflect: { provider: "pi", name: "claude-sonnet-4" },
			},
			iteration: 0,
			maxIterations: 3,
			reflectEvery: 1,
			active: false,
			status: "ready",
			lastReflectionAt: 0,
			phase: "ready",
			awaitingReview: false,
			costLedger: [],
		});
		const ui = new FakeUiPort();
		await runRalphRun(fakeContext({ llm: new LoopLlm(), ui }), {
			name: "demo",
		});
		const state = await readState("demo");
		expect(state.iterationSummary).toBe("");
		expect(state.costLedger.map((r) => [r.phase, r.iteration])).toEqual([
			["implement", 1],
			["reflect", 1],
			["reflect", undefined],
		]);
		expect(state.costLedger.every((r) => r.provider === "pi" && r.model === "claude-sonnet-4")).toBe(true);
		const aggregate = aggregateRalphCosts(state.costLedger);
		const finalRows = aggregate.rows.filter((row) => row.label === "Final reflection");
		expect(finalRows).toHaveLength(1);
		expect(finalRows[0]?.usage).toEqual({
			inputTokens: 100,
			outputTokens: 50,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		expect(aggregate.total.usage).toEqual({
			inputTokens: 300,
			outputTokens: 150,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		expect(
			state.costLedger.every(
				(r) => r.usage.inputTokens === 100 && r.usage.outputTokens === 50,
			),
		).toBe(true);
		expect(
			state.costLedger.every((r) => r.usdCost?.source === "estimated"),
		).toBe(true);
		expect(
			ui.transcript.some((entry) =>
				String(entry.text ?? "").includes("Iteration 1"),
			),
		).toBe(true);
		expect(
			ui.transcript.some((entry) => String(entry.text ?? "").includes("Total")),
		).toBe(true);
	});

	test("resumes with historical ledger entries without duplicating totals", async () => {
		dir = await mkdtemp(join(process.cwd(), ".ralph-run-"));
		setRalphDirForTesting(dir);
		await writeTaskFile("demo", TASK);
		const historical = {
			id: "11111111-1111-4111-8111-111111111111",
			provider: "pi",
			model: "model",
			phase: "implement" as const,
			iteration: 1,
			ok: true,
			startedAt: 1,
			completedAt: 2,
			usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" as const },
			usdCost: { amount: 0.01, source: "actual" as const },
		};
		await writeState("demo", stateFor({
			iteration: 1,
			status: "paused",
			phase: "paused",
			costLedger: [historical],
		}));
		const ui = new FakeUiPort();
		await runRalphRun(fakeContext({ llm: new LoopLlm(), ui }), { name: "demo" });
		const resumed = await readState("demo");
		expect(resumed.costLedger).toHaveLength(3);
		expect(resumed.costLedger[0]).toEqual(historical);
		expect(aggregateRalphCosts(resumed.costLedger).total.usage).toEqual({
			inputTokens: 210,
			outputTokens: 105,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		const totalBeforeSecondRun = aggregateRalphCosts(resumed.costLedger).total;
		await runRalphRun(fakeContext({ llm: new FakeLlm(), ui: new FakeUiPort() }), { name: "demo" });
		const completed = await readState("demo");
		expect(completed.costLedger).toHaveLength(3);
		expect(aggregateRalphCosts(completed.costLedger).total).toEqual(totalBeforeSecondRun);
	});

	test("pauses atomically when worker accounting fails and retains edits", async () => {
		dir = await mkdtemp(join(process.cwd(), ".ralph-run-"));
		setRalphDirForTesting(dir);
		await writeTaskFile("demo", TASK);
		await writeState("demo", stateFor());
		const llm = new FakeLlm();
		llm.runAgent = async () => {
			await writeTaskFile("demo", TASK.replace("- [ ] First task", "- [x] First task"));
			throw new CostAccountingError("/tmp/pi/session secret prompt");
		};
		await expect(runRalphRun(fakeContext({ llm, ui: new FakeUiPort() }), { name: "demo" })).rejects.toThrow("secret");
		const state = await readState("demo");
		expect(state.status).toBe("paused");
		expect(state.pauseReason).toBe("cost_accounting_failed");
		expect(state.costLedger[0]?.usdCost).toEqual({ source: "unavailable" });
		expect(state.costLedger[0]?.accountingDiagnostic).not.toContain("/tmp");
		expect(await readState("demo")).toBeDefined();
	});

	test("prints summary when already completed", async () => {
		dir = await mkdtemp(join(process.cwd(), ".ralph-run-"));
		setRalphDirForTesting(dir);
		await writeTaskFile("demo", TASK);
		await writeState("demo", stateFor({ status: "completed", phase: "completed" }));
		const ui = new FakeUiPort();
		await runRalphRun(fakeContext({ llm: new FakeLlm(), ui }), { name: "demo" });
		expect(ui.transcript.some((e) => String(e.text).includes("Total"))).toBe(true);
	});

	test("prints summary on max-iteration pause", async () => {
		dir = await mkdtemp(join(process.cwd(), ".ralph-run-"));
		setRalphDirForTesting(dir);
		await writeTaskFile("demo", TASK);
		await writeState("demo", stateFor({ maxIterations: 1 }));
		const ui = new FakeUiPort();
		await expect(runRalphRun(fakeContext({ llm: new FakeLlm({ agentResults: [{ ok: true, output: "", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" } }] }), ui }), { name: "demo" })).rejects.toThrow("Maximum iterations");
		expect(ui.transcript.filter((e) => String(e.text).includes("Total")).length).toBeGreaterThan(0);
	});

	test("prints summary on reflection failure", async () => {
		dir = await mkdtemp(join(process.cwd(), ".ralph-run-"));
		setRalphDirForTesting(dir);
		await writeTaskFile("demo", TASK.replace("- [ ] First task", "- [x] First task"));
		await writeState("demo", stateFor());
		const ui = new FakeUiPort();
		await expect(runRalphRun(fakeContext({ llm: new FakeLlm({ agentResults: [{ ok: false, output: "", stderr: "no", usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" } }] }), ui }), { name: "demo" })).rejects.toThrow("no");
		expect(ui.transcript.filter((e) => String(e.text).includes("Total")).length).toBeGreaterThan(0);
	});

	test("prints summary after Ctrl+C settles active worker", async () => {
		dir = await mkdtemp(join(process.cwd(), ".ralph-run-"));
		setRalphDirForTesting(dir);
		await writeTaskFile("demo", TASK);
		await writeState("demo", stateFor());
		let resolve!: (r: AgentResult) => void;
		const pending = new Promise<AgentResult>((r) => (resolve = r));
		const llm = new FakeLlm();
		llm.runAgent = async () => { await pending; return { ok: true, output: "", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" }, usdCost: { source: "unavailable" } }; };
		const ui = new FakeUiPort();
		const run = runRalphRun(fakeContext({ llm, ui }), { name: "demo" });
		await new Promise((r) => setTimeout(r, 10));
		process.emit("SIGINT");
		resolve({ ok: true, output: "", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" }, usdCost: { source: "unavailable" } });
		await expect(run).rejects.toThrow("interrupted");
		expect(ui.transcript.filter((e) => String(e.text).includes("Total")).length).toBeGreaterThan(0);
	});
});
