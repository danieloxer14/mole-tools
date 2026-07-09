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
});
