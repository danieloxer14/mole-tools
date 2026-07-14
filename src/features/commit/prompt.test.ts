import { describe, expect, test } from "bun:test";
import type { Issue } from "../../ports/issue-tracker";
import type { FileDiff } from "../../ports/vcs";
import { buildCommitPrompt } from "./prompt";

const diff: FileDiff[] = [
	{
		path: "src/a.ts",
		statOnly: false,
		patch: "@@ -1 +1 @@",
		insertions: 1,
		deletions: 0,
	},
];

describe("buildCommitPrompt with context", () => {
	test("renders Additional user context section when context string is supplied", () => {
		const prompt = buildCommitPrompt(
			"system prompt",
			null,
			diff,
			"This is extra guidance",
		);
		expect(prompt).toContain("Additional user context:");
		expect(prompt).toContain("This is extra guidance");
	});

	test("places Additional user context between system prompt and Jira/diff sections", () => {
		const issue: Issue = {
			key: "AST-1",
			summary: "Add feature",
			description: "Detailed description",
		};
		const prompt = buildCommitPrompt(
			"system prompt",
			issue,
			diff,
			"Use imperative mood only",
		);

		// Verify ordering: system < context < Jira < diff
		const systemIndex = prompt.indexOf("system prompt");
		const contextIndex = prompt.indexOf("Additional user context:");
		const jiraIndex = prompt.indexOf("Here is the work item details:");
		const diffIndex = prompt.indexOf("Here is the changelog:");

		expect(systemIndex).toBeLessThan(contextIndex);
		expect(contextIndex).toBeLessThan(jiraIndex);
		expect(jiraIndex).toBeLessThan(diffIndex);
	});

	test("preserves internal whitespace and newlines in context", () => {
		const multiLineContext = "  First line   \n  Second line  ";
		const prompt = buildCommitPrompt("system", null, diff, multiLineContext);
		expect(prompt).toContain("First line");
		expect(prompt).toContain("Second line");
	});
});

describe("buildCommitPrompt", () => {
	test("includes system prompt and diff without an issue", () => {
		const prompt = buildCommitPrompt("Write a commit message.", null, diff);
		expect(prompt).toContain("Write a commit message.");
		expect(prompt).toContain("Here is the changelog:");
		expect(prompt).toContain("src/a.ts");
		expect(prompt).toContain("@@ -1 +1 @@");
		expect(prompt).not.toContain("Here is the work item details:");
	});

	test("includes issue summary and description when present", () => {
		const issue: Issue = {
			key: "AST-1",
			summary: "Add feature",
			description: "Detailed description",
		};
		const prompt = buildCommitPrompt("system", issue, diff);
		expect(prompt).toContain("Here is the work item details:");
		expect(prompt).toContain("AST-1");
		expect(prompt).toContain("Add feature");
		expect(prompt).toContain("Detailed description");
	});

	test("renders stat-only files without a patch body", () => {
		const statOnlyDiff: FileDiff[] = [
			{
				path: "bun.lockb",
				statOnly: true,
				patch: null,
				insertions: 3,
				deletions: 1,
			},
		];
		const prompt = buildCommitPrompt("system", null, statOnlyDiff);
		expect(prompt).toContain("bun.lockb (+3/-1)");
	});

	test("omits Additional user context section when no context is supplied", () => {
		const prompt = buildCommitPrompt("system prompt", null, diff);
		expect(prompt).not.toContain("Additional user context:");
	});

	test("prompt structure is unchanged without context - system then diff directly", () => {
		const prompt = buildCommitPrompt("Write a commit message.", null, diff);
		// Should go straight from system to changelog with no empty context section
		expect(prompt).toContain("Write a commit message.");
		expect(prompt).toContain("Here is the changelog:");
		expect(prompt.split("\n\n")).toHaveLength(2);
	});

	test("prompt structure is unchanged without context - system, Jira, then diff", () => {
		const issue: Issue = {
			key: "AST-1",
			summary: "Add feature",
			description: "Detailed description",
		};
		const prompt = buildCommitPrompt("system", issue, diff);
		expect(prompt).not.toContain("Additional user context:");
		// 3 sections (system, jira, diff) joined by \n\n = array of length 3
		expect(prompt.split("\n\n")).toHaveLength(3);
	});
});
