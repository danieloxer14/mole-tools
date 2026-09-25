import { describe, expect, test } from "bun:test";
import { PortError } from "../../core/errors";
import {
	formatAgentNames,
	type PromptFile,
	parsePromptFile,
	serializePromptFile,
} from "./frontmatter";

describe("prompt frontmatter", () => {
	test("round-trips agent and model", () => {
		const file: PromptFile = {
			text: "Review this change.\n",
			agent: "claude",
			model: "sonnet",
		};

		expect(
			parsePromptFile(serializePromptFile(file), "review-chat/default/001.md"),
		).toEqual(file);
	});

	test("formats prompt agent names", () => {
		expect(formatAgentNames(["omp"])).toBe("omp");
		expect(formatAgentNames(["omp", "claude"])).toBe("omp or claude");
		expect(formatAgentNames(["omp", "claude", "codex"])).toBe(
			"omp, claude, or codex",
		);
	});

	test("parses Codex as the prompt agent", () => {
		expect(
			parsePromptFile(
				"---\nagent: codex\n---\nx",
				"review-chat/default/001.md",
			),
		).toEqual({ text: "x", agent: "codex", model: null });
	});

	test("treats a leading horizontal rule as prompt text", () => {
		const raw = "---\n# Title\n---\nbody";

		expect(parsePromptFile(raw, "review-chat/default/001.md")).toEqual({
			text: raw,
			agent: null,
			model: null,
		});
	});

	test("rejects an unknown agent with the file path", () => {
		expect(() =>
			parsePromptFile(
				"---\nagent: gpt\n---\nReview this change.",
				"review-chat/default/007.md",
			),
		).toThrow(
			"Invalid prompt metadata in review-chat/default/007.md: agent must be omp, claude, or codex",
		);
		expect(() =>
			parsePromptFile(
				"---\nagent: gpt\n---\nReview this change.",
				"review-chat/default/007.md",
			),
		).toThrow(PortError);
	});

	test("omits frontmatter when both fields are null", () => {
		const file: PromptFile = {
			text: "Prompt body",
			agent: null,
			model: null,
		};

		expect(serializePromptFile(file)).toBe(file.text);
	});
});
