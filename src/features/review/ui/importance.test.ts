import { expect, test } from "bun:test";
import type {
	DiffHunk,
	DiffLine,
	ParsedFileDiff,
} from "../../../shared/diff-parse";
import type { ImportanceFile, ImportanceSpan } from "../importance";
import {
	fileImportanceMap,
	importanceProgressColor,
	importanceReviewFileTotals,
	importanceReviewProgress,
	importanceReviewProgressForViewedFiles,
	indexedDiffLineImportance,
	indexedLineImportance,
	lineImportanceMap,
} from "./importance";

const span = (
	side: ImportanceSpan["side"],
	startLine: number,
	endLine: number,
	score: ImportanceSpan["score"],
	reason = `Reason for score ${score}.`,
): ImportanceSpan => ({ side, startLine, endLine, score, reason });

const diffLine = (
	kind: DiffLine["kind"],
	oldLine: number | null,
	newLine: number | null,
): DiffLine => ({ kind, oldLine, newLine, text: "line" });

const diffFile = (
	oldPath: string | null,
	newPath: string | null,
	lines: DiffLine[],
): ParsedFileDiff => ({
	oldPath,
	newPath,
	status:
		newPath === null ? "deleted" : oldPath === null ? "added" : "modified",
	binary: false,
	insertions: lines.filter((line) => line.kind === "add").length,
	deletions: lines.filter((line) => line.kind === "del").length,
	hunks: [
		{
			header: "@@",
			oldStart: 1,
			oldLines: lines.length,
			newStart: 1,
			newLines: lines.length,
			lines,
		},
	],
});

const hunks: DiffHunk[] = [
	{
		header: "@@ -12,3 +20,3 @@",
		oldStart: 12,
		oldLines: 3,
		newStart: 20,
		newLines: 3,
		lines: [
			diffLine("del", 13, null),
			diffLine("add", null, 21),
			diffLine("context", 14, 22),
		],
	},
];

test("file importance keeps highest score and first reason on ties", () => {
	const files: ImportanceFile[] = [
		{
			path: "src/a.ts",
			spans: [
				span("new", 1, 4, 2, "Lower-scored span."),
				span("old", 8, 8, 5, "First highest-scored span."),
			],
		},
		{ path: "src/empty.ts", spans: [] },
		{
			path: "src/a.ts",
			spans: [span("new", 10, 10, 5, "Later equal-score span.")],
		},
	];

	const ratings = fileImportanceMap(files);
	expect(ratings.get("src/a.ts")).toMatchObject({
		score: 5,
		reason: "First highest-scored span.",
	});
	expect(ratings.has("src/empty.ts")).toBe(false);
});

test("indexed ratings follow diff sides and context takes the stronger side", () => {
	const spans = [
		span("old", 12, 14, 3, "Old-side reason."),
		span("new", 20, 24, 5, "New-side higher-score reason."),
		span("new", 22, 22, 2, "Lower-score overlap reason."),
		span("new", 22, 22, 5, "Later equal-score overlap reason."),
	];
	const ratings = lineImportanceMap(spans, hunks);
	expect(indexedLineImportance(ratings, "old", null)).toBeNull();
	expect(indexedLineImportance(ratings, "new", 99)).toBeNull();

	expect(
		indexedDiffLineImportance(ratings, diffLine("del", 13, null)),
	).toMatchObject({
		score: 3,
		reason: "Old-side reason.",
	});
	expect(
		indexedDiffLineImportance(ratings, diffLine("add", null, 21)),
	).toMatchObject({
		score: 5,
		reason: "New-side higher-score reason.",
	});
	expect(
		indexedDiffLineImportance(ratings, diffLine("context", 14, 22)),
	).toMatchObject({
		score: 5,
		reason: "New-side higher-score reason.",
	});
	expect(
		indexedDiffLineImportance(ratings, diffLine("add", null, 24)),
	).toBeNull();
});

test("context rating ties choose new side with its matching reason", () => {
	const ratings = lineImportanceMap(
		[
			span("old", 14, 14, 4, "Old-side tied reason."),
			span("new", 22, 22, 4, "New-side tied reason."),
		],
		hunks,
	);

	expect(
		indexedDiffLineImportance(ratings, diffLine("context", 14, 22)),
	).toMatchObject({
		score: 4,
		reason: "New-side tied reason.",
	});
});

test("importance progress weights counted lines and only viewed files", () => {
	const diff = [
		diffFile(
			"src/a.ts",
			"src/a.ts",
			[1, 2, 3, 4, 5].map((line) => diffLine("add", null, line)),
		),
	];
	const files: ImportanceFile[] = [
		{
			path: "src/a.ts",
			spans: [1, 2, 3, 4, 5].map((line, index) =>
				span("new", line, line, (index + 1) as ImportanceSpan["score"]),
			),
		},
	];

	const fileTotals = importanceReviewFileTotals(diff, files);
	expect(fileTotals).toEqual({
		byPath: new Map([["src/a.ts", { total: 5, threshold: 3.75 }]]),
		total: 5,
		threshold: 3.75,
	});
	expect(
		importanceReviewProgressForViewedFiles(fileTotals, ["src/a.ts"]),
	).toEqual({
		value: 5,
		total: 5,
		threshold: 3.75,
	});
	expect(importanceReviewProgressForViewedFiles(fileTotals, [])).toEqual({
		value: 0,
		total: 5,
		threshold: 3.75,
	});
	expect(importanceReviewProgress(diff, files, ["src/a.ts"])).toEqual({
		value: 5,
		total: 5,
		threshold: 3.75,
	});
	expect(importanceReviewProgress(diff, files, [])).toEqual({
		value: 0,
		total: 5,
		threshold: 3.75,
	});
});

test("importance progress uses highest span score and excludes uncounted lines", () => {
	const diff = [
		diffFile("src/a.ts", "src/a.ts", [
			diffLine("context", 1, 1),
			diffLine("add", null, 2),
			diffLine("add", null, 3),
			diffLine("del", 4, null),
		]),
	];
	const files: ImportanceFile[] = [
		{
			path: "src/a.ts",
			spans: [
				span("new", 2, 2, 2),
				span("new", 2, 2, 5),
				span("old", 4, 4, 3),
				span("new", 4, 4, 5),
				span("new", 1, 1, 5),
			],
		},
	];

	expect(importanceReviewProgress(diff, files, ["src/a.ts"])).toEqual({
		value: 2.5,
		total: 2.5,
		threshold: 2.5,
	});
});

test("importance progress target includes moderate lines and has a 50% minimum", () => {
	const diff = [
		diffFile("src/moderate.ts", "src/moderate.ts", [diffLine("add", null, 1)]),
		diffFile("src-low.ts", "src-low.ts", [
			diffLine("add", null, 1),
			diffLine("add", null, 2),
		]),
	];
	const files: ImportanceFile[] = [
		{ path: "src/moderate.ts", spans: [span("new", 1, 1, 3)] },
		{
			path: "src-low.ts",
			spans: [span("new", 1, 1, 1), span("new", 2, 2, 2)],
		},
	];

	const fileTotals = importanceReviewFileTotals(diff, files);
	expect(fileTotals).toEqual({
		byPath: new Map([
			["src/moderate.ts", { total: 1, threshold: 1 }],
			["src-low.ts", { total: 1.25, threshold: 0 }],
		]),
		total: 2.25,
		threshold: 1.125,
	});
	expect(importanceReviewProgress(diff, files, ["src-low.ts"])).toEqual({
		value: 1.25,
		total: 2.25,
		threshold: 1.125,
	});
});

test("importance progress keys deleted files by old path and deduplicates paths", () => {
	const deleted = diffFile("gone.ts", null, [diffLine("del", 1, null)]);
	const files: ImportanceFile[] = [
		{ path: "gone.ts", spans: [span("old", 1, 1, 4)] },
		{ path: "gone.ts", spans: [span("old", 1, 1, 5)] },
	];

	expect(
		importanceReviewProgress([deleted, deleted], files, [
			"gone.ts",
			"gone.ts",
			"absent.ts",
		]),
	).toEqual({ value: 1.5, total: 1.5, threshold: 1.5 });
});

test("importance progress ignores unmatched files and empty importance data", () => {
	const diff = [diffFile("src/a.ts", "src/a.ts", [diffLine("add", null, 1)])];
	const rated = importanceReviewProgress(
		diff,
		[{ path: "other.ts", spans: [span("new", 1, 1, 5)] }],
		["src/a.ts", "other.ts"],
	);
	expect(rated).toEqual({ value: 0, total: 0, threshold: 0 });
	expect(importanceReviewProgress(diff, [], ["src/a.ts"])).toEqual({
		value: 0,
		total: 0,
		threshold: 0,
	});
});

test("importance progress colour maps ratios to importance levels", () => {
	expect(importanceProgressColor(0)).toBe(
		"color-mix(in oklch, var(--color-importance-1) 100%, var(--color-importance-2))",
	);
	expect(importanceProgressColor(0.125)).toBe(
		"color-mix(in oklch, var(--color-importance-1) 50%, var(--color-importance-2))",
	);
	expect(importanceProgressColor(0.5)).toBe(
		"color-mix(in oklch, var(--color-importance-3) 100%, var(--color-importance-4))",
	);
	expect(importanceProgressColor(1)).toBe("var(--color-importance-5)");
	expect(importanceProgressColor(2)).toBe("var(--color-importance-5)");
	expect(importanceProgressColor(Number.NaN)).toBe(
		"color-mix(in oklch, var(--color-importance-1) 100%, var(--color-importance-2))",
	);
	expect(importanceProgressColor(-1)).toBe(
		"color-mix(in oklch, var(--color-importance-1) 100%, var(--color-importance-2))",
	);
});
