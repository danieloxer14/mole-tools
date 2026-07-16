import { describe, expect, test } from "bun:test";
import type { CostEntry } from "./schema";
import {
  deriveCacheUsage,
  deriveUsdCost,
  estimateClaudeCosts,
  lookupPrice,
  sumDerivedUsage,
} from "./catalog";

const usage = {
	inputTokens: 1_000_000,
	outputTokens: 500_000,
	cacheReadTokens: 100_000,
	cacheWriteTokens: 50_000,
	source: "reported" as const,
};

describe("shared cost catalog", () => {
	test("actual USD wins over catalog derivation", () => {
		expect(deriveUsdCost(usage, "anthropic", "claude-sonnet-4", { source: "actual", amount: 0.42 })).toEqual({ source: "actual", amount: 0.42 });
	});
	test("estimates input, output, cache read, and cache write", () => {
		expect(deriveUsdCost(usage, "anthropic", "claude-sonnet-4")).toEqual({ source: "estimated", amount: 10.7175 });
	});
	test("returns zero for local providers", () => {
		expect(deriveUsdCost(usage, "ollama", "anything")).toEqual({ source: "zero", amount: 0 });
	});
	test("returns unavailable for unlisted cloud models", () => {
		expect(deriveUsdCost(usage, "cloud", "mystery")).toEqual({ source: "unavailable" });
		expect(lookupPrice("cloud", "mystery")).toBeUndefined();
	});
});
const entry = (inputTokens: number, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0): CostEntry => ({
  type: "llm",
  task: "test",
  provider: "pi",
  model: "claude-sonnet-4-5",
  usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, source: "reported" },
  usdCost: { source: "actual", amount: 0 },
});

describe("normalized catalog cache usage", () => {
  test("uses reported cache dimensions instead of inferring them", () => {
    const derived = deriveCacheUsage([entry(1_000_000, 500, 250_000, 750_000)]);
    expect(derived[0]).toMatchObject({ cacheReadTokens: 250_000, cacheWriteTokens: 750_000 });
  });

  test("aggregates all normalized usage dimensions", () => {
    const usage = sumDerivedUsage(deriveCacheUsage([
      entry(42, 10, 5, 7),
      entry(42, 8, 6, 9),
    ]));
    expect(usage).toEqual({ inputTokens: 84, outputTokens: 18, cacheReadTokens: 11, cacheWriteTokens: 16 });
  });
});

describe("catalog Claude comparison estimates", () => {
  test("prices input, output, cache reads, and cache writes", () => {
    const estimates = estimateClaudeCosts([entry(1_000_000, 0, 2_000_000, 1_000_000)]);
    expect(estimates.find((e) => e.model === "Haiku 4.5")?.cost).toBeCloseTo(2.45);
    expect(estimates.find((e) => e.model === "Sonnet 5")?.cost).toBeCloseTo(7.35);
    expect(estimates.find((e) => e.model === "Opus 4.8")?.cost).toBeCloseTo(12.25);
  });

  test("returns zero for an empty normalized session", () => {
    expect(estimateClaudeCosts([]).every((estimate) => estimate.cost === 0)).toBe(true);
  });
});
