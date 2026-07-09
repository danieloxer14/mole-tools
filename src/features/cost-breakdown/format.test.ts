import { describe, expect, test } from "bun:test";
import type { CostSession } from "../../adapters/cost-history/file";
import { formatSessionBreakdown } from "./format";

describe("formatSessionBreakdown", () => {
	test("renders the session header, totals with derived cache, and one row per entry", () => {
		const session: CostSession = {
			id: "session-1",
			feature: "commit",
			startedAt: "2026-07-09T00:00:00.000Z",
			entries: [
						{ type: "llm", task: "commit-message", inputTokens: 100, outputTokens: 10 },
						{ type: "git", task: "stagedDiff", inputTokens: 0, outputTokens: 20 },
					],
			};

			const output = formatSessionBreakdown(session, 1);

			expect(output).toContain("Session 1 — commit — 2026-07-09T00:00:00.000Z");
			expect(output).toContain("Haiku 4.5");
				expect(output).toContain("Sonnet 5");
			expect(output).toContain("Opus 4.8");
			expect(output).toContain("[llm] commit-message");
			expect(output).toContain("[git] stagedDiff");
					expect(output).toContain("100 cache write");
	});

	test("omits cache columns for entries with no new input", () => {
			const session: CostSession = {
				id: "session-2",
				feature: "commit",
				startedAt: "2026-07-09T00:00:00.000Z",
					entries: [
						{ type: "git", task: "commit", inputTokens: 0, outputTokens: 3 },
					],
				};

			const output = formatSessionBreakdown(session, 1);

				expect(output).not.toContain("cache read");
			expect(output).not.toContain("cache write");
	});
});
