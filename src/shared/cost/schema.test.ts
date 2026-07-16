import { describe, expect, test } from "bun:test";
import { costEntrySchema } from "./schema";

const usage = {
	inputTokens: 100,
	outputTokens: 50,
	cacheReadTokens: 10,
	cacheWriteTokens: 5,
	source: "reported" as const,
};

describe("normalized cost schema", () => {
	test("accepts an LLM entry with provider, model, usage, and USD cost", () => {
		const result = costEntrySchema.safeParse({
			type: "llm",
			task: "agent-run",
			provider: "pi",
			model: "claude-sonnet-4",
			providerSessionId: "session-1",
			usage,
			usdCost: { source: "actual", amount: 0.42 },
		});

		expect(result.success).toBe(true);
	});

	test("rejects legacy token-only rows", () => {
		expect(costEntrySchema.safeParse({
			type: "llm",
			task: "old",
			inputTokens: 10,
			outputTokens: 5,
		}).success).toBe(false);
	});

	test("rejects non-LLM types", () => {
		expect(costEntrySchema.safeParse({
			type: "git",
			task: "diff",
			provider: "git",
			model: "none",
			usdCost: { source: "zero", amount: 0 },
		}).success).toBe(false);
	});

	test("requires an amount for every USD outcome except unavailable", () => {
		for (const source of ["actual", "estimated", "zero"] as const) {
			expect(costEntrySchema.safeParse({
				type: "llm", task: "run", provider: "pi", model: "m", usdCost: { source },
			}).success).toBe(false);
		}
		expect(costEntrySchema.safeParse({
			type: "llm", task: "run", provider: "pi", model: "m", usdCost: { source: "unavailable" },
		}).success).toBe(true);
		expect(costEntrySchema.safeParse({
			type: "llm", task: "run", provider: "pi", model: "m", usdCost: { source: "unavailable", amount: 0 },
		}).success).toBe(false);
	});
});
