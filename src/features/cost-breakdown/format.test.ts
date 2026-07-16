import { describe, expect, test } from "bun:test";
import type { CostSession } from "../../adapters/cost-history/file";
import { formatSessionBreakdown } from "./format";

describe("formatSessionBreakdown", () => {
	const session: CostSession = {
		id: "session-1",
		feature: "commit",
		startedAt: "2026-07-09T00:00:00.000Z",
		entries: [
			{
				type: "llm",
				task: "commit-message",
				provider: "pi",
				model: "claude-sonnet-4-5",
				usage: {
					inputTokens: 100,
					outputTokens: 10,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "reported",
				},
				usdCost: { source: "actual", amount: 0.01 },
			},
			{
				type: "llm",
				task: "stagedDiff",
				provider: "pi",
				model: "claude-sonnet-4-5",
				usage: {
					inputTokens: 0,
					outputTokens: 20,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					source: "reported",
				},
				usdCost: { source: "actual", amount: 0.01 },
			},
		],
	};

	test("renders session header, model cost table, and per-entry detail table", () => {
		const output = formatSessionBreakdown(session, 1);

		// Header
		expect(output).toContain("Session 1 — commit — 2026-07-09T00:00:00.000Z");

		// Model cost table (top-level session totals)
		expect(output).toContain("Model");
		expect(output).toContain("Haiku 4.5");
		expect(output).toContain("Sonnet 5");
		expect(output).toContain("Opus 4.8");
	});

	test("renders normalized LLM entries as uppercase in per-entry table", () => {
		const output = formatSessionBreakdown(session, 1);
		expect(output).toContain("LLM");
		expect(output).not.toContain("GIT");
	});

	test("per-entry detail table includes cache info columns", () => {
		const output = formatSessionBreakdown(session, 1);
		expect(output).toContain("C.W"); // cache write column header present
		expect(output).toContain("commit-message");
	});

	test("omits entries without usage from the detail table", () => {
		const onlyGit: CostSession = {
			id: "session-no-llm",
			feature: "commit",
			startedAt: "2026-07-09T00:00:00.000Z",
			entries: [
				{
					type: "llm",
					task: "rev-parse",
					provider: "pi",
					model: "claude-sonnet-4-5",
					usdCost: { source: "unavailable" },
				},
			],
		};

		const output = formatSessionBreakdown(onlyGit, 1);

		// Entries without normalized usage have no detail row.
		expect(output).not.toContain("rev-parse");
	});
});
