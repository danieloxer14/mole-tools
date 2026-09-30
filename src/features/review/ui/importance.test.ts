import { expect, test } from "bun:test";
import type { DiffHunk, DiffLine } from "../../../shared/diff-parse";
import type { ImportanceFile, ImportanceSpan } from "../importance";
import {
	fileImportanceMap,
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
