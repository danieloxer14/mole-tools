import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRalphInit } from "../../src/features/ralph/init";
import {
	readState,
	resetRalphDirForTesting,
	setRalphDirForTesting,
} from "../../src/features/ralph/persistence";
import { FakeLlm } from "../fakes/FakeLlm";
import { FakeUiPort } from "../fakes/FakeUiPort";
import { fakeContext } from "../fakes/fakeContext";

const TASK = `# Project: demo\n\n## Goal\nDo it.\n\n## Deliverable\nDone.\n\n## References\n- brief — source\n\n## Task checklist\n### Demo ticket\n- [ ] First task\n\n## Stale-prompt guard\nGuard.\n\n## Completion gate\nGate.\n\n## Iteration protocol\nProtocol.\n`;

describe("ralph init cost ledger", () => {
	let dir = "";
	afterEach(async () => {
		resetRalphDirForTesting();
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	test("propagates a failed task-generation result without writing a ledger record", async () => {
		dir = await mkdtemp(join(tmpdir(), "ralph-init-failure-"));
		setRalphDirForTesting(dir);
		const llm = new FakeLlm({
			agentResults: [
				{
					ok: false,
					output: TASK,
					stderr: "provider failed",
					usage: {
						inputTokens: 12,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						source: "reported",
					},
				},
			],
		});

		await expect(
			runRalphInit(
				fakeContext({
					llm,
					ui: new FakeUiPort([
						{ editText: "claude-sonnet-4" },
						{ editText: "claude-sonnet-4" },
						{ editText: "claude-sonnet-4" },
					]),
				}),
				{ name: "demo", source: "brief", maxIterations: 20, reflectEvery: 5 },
			),
		).rejects.toThrow("provider failed");

		expect(
			await readFile(join(dir, "demo.state.json"), "utf8").catch(() => null),
		).toBeNull();
		expect(
			await readFile(join(dir, "demo.md"), "utf8").catch(() => null),
		).toBeNull();
	});

	test("persists one attributed init record with timestamps, usage, derived USD, and valid state", async () => {
		dir = await mkdtemp(join(tmpdir(), "ralph-init-"));
		setRalphDirForTesting(dir);
		const llm = new FakeLlm({
			agentResults: [
				{
					ok: true,
					output: TASK,
					usage: {
						inputTokens: 1000,
						outputTokens: 500,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						source: "reported",
					},
				},
			],
		});
		await runRalphInit(
			fakeContext({
				llm,
				ui: new FakeUiPort([
					{ editText: "claude-sonnet-4" },
					{ editText: "claude-sonnet-4" },
					{ editText: "claude-sonnet-4" },
				]),
			}),
			{ name: "demo", source: "brief", maxIterations: 20, reflectEvery: 5 },
		);
		const state = await readState("demo");
		expect(state.costLedger).toHaveLength(1);
		const record = state.costLedger.at(0);
		expect(record).toBeDefined();
		if (!record) throw new Error("expected an init cost record");
		expect(record.phase).toBe("init");
		expect(record.provider).toBe("pi");
		expect(record.model).toBe("claude-sonnet-4");
		expect(record.iteration).toBeUndefined();
		expect(record.ok).toBe(true);
		expect(record.completedAt).toBeGreaterThanOrEqual(record.startedAt);
		expect(record.usage).toEqual({
			inputTokens: 1000,
			outputTokens: 500,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			source: "reported",
		});
		expect(record.usdCost?.source).toBe("estimated");
		if (record.usdCost?.source === "estimated")
			expect(record.usdCost.amount).toBeCloseTo(0.0105, 8);
		expect(
			JSON.parse(await readFile(join(dir, "demo.state.json"), "utf8"))
				.costLedger,
		).toHaveLength(1);
	});
});
