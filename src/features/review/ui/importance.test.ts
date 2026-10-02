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
const scoredAddedFile = (
	path: string,
	score: ImportanceSpan["score"],
	count: number,
): { diff: ParsedFileDiff; file: ImportanceFile } => ({
	diff: diffFile(
		path,
		path,
		Array.from({ length: count }, (_, index) =>
			diffLine("add", null, index + 1),
		),
	),
	file: {
		path,
		spans: [span("new", 1, count, score)],
	},
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

test("score-5 progress keeps denominator and threshold fixed as viewed paths change", () => {
	const first = scoredAddedFile("src/a.ts", 5, 50);
	const second = scoredAddedFile("src/b.ts", 5, 50);
	const diff = [first.diff, second.diff];
	const files = [first.file, second.file];

	expect(importanceReviewProgress(diff, files, [])).toEqual({
		value: 0,
		total: 19,
		threshold: 13,
	});
	expect(importanceReviewProgress(diff, files, ["src/a.ts"])).toEqual({
		value: 4,
		total: 19,
		threshold: 13,
	});
});

test("score-3 progress aggregates files and view state changes numerator only", () => {
	const first = scoredAddedFile("src/a.ts", 3, 50);
	const second = scoredAddedFile("src/b.ts", 3, 150);
	const diff = [first.diff, second.diff];
	const files = [first.file, second.file];
	const totals = importanceReviewFileTotals(diff, files);

	expect(totals.byScore).toEqual({ 1: 0, 2: 0, 3: 200, 4: 0, 5: 0 });
	expect(importanceReviewProgressForViewedFiles(totals, ["src/a.ts"])).toEqual({
		value: 0.75,
		total: 19,
		threshold: 13,
	});
	expect(
		importanceReviewProgressForViewedFiles(totals, [
			"src/a.ts",
			"src/a.ts",
			"src/b.ts",
		]),
	).toEqual({ value: 3, total: 19, threshold: 13 });
	expect(importanceReviewProgressForViewedFiles(totals, [])).toEqual({
		value: 0,
		total: 19,
		threshold: 13,
	});
});

test("sparse score buckets contribute fixed shares", () => {
	const low = scoredAddedFile("src/low.ts", 1, 2);
	const high = scoredAddedFile("src/high.ts", 4, 4);

	expect(
		importanceReviewProgress(
			[low.diff, high.diff],
			[low.file, high.file],
			["src/low.ts", "src/high.ts"],
		),
	).toEqual({ value: 6, total: 19, threshold: 13 });
});
test("higher-importance files advance progress faster for equal added lines", () => {
	const low = scoredAddedFile("src/low.ts", 1, 2);
	const high = scoredAddedFile("src/high.ts", 5, 2);
	const diff = [low.diff, high.diff];
	const files = [low.file, high.file];
	const lowProgress = importanceReviewProgress(diff, files, [low.file.path]);
	const highProgress = importanceReviewProgress(diff, files, [high.file.path]);

	expect(lowProgress).toEqual({ value: 1, total: 19, threshold: 13 });
	expect(highProgress).toEqual({ value: 8, total: 19, threshold: 13 });
	expect(highProgress.value).toBeGreaterThan(lowProgress.value);
});

test("full view across five levels preserves raw value of 19", () => {
	const levels = ([1, 2, 3, 4, 5] as const).map((score) =>
		scoredAddedFile(`src/${score}.ts`, score, 1),
	);

	expect(
		importanceReviewProgress(
			levels.map(({ diff }) => diff),
			levels.map(({ file }) => file),
			levels.map(({ file }) => file.path),
		),
	).toEqual({ value: 19, total: 19, threshold: 13 });
});

test("importance progress counts highest-overlap added and deleted lines once", () => {
	const changed = diffFile("src/a.ts", "src/a.ts", [
		diffLine("context", 1, 1),
		diffLine("add", null, 2),
		diffLine("add", null, 3),
		diffLine("del", 4, null),
		diffLine("add", null, 5),
	]);
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

	expect(
		importanceReviewProgress([changed, changed], files, [
			"src/a.ts",
			"src/a.ts",
		]),
	).toEqual({ value: 11, total: 19, threshold: 13 });
});

test("deleted paths, merged importance spans, and unmatched data retain handling", () => {
	const deleted = diffFile("gone.ts", null, [diffLine("del", 1, null)]);
	const duplicate = diffFile("gone.ts", null, [diffLine("del", 1, null)]);
	const files: ImportanceFile[] = [
		{ path: "gone.ts", spans: [span("old", 1, 1, 4)] },
		{ path: "gone.ts", spans: [span("old", 1, 1, 5)] },
	];

	expect(
		importanceReviewProgress([deleted, duplicate], files, [
			"gone.ts",
			"gone.ts",
			"absent.ts",
		]),
	).toEqual({ value: 8, total: 19, threshold: 13 });
});

test("importance progress ignores unmatched files and empty score data", () => {
	const diff = [diffFile("src/a.ts", "src/a.ts", [diffLine("add", null, 1)])];
	expect(
		importanceReviewProgress(
			diff,
			[{ path: "other.ts", spans: [span("new", 1, 1, 5)] }],
			["src/a.ts", "other.ts"],
		),
	).toEqual({ value: 0, total: 0, threshold: 0 });
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
