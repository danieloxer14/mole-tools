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
import { FakeLlm } from "../fakes/FakeLlm";
import { FakeUiPort } from "../fakes/FakeUiPort";
import { fakeContext } from "../fakes/fakeContext";

const TASK = `# Project: demo

## Goal
Do it.

## Deliverable
Done.

## Task checklist
- [ ] First task
- [ ] Second task

## Stale-prompt guard
Guard.

## Completion gate
Gate.

## Iteration protocol
Protocol.
`;

const stateFor = (iterationSummary = "") => ({
	name: "demo",
	source: "brief",
	taskFile: ".ralph/demo.md",
	models: {
		init: { provider: "pi", name: "model" },
		implement: { provider: "pi", name: "model" },
		reflect: { provider: "pi", name: "model" },
	},
	iteration: 0,
	maxIterations: 3,
	reflectEvery: 0,
	active: false,
	status: "ready" as const,
	lastReflectionAt: 0,
	phase: "ready" as const,
	awaitingReview: false,
	iterationSummary,
	costLedger: [],
});

const result = (output: string): AgentResult => ({
	ok: true,
	output,
	usage: {
		inputTokens: 1,
		outputTokens: 1,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		source: "reported",
	},
	usdCost: { source: "unavailable" },
});

class HandoffLlm extends FakeLlm {
	private calls = 0;

	override async runAgent(request: AgentRequest): Promise<AgentResult> {
		this.agentRequests.push(request);
		const call = this.calls++;
		if (call === 0) {
			await writeTaskFile(
				"demo",
				TASK.replace("- [ ] First task", "- [x] First task"),
			);
			return result(
				"RALPH_ITERATION_SUMMARY\nDone: first\nVerification: test one\nBlockers: none\nNext: second\nEND_RALPH_ITERATION_SUMMARY",
			);
		}
		if (call === 1) {
			await writeTaskFile(
				"demo",
				TASK.replace("- [ ] First task", "- [x] First task").replace(
					"- [ ] Second task",
					"- [x] Second task",
				),
			);
			return result(
				"RALPH_ITERATION_SUMMARY\nDone: second\nVerification: test two\nBlockers: none\nNext: review\nEND_RALPH_ITERATION_SUMMARY",
			);
		}
		return result("reflection output");
	}
}

describe("Ralph iteration handoff integration", () => {
	let dir = "";
	afterEach(async () => {
		resetRalphDirForTesting();
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	test("persists worker summaries and passes latest summary to next worker", async () => {
		dir = await mkdtemp(join(process.cwd(), ".ralph-handoff-"));
		setRalphDirForTesting(dir);
		await writeTaskFile("demo", TASK);
		await writeState("demo", stateFor());
		const llm = new HandoffLlm();

		await runRalphRun(fakeContext({ llm, ui: new FakeUiPort() }), {
			name: "demo",
		});

		expect(llm.agentRequests[0]?.prompt).toContain("(none — first iteration)");
		expect(llm.agentRequests[1]?.prompt).toContain("Done: first");
		const state = await readState("demo");
		expect(state.iterationSummary).toBe(
			"Done: second\nVerification: test two\nBlockers: none\nNext: review",
		);
		// Final reflection output cannot replace the worker summary.
		expect(state.phase).toBe("completed");
	});
});
