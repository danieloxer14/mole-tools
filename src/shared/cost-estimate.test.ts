import { describe, expect, test } from "bun:test";
import type { CostEntry } from "../core/cost-tracker";
import {
    deriveCacheUsage,
    estimateClaudeCosts,
    sumDerivedUsage,
} from "./cost-estimate";

describe("deriveCacheUsage", () => {
    test("empty input returns zero usage for all entries", () => {
        const derived = deriveCacheUsage([]);
        expect(derived).toEqual([]);
    });

    test("first entry has no cache reads, writes everything to cache", () => {
        const entry: CostEntry = {
            type: "llm",
            task: "commit-message",
            inputTokens: 1_000_000,
            outputTokens: 500,
        };
        const derived = deriveCacheUsage([entry]);
        expect(derived[0]?.cacheReadTokens).toBe(0);
        expect(derived[0]?.cacheWriteTokens).toBe(1_000_000);
    });

    test("second entry reads from first entry's cached input", () => {
        const entries: CostEntry[] = [
            { type: "llm", task: "step-1", inputTokens: 42, outputTokens: 10 },
            { type: "llm", task: "step-2", inputTokens: 42, outputTokens: 8 },
        ];
        const derived = deriveCacheUsage(entries);

        expect(derived[0]?.cacheReadTokens).toBe(0);
        expect(derived[0]?.cacheWriteTokens).toBe(42);
        expect(derived[1]?.cacheReadTokens).toBe(42);
        expect(derived[1]?.cacheWriteTokens).toBe(0);
    });

    test("later entries read from all preceding output as available context", () => {
        const entries: CostEntry[] = [
            { type: "llm", task: "a", inputTokens: 42, outputTokens: 1 },
            { type: "llm", task: "b", inputTokens: 100, outputTokens: 5 },
            { type: "llm", task: "c", inputTokens: 50, outputTokens: 3 },
        ];
        const derived = deriveCacheUsage(entries);

        // entry b: previous inputs = 42; reads min(100, 42) = 42, writes 58
        expect(derived[1]?.cacheReadTokens).toBe(42);
        expect(derived[1]?.cacheWriteTokens).toBe(58);

        // entry c: previous inputs = 142; reads min(50, 142) = 50, writes 0
        expect(derived[2]?.cacheReadTokens).toBe(50);
        expect(derived[2]?.cacheWriteTokens).toBe(0);
    });

    test("sumDerivedUsage aggregates all fields correctly", () => {
        const entries: CostEntry[] = [
            { type: "llm", task: "a", inputTokens: 42, outputTokens: 10 },
            { type: "llm", task: "b", inputTokens: 42, outputTokens: 8 },
        ];
        const derived = deriveCacheUsage(entries);
        const usage = sumDerivedUsage(derived);

        expect(usage.inputTokens).toBe(84);
        expect(usage.outputTokens).toBe(18);
        expect(usage.cacheReadTokens).toBe(0 + 42);
        expect(usage.cacheWriteTokens).toBe(42 + 0);
    });
});

describe("estimateClaudeCosts", () => {
    test("returns zero cost for every model when there are no entries", () => {
        const estimates = estimateClaudeCosts([]);
        expect(estimates.every((e) => e.cost === 0)).toBe(true);
        expect(estimates.map((e) => e.model)).toEqual([
            "Haiku 4.5",
            "Sonnet 5",
            "Opus 4.8",
        ]);
    });

    test("sums tokens across entries and prices per model", () => {
        const entries: CostEntry[] = [
            { type: "llm", task: "commit-message", inputTokens: 1_000_000, outputTokens: 0 },
        ];
        const estimates = estimateClaudeCosts(entries);

        expect(estimates.find((e) => e.model === "Haiku 4.5")?.cost).toBe(2.25);
        expect(estimates.find((e) => e.model === "Sonnet 5")?.cost).toBe(6.75);
        expect(estimates.find((e) => e.model === "Opus 4.8")?.cost).toBe(11.25);
    });

    test("prices cache reads at 0.1x and cache writes at 1.25x the input rate", () => {
        const estimates = estimateClaudeCosts([
            { type: "llm", task: "a", inputTokens: 1_000_000, outputTokens: 0 },
            { type: "llm", task: "b", inputTokens: 1_000_000, outputTokens: 0 },
            { type: "llm", task: "c", inputTokens: 1_000_000, outputTokens: 0 },
        ]);

        // Entry 1: reads 0, writes 1M. Entry 2: reads 1M, writes 0. Entry 3: reads 1M, writes 0.
        // Totals: inputTokens=3M, cacheReadTokens=2M, cacheWriteTokens=1M
        expect(estimates.find((e) => e.model === "Haiku 4.5")?.cost).toBeCloseTo(4.45);
        expect(estimates.find((e) => e.model === "Sonnet 5")?.cost).toBeCloseTo(13.35);
        expect(estimates.find((e) => e.model === "Opus 4.8")?.cost).toBeCloseTo(22.25);
    });

    test("order matters: first writes, subsequent reads", () => {
        const same = estimateClaudeCosts([
            { type: "llm", task: "a", inputTokens: 1_000_000, outputTokens: 0 },
            { type: "llm", task: "a", inputTokens: 1_000_000, outputTokens: 0 },
        ]);
        const reverse = estimateClaudeCosts([
            { type: "llm", task: "a", inputTokens: 1_000_000, outputTokens: 0 },
            { type: "llm", task: "a", inputTokens: 1_000_000, outputTokens: 0 },
        ]);

        // Identical entries in the same shape produce identical costs
        for (const model of ["Haiku 4.5", "Sonnet 5", "Opus 4.8"]) {
            expect(same.find((e) => e.model === model)?.cost).toBe(
                reverse.find((e) => e.model === model)?.cost,
            );
        }
    });
});
