import { describe, expect, test } from "bun:test";
import type { RalphCostRecordLike } from "./ralph-cost";
import { formatRalphCostSummary } from "./ralph-cost";

const base = (records: RalphCostRecordLike[]) =>
	formatRalphCostSummary("refactor-auth", "paused", records);

describe("Ralph cost summary formatting", () => {
	test("formats rows and totals without cache columns", () => {
		const output = base([
			{
				phase: "init",
				usage: {
					inputTokens: 1240,
					outputTokens: 890,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "reported",
				},
				usdCost: { amount: 0.01, source: "estimated" },
			},
			{
				phase: "implement",
				iteration: 1,
				usage: {
					inputTokens: 8103,
					outputTokens: 2401,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "reported",
				},
				usdCost: { amount: 0.08, source: "actual" },
			},
			{
				phase: "implement",
				iteration: 2,
				usage: {
					inputTokens: 9411,
					outputTokens: 3022,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "reported",
				},
				usdCost: { amount: 0.09, source: "estimated" },
			},
			{
				phase: "reflect",
				usage: {
					inputTokens: 1802,
					outputTokens: 650,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "reported",
				},
				usdCost: { amount: 0.02, source: "estimated" },
			},
		]);
		expect(output).toContain("Ralph cost — refactor-auth — paused");
		expect(output).toContain("Init");
		expect(output).toContain("Iteration 1");
		expect(output).toContain("Final reflection");
		expect(output).toContain("Total");
		expect(output).toContain("20,556 in");
		expect(output).toContain("6,963 out");
		expect(output).toContain("$0.20 estimated");
	});

	test("shows cache columns when cache data is available", () => {
		const output = base([
			{
				phase: "init",
				usage: {
					inputTokens: 10,
					outputTokens: 5,
					cacheReadTokens: 3,
					cacheWriteTokens: 2,
					source: "reported",
				},
				usdCost: { amount: 0, source: "zero" },
			},
		]);
		expect(output).toContain("cache read");
		expect(output).toContain("cache write");
		expect(output).toContain("3");
		expect(output).toContain("2");
	});

	test("retains token totals and labels unavailable USD", () => {
		const output = formatRalphCostSummary("refactor-auth", "completed", [
			{
				phase: "init",
				usage: {
					inputTokens: 1240,
					outputTokens: 890,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "reported",
				},
			},
		]);
		expect(output).toContain("Ralph cost — refactor-auth — completed");
		expect(output).toContain("1,240 in");
		expect(output).toContain("890 out");
		expect(output).toContain("USD unavailable");
	});
});
