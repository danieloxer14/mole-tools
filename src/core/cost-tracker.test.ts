import { describe, expect, test } from "bun:test";
import { CostTracker } from "./cost-tracker";

const entry = {
	type: "llm" as const,
	task: "agent-run",
	provider: "pi",
	model: "claude-sonnet-4",
	usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" as const },
	usdCost: { source: "actual" as const, amount: 0.1 },
};

describe("CostTracker", () => {
	test("starts with no entries", () => {
		expect(new CostTracker().getEntries()).toEqual([]);
	});

	test("accumulates normalized entries in order", () => {
		const tracker = new CostTracker();
		tracker.record(entry);
		expect(tracker.getEntries()).toEqual([entry]);
	});

	test("rejects non-normalized entries", () => {
		expect(() => new CostTracker().record({
			type: "git",
			task: "diff",
			inputTokens: 1,
			outputTokens: 2,
		} as never)).toThrow();
	});
});
