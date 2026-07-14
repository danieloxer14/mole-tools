import { describe, expect, test } from "bun:test";
import { buildMergeRequestPrompt, parseMergeRequestOutput } from "./prompt";

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
