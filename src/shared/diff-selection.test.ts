import { describe, expect, test } from "bun:test";
import { PortError } from "../core/errors";
import { parseFileDiff } from "./diff-parse";
import { selectDiffLines } from "./diff-selection";

function parsed(path: string, patch: string, insertions = 0, deletions = 0) {
	return parseFileDiff({ path, statOnly: false, patch, insertions, deletions });
}

const modified = parsed(
	"src/app.ts",
	[
		"diff --git a/src/app.ts b/src/app.ts",
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		"@@ -1,3 +1,4 @@",
		" context",
		"-old line",
		"+new line",
		"+another line",
	].join("\n"),
	2,
	1,
);

const renamed = parsed(
	"new-name.ts",
	[
		"diff --git a/old-name.ts b/new-name.ts",
		"similarity index 100%",
		"rename from old-name.ts",
		"rename to new-name.ts",
		"--- a/old-name.ts",
		"+++ b/new-name.ts",
		"@@ -1 +1 @@",
		" context",
	].join("\n"),
);

describe("selectDiffLines", () => {
	test("returns one selected line", () => {
		const selected = selectDiffLines(
			{ path: "src/app.ts", side: "new", startLine: 2, endLine: 2 },
			modified,
		);

		expect(selected.map(({ kind, newLine }) => ({ kind, newLine }))).toEqual([
			{ kind: "add", newLine: 2 },
		]);
	});

	test("returns range lines in order", () => {
		const selected = selectDiffLines(
			{ path: "src/app.ts", side: "new", startLine: 2, endLine: 3 },
			modified,
		);

		expect(selected.map(({ kind, newLine }) => ({ kind, newLine }))).toEqual([
			{ kind: "add", newLine: 2 },
			{ kind: "add", newLine: 3 },
		]);
	});

	test.each([
		[
			"reversed range",
			{ path: "src/app.ts", side: "new", startLine: 3, endLine: 2 },
			modified,
		],
		[
			"unsupported side",
			{ path: "src/app.ts", side: "both", startLine: 2, endLine: 2 },
			modified,
		],
		[
			"path not matching selected side",
			{ path: "new-name.ts", side: "old", startLine: 1, endLine: 1 },
			renamed,
		],
		[
			"line absent from diff",
			{ path: "src/app.ts", side: "new", startLine: 9, endLine: 9 },
			modified,
		],
	] as const)("rejects %s with shared prefix", (_label, selection, file) => {
		const invalidSelection = selection as Parameters<typeof selectDiffLines>[0];
		expect(() => selectDiffLines(invalidSelection, file)).toThrow(PortError);
		expect(() => selectDiffLines(invalidSelection, file)).toThrow(
			/^Invalid diff line selection:/,
		);
	});
});
