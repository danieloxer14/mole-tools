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
): ImportanceSpan => ({ side, startLine, endLine, score });

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

test("file importance uses maximum span score and omits files without spans", () => {
	const files: ImportanceFile[] = [
		{ path: "src/a.ts", spans: [span("new", 1, 4, 2), span("old", 8, 8, 5)] },
		{ path: "src/empty.ts", spans: [] },
		{ path: "src/a.ts", spans: [span("new", 10, 10, 3)] },
	];

	expect(fileImportanceMap(files)).toEqual(new Map([["src/a.ts", 5]]));
});

test("indexed scores follow diff sides and context takes the stronger side", () => {
	const spans = [
		span("old", 12, 14, 3),
		span("new", 20, 24, 5),
		span("new", 22, 22, 2),
	];
	const scores = lineImportanceMap(spans, hunks);
	expect(indexedLineImportance(scores, "old", null)).toBeNull();
	expect(indexedLineImportance(scores, "new", 99)).toBeNull();

	expect(indexedDiffLineImportance(scores, diffLine("del", 13, null))).toBe(3);
	expect(indexedDiffLineImportance(scores, diffLine("add", null, 21))).toBe(5);
	expect(indexedDiffLineImportance(scores, diffLine("context", 14, 22))).toBe(
		5,
	);
	expect(
		indexedDiffLineImportance(scores, diffLine("add", null, 24)),
	).toBeNull();
});

test("extreme span endpoint only indexes coordinates present in diff", () => {
	const spans = [span("new", 21, Number.MAX_SAFE_INTEGER, 5)];
	const scores = lineImportanceMap(spans, hunks);

	expect(indexedDiffLineImportance(scores, diffLine("add", null, 21))).toBe(5);
	expect(indexedDiffLineImportance(scores, diffLine("context", 14, 22))).toBe(
		5,
	);
	expect(
		indexedDiffLineImportance(scores, diffLine("add", null, 23)),
	).toBeNull();
});
