import { expect, test } from "bun:test";
import type {
	DiffHunk,
	DiffLine,
	ParsedFileDiff,
} from "../../../../shared/diff-parse";
import {
	contextLineId,
	contextRanges,
	diffLineId,
	findMatches,
	lineTextMatches,
	stepMatchIndex,
} from "./find";

function line(
	kind: DiffLine["kind"],
	text: string,
	oldLine: number | null = null,
	newLine: number | null = null,
): DiffLine {
	return { kind, oldLine, newLine, text };
}

function fileWith(hunks: DiffHunk[]): ParsedFileDiff {
	return {
		binary: false,
		deletions: 0,
		hunks,
		insertions: 0,
		newPath: "src/a.ts",
		oldPath: null,
		status: "added",
	};
}

test("lineTextMatches is a case-insensitive literal substring test", () => {
	expect(lineTextMatches("hello world", "world")).toBe(true);
	expect(lineTextMatches("Hello World", "hello")).toBe(true);
	// Empty query matches nothing.
	expect(lineTextMatches("anything", "")).toBe(false);
	// No regex / whole-word matching: a literal substring is enough.
	expect(lineTextMatches("foobar", "oob")).toBe(true);
	expect(lineTextMatches("foobar", "bar bar")).toBe(false);
});

test("diffLineId and contextLineId are stable and distinct", () => {
	const l = line("add", "x", null, 3);
	expect(diffLineId("@@ -1 +1 @@", l)).toBe(diffLineId("@@ -1 +1 @@", l));
	// Different hunk headers produce different ids for the same line.
	expect(diffLineId("@@ -1 +1 @@", l)).not.toBe(diffLineId("@@ -9 +9 @@", l));
	expect(contextLineId("new", 10)).toBe("c:new:10");
	expect(contextLineId("old", 10)).toBe("c:old:10");
	expect(contextLineId("new", 10)).not.toBe(contextLineId("new", 11));
	// Hunk ids and context ids never collide.
	expect(diffLineId("@@ -1 +1 @@", l)).not.toBe(contextLineId("new", 3));
});

test("findMatches returns matched hunk lines in document order", () => {
	const file = fileWith([
		{
			header: "@@ -1 +1 @@",
			newLines: 2,
			newStart: 1,
			oldLines: 0,
			oldStart: 0,
			lines: [
				line("add", "alpha one", null, 1),
				line("add", "beta two", null, 2),
			],
		},
		{
			header: "@@ -5 +5 @@",
			newLines: 1,
			newStart: 5,
			oldLines: 0,
			oldStart: 0,
			lines: [line("add", "alpha three", null, 5)],
		},
	]);
	const matches = findMatches(file, null, "alpha", false);
	expect(matches.map((m) => m.text)).toEqual(["alpha one", "alpha three"]);
	// Hunk matches carry their hunk header and a non-empty side.
	expect(matches.every((m) => m.hunkHeader !== "")).toBe(true);
	expect(matches.every((m) => m.side === "new")).toBe(true);
	// Case-insensitive.
	expect(findMatches(file, null, "ALPHA", false).length).toBe(2);
	// Empty query yields no matches.
	expect(findMatches(file, null, "", false)).toEqual([]);
});

test("findMatches reaches inter-hunk context lines only when includeContext is set", () => {
	const file = fileWith([
		{
			header: "@@ -1 +1 @@",
			newLines: 1,
			newStart: 1,
			oldLines: 0,
			oldStart: 0,
			lines: [line("add", "first", null, 1)],
		},
		{
			header: "@@ -10 +10 @@",
			newLines: 1,
			newStart: 10,
			oldLines: 0,
			oldStart: 0,
			lines: [line("add", "last", null, 10)],
		},
	]);
	// Lines 2..9 exist in the file but not in any hunk -> context gap.
	const fileContents = Array.from(
		{ length: 10 },
		(_, i) => `line ${i + 1}`,
	).join("\n");

	const withoutContext = findMatches(file, fileContents, "line 5", false);
	expect(withoutContext).toEqual([]);

	const withContext = findMatches(file, fileContents, "line 5", true);
	expect(withContext).toHaveLength(1);
	expect(withContext[0]?.text).toBe("line 5");
	// Context matches carry an empty hunk header and the file side.
	expect(withContext[0]?.hunkHeader).toBe("");
	expect(withContext[0]?.side).toBe("new");

	// Without fileContents, context lines are unreachable.
	expect(findMatches(file, null, "line 5", true)).toEqual([]);
});

test("contextRanges reports the gap between two hunks on the given side", () => {
	const file = fileWith([
		{
			header: "@@ -1 +1 @@",
			newLines: 1,
			newStart: 1,
			oldLines: 0,
			oldStart: 0,
			lines: [line("add", "a", null, 1)],
		},
		{
			header: "@@ -10 +10 @@",
			newLines: 1,
			newStart: 10,
			oldLines: 0,
			oldStart: 0,
			lines: [line("add", "z", null, 10)],
		},
	]);
	const ranges = contextRanges(file, "x\n".repeat(100), "new");
	expect(ranges).toHaveLength(1);
	expect(ranges[0]?.startLine).toBe(2);
	expect(ranges[0]?.endLine).toBe(9);
	expect(ranges[0]?.side).toBe("new");
	expect(ranges[0]?.lines).toHaveLength(8);

	// A contiguous pair of hunks (no gap) produces no range.
	const contiguous = fileWith([
		{
			header: "@@ -1 +1 @@",
			newLines: 2,
			newStart: 1,
			oldLines: 0,
			oldStart: 0,
			lines: [line("add", "a", null, 1), line("add", "b", null, 2)],
		},
		{
			header: "@@ -3 +3 @@",
			newLines: 1,
			newStart: 3,
			oldLines: 0,
			oldStart: 0,
			lines: [line("add", "c", null, 3)],
		},
	]);
	expect(contextRanges(contiguous, "x\n".repeat(100), "new")).toEqual([]);
});

test("stepMatchIndex wraps within the match count and is a no-op with no matches", () => {
	// Next wraps from last back to first.
	expect(stepMatchIndex(2, 3, 1)).toBe(0);
	// Previous wraps from first to last.
	expect(stepMatchIndex(0, 3, -1)).toBe(2);
	// Stepping within bounds.
	expect(stepMatchIndex(0, 3, 1)).toBe(1);
	expect(stepMatchIndex(2, 3, -1)).toBe(1);
	// No matches -> index unchanged (no scroll, no counter movement).
	expect(stepMatchIndex(0, 0, 1)).toBe(0);
	expect(stepMatchIndex(5, 0, -1)).toBe(5);
});
