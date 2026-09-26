import { describe, expect, test } from "bun:test";
import { PortError } from "../../core/errors";
import {
	type PromptFile,
	parsePromptFile,
	serializePromptFile,
} from "./frontmatter";

describe("prompt frontmatter", () => {
	test("round-trips agent, model, and effort", () => {
		const file: PromptFile = {
			text: "Review this change.\n",
			agent: "claude",
			model: "sonnet",
			effort: "high",
		};

		expect(
			parsePromptFile(serializePromptFile(file), "review-chat/default/001.md"),
		).toEqual(file);
	});

	test("loads older metadata without effort as null", () => {
		expect(
			parsePromptFile(
				"---\nagent: omp\nmodel: sonnet\n---\nReview this change.",
				"review-chat/default/001.md",
			),
		).toEqual({
			text: "Review this change.",
			agent: "omp",
			model: "sonnet",
			effort: null,
		});
	});

	test("treats a leading horizontal rule as prompt text", () => {
		const raw = "---\n# Title\n---\nbody";

		expect(parsePromptFile(raw, "review-chat/default/001.md")).toEqual({
			text: raw,
			agent: null,
			model: null,
			effort: null,
		});
	});

	test("rejects an unknown agent with the file path", () => {
		expect(() =>
			parsePromptFile(
				"---\nagent: gpt\n---\nReview this change.",
				"review-chat/default/007.md",
			),
		).toThrow(
			"Invalid prompt metadata in review-chat/default/007.md: agent must be omp or claude",
		);
		expect(() =>
			parsePromptFile(
				"---\nagent: gpt\n---\nReview this change.",
				"review-chat/default/007.md",
			),
		).toThrow(PortError);
	});
	test("rejects unsupported and malformed effort metadata", () => {
		expect(() =>
			parsePromptFile(
				"---\nagent: omp\neffort: ultra\n---\nReview this change.",
				"review-chat/default/007.md",
			),
		).toThrow(
			"Invalid prompt metadata in review-chat/default/007.md: unsupported effort",
		);
		expect(() =>
			parsePromptFile(
				"---\neffort high\n---\nReview this change.",
				"review-chat/default/007.md",
			),
		).toThrow("malformed effort");
	});
	test("rejects duplicate and agent-incompatible effort metadata", () => {
		expect(() =>
			parsePromptFile(
				"---\nagent: omp\neffort: high\neffort: low\n---\nPrompt",
				"review-chat/default/007.md",
			),
		).toThrow("duplicate key effort");
		expect(() =>
			parsePromptFile(
				"---\nagent: claude\neffort: off\n---\nPrompt",
				"review-chat/default/007.md",
			),
		).toThrow("effort is not supported by claude");
	});

	test("omits frontmatter when all metadata fields are null", () => {
		const file: PromptFile = {
			text: "Prompt body",
			agent: null,
			model: null,
			effort: null,
		};

		expect(serializePromptFile(file)).toBe(file.text);
	});

	test("serializes only non-null metadata fields", () => {
		expect(
			serializePromptFile({
				text: "Prompt body",
				agent: "claude",
				model: null,
				effort: null,
			}),
		).toBe("---\nagent: claude\n---\nPrompt body");
	});
});
