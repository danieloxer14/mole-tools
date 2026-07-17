import { describe, expect, test } from "bun:test";
import type { LlmUsage, UsdCost } from "../ports/llm";
import {
	aggregateRalphCosts,
	deriveRalphUsdCost,
	lookupRalphModelPricing,
} from "./ralph-cost";

const usage: LlmUsage = {
	inputTokens: 1_000_000,
	outputTokens: 500_000,
	cacheReadTokens: 100_000,
	cacheWriteTokens: 50_000,
	source: "reported",
};

describe("Ralph cost aggregation", () => {
	test("groups iterations and keeps init/final reflection rows", () => {
		const result = aggregateRalphCosts([
			{
				phase: "init",
				usage: {
					inputTokens: 1,
					outputTokens: 2,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "reported",
				},
				usdCost: { amount: 1, source: "actual" },
			},
			{
				phase: "implement",
				iteration: 1,
				usage: {
					inputTokens: 3,
					outputTokens: 4,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "estimated",
				},
				usdCost: { amount: 2, source: "estimated" },
			},
			{
				phase: "reflect",
				iteration: 1,
				usage: {
					inputTokens: 5,
					outputTokens: 6,
					cacheReadTokens: 2,
					cacheWriteTokens: 1,
					source: "reported",
				},
				usdCost: { amount: 0, source: "zero" },
			},
			{
				phase: "reflect",
				usage: {
					inputTokens: 7,
					outputTokens: 8,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "reported",
				},
			},
		]);
		expect(result.rows.map((row) => row.label)).toEqual([
			"Init",
			"Iteration 1",
			"Final reflection",
		]);
		expect(result.rows[1]?.usage).toEqual({
			inputTokens: 8,
			outputTokens: 10,
			cacheReadTokens: 2,
			cacheWriteTokens: 1,
		});
		expect(result.rows[1]?.usdCost).toEqual({ amount: 2, source: "estimated" });
		expect(result.total.usage).toEqual({
			inputTokens: 16,
			outputTokens: 20,
			cacheReadTokens: 2,
			cacheWriteTokens: 1,
		});
		expect(result.total.usdCost).toBeUndefined();
	});
});

describe("Ralph pricing", () => {
	test("preserves provenance and provider session IDs in aggregates", () => {
		const result = aggregateRalphCosts([
			{
				phase: "implement",
				iteration: 2,
				providerSessionId: "sess-1",
				usage,
				usdCost: { source: "actual", amount: 1 },
			},
			{
				phase: "reflect",
				iteration: 2,
				providerSessionId: "sess-2",
				usage,
				usdCost: { source: "zero", amount: 0 },
			},
		]);
		expect(result.rows[0]?.providerSessionIds).toEqual(["sess-1", "sess-2"]);
		expect(result.rows[0]?.usdCost).toEqual({ source: "actual", amount: 1 });
	});

	test("preserves an actual provider charge", () => {
		const actual: UsdCost = { amount: 0.42, source: "actual" };
		expect(
			deriveRalphUsdCost(usage, "anthropic", "claude-sonnet-4", actual),
		).toEqual(actual);
	});
	test("catalogs local models at zero cost", () => {
		expect(deriveRalphUsdCost(usage, "ollama", "llama3.1")).toEqual({
			amount: 0,
			source: "zero",
		});
	});
	test("estimates cataloged model cost including cache rates", () => {
		const result = deriveRalphUsdCost(usage, "anthropic", "claude-sonnet-4");
		expect(result?.source).toBe("estimated");
		if (result?.source === "estimated")
			expect(result.amount).toBeCloseTo(3 + 7.5 + 0.03 + 0.1875);
	});
	test("returns unavailable for an unlisted model", () => {
		expect(lookupRalphModelPricing("cloud", "mystery-model")).toBeUndefined();
		expect(deriveRalphUsdCost(usage, "cloud", "mystery-model")).toEqual({
			source: "unavailable",
		});
	});
});
