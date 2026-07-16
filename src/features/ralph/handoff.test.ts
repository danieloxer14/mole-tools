import { describe, expect, test } from "bun:test";
import {
	iterationSummaryPrompt,
	MAX_ITERATION_SUMMARY_LENGTH,
	parseIterationSummary,
	trimIterationSummary,
} from "./handoff";

describe("Ralph iteration handoff", () => {
	test("extracts the tagged summary without markers", () => {
		expect(
			parseIterationSummary(
				"work log\nRALPH_ITERATION_SUMMARY\nDone: shipped\nVerification: bun test\nBlockers: none\nNext: review\nEND_RALPH_ITERATION_SUMMARY",
			),
		).toBe(
			"Done: shipped\nVerification: bun test\nBlockers: none\nNext: review",
		);
	});

	test("uses an empty fallback for missing or malformed markers", () => {
		expect(parseIterationSummary("Done, but no markers")).toBe("");
		expect(
			parseIterationSummary("RALPH_ITERATION_SUMMARY\nDone: incomplete"),
		).toBe("");
		expect(
			parseIterationSummary(
				"RALPH_ITERATION_SUMMARY\nmissing end\nRALPH_ITERATION_SUMMARY\nvalid\nEND_RALPH_ITERATION_SUMMARY",
			),
		).toBe("valid");
	});

	test("trims summaries to 2,000 characters", () => {
		const summary = `\n${"x".repeat(MAX_ITERATION_SUMMARY_LENGTH + 100)}\n`;
		expect(trimIterationSummary(summary)).toHaveLength(
			MAX_ITERATION_SUMMARY_LENGTH,
		);
		expect(
			parseIterationSummary(
				`RALPH_ITERATION_SUMMARY\n${summary}\nEND_RALPH_ITERATION_SUMMARY`,
			),
		).toHaveLength(MAX_ITERATION_SUMMARY_LENGTH);
	});

	test("renders first-iteration and persisted prompt context", () => {
		expect(iterationSummaryPrompt("")).toBe("(none — first iteration)");
		expect(iterationSummaryPrompt("Done: ready")).toBe("Done: ready");
	});
});
