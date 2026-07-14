import { describe, expect, test } from "bun:test";
import { CostTracker } from "./cost-tracker";

describe("CostTracker", () => {
	test("starts with no entries", () => {
		expect(new CostTracker().getEntries()).toEqual([]);
	});

	test("accumulates recorded entries in order", () => {
		const tracker = new CostTracker();
		tracker.record({
			type: "llm",
			task: "commit-message",
			inputTokens: 10,
			outputTokens: 5,
		});
		tracker.record({
			type: "git",
			task: "stagedDiff",
			inputTokens: 0,
			outputTokens: 20,
		});

		expect(tracker.getEntries()).toEqual([
			{
				type: "llm",
				task: "commit-message",
				inputTokens: 10,
				outputTokens: 5,
			},
			{
				type: "git",
				task: "stagedDiff",
				inputTokens: 0,
				outputTokens: 20,
			},
		]);
	});
});
