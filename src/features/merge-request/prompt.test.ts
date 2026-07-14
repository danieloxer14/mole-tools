import { describe, expect, test } from "bun:test";
import type { Issue } from "../../ports/issue-tracker";
import type { FileDiff } from "../../ports/vcs";
import { buildMergeRequestPrompt, parseMergeRequestOutput } from "./prompt";

const diff: FileDiff[] = [
	{
		path: "src/a.ts",
		statOnly: false,
		patch: "@@ -1 +1 @@",
		insertions: 1,
		deletions: 0,
	},
];

describe("merge-request prompt", () => {
	test("includes Jira, every commit, and filtered/stat-only diff context", () => {
		const prompt = buildMergeRequestPrompt({
			system: "system",
			issue: { key: "ABC-1", summary: "Summary", description: "Details" },
			commits: ["feat: first", "fix: second"],
			diff: [
				{
					path: "src/a.ts",
					statOnly: false,
					patch: "+code",
					insertions: 1,
					deletions: 0,
				},
				{
					path: "bun.lockb",
					statOnly: true,
					patch: null,
					insertions: 4,
					deletions: 2,
				},
			],
		});
		expect(prompt).toContain("ABC-1");
		expect(prompt).toContain("feat: first");
		expect(prompt).toContain("fix: second");
		expect(prompt).toContain("+code");
		expect(prompt).toContain("bun.lockb (+4/-2)");
	});

	test("parses Title marker and fallback deterministically", () => {
		expect(
			parseMergeRequestOutput("Title: feat: add thing\n\nBody\ntext"),
		).toEqual({
			title: "feat: add thing",
			body: "Body\ntext",
		});
		expect(parseMergeRequestOutput("fix: fallback\n\nDescription")).toEqual({
			title: "fix: fallback",
			body: "Description",
		});
	});
});

describe("buildMergeRequestPrompt with context", () => {
	test("renders Additional user context section when context string is supplied", () => {
		const prompt = buildMergeRequestPrompt({
			system: "system prompt",
			issue: null,
			commits: ["feat: first"],
			diff,
			context: "Focus on operational impact",
		});
		expect(prompt).toContain("Additional user context:");
		expect(prompt).toContain("Focus on operational impact");
	});

	test("places Additional user context after system and before Jira, commits, diff, and output contract", () => {
		const issue: Issue = {
			key: "ABC-1",
			summary: "Summary",
			description: "Details",
		};
		const prompt = buildMergeRequestPrompt({
			system: "system prompt",
			issue,
			commits: ["feat: first"],
			diff,
			context: "Emphasize migration risk",
		});

		// Verify ordering: system < context < Jira < commits < diff < output contract
		const systemIndex = prompt.indexOf("system prompt");
		const contextIndex = prompt.indexOf("Additional user context:");
		const jiraIndex = prompt.indexOf("Here are the Jira work item details:");
		const commitsIndex = prompt.indexOf("Here are the commits on this branch:");
		const diffIndex = prompt.indexOf("Here is the merge-base diff:");
		const contractIndex = prompt.indexOf("Respond with a first-line title");

		expect(systemIndex).toBeLessThan(contextIndex);
		expect(contextIndex).toBeLessThan(jiraIndex);
		expect(jiraIndex).toBeLessThan(commitsIndex);
		expect(commitsIndex).toBeLessThan(diffIndex);
		expect(diffIndex).toBeLessThan(contractIndex);
	});

	test("preserves internal whitespace and newlines in context", () => {
		const multiLineContext = "  First line   \n  Second line  ";
		const prompt = buildMergeRequestPrompt({
			system: "system prompt",
			issue: null,
			commits: [],
			diff,
			context: multiLineContext,
		});
		expect(prompt).toContain("First line");
		expect(prompt).toContain("Second line");
	});

	test("omits Additional user context section when no context is supplied", () => {
		const prompt = buildMergeRequestPrompt({
			system: "system prompt",
			issue: null,
			commits: ["feat: first"],
			diff,
		});
		expect(prompt).not.toContain("Additional user context:");
	});

	test("prompt structure is unchanged without context", () => {
		// Without context: system + commits + diff + contract = 4 sections
		const prompt = buildMergeRequestPrompt({
			system: "system prompt",
			issue: null,
			commits: [],
			diff,
		});
		expect(prompt.split("\n\n")).toHaveLength(4);
	});

	test("prompt structure is unchanged without context with Jira", () => {
		// Without context: system + jira + commits + diff + contract = 5 sections
		const prompt = buildMergeRequestPrompt({
			system: "system prompt",
			issue: { key: "ABC-1", summary: "Summary", description: "Details" },
			commits: [],
			diff,
		});
		expect(prompt).not.toContain("Additional user context:");
		expect(prompt.split("\n\n")).toHaveLength(5);
	});
});
