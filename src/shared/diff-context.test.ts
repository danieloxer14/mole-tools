import { expect, test } from "bun:test";
import {
	CONTEXT_CHUNK_SIZE,
	diffContextGaps,
	hiddenContextRange,
	revealedContextLines,
	splitSourceLines,
} from "./diff-context";
import type { DiffHunk } from "./diff-parse";

function hunk(
	oldStart: number,
	oldLines: number,
	newStart: number,
	newLines: number,
): DiffHunk {
	return {
		header: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
		oldStart,
		oldLines,
		newStart,
		newLines,
		lines: [],
	};
}

test("omits a head gap when the first hunk starts at line one", () => {
	expect(diffContextGaps([hunk(1, 2, 1, 2)], 5)).toEqual([
		{
			id: "tail",
			position: "tail",
			oldStart: 3,
			oldEnd: 5,
			newStart: 3,
			newEnd: 5,
		},
	]);
});

test("omits a tail gap when the last hunk reaches EOF", () => {
	expect(diffContextGaps([hunk(4, 2, 4, 2)], 5)).toEqual([
		{
			id: "head",
			position: "head",
			oldStart: 1,
			oldEnd: 3,
			newStart: 1,
			newEnd: 3,
		},
	]);
});

test("derives head and tail gaps around a single hunk", () => {
	expect(diffContextGaps([hunk(4, 2, 4, 2)], 8)).toEqual([
		{
			id: "head",
			position: "head",
			oldStart: 1,
			oldEnd: 3,
			newStart: 1,
			newEnd: 3,
		},
		{
			id: "tail",
			position: "tail",
			oldStart: 6,
			oldEnd: 8,
			newStart: 6,
			newEnd: 8,
		},
	]);
});

test("does not create an inter-hunk gap for adjacent hunks", () => {
	expect(diffContextGaps([hunk(4, 2, 4, 2), hunk(6, 1, 6, 1)], 7)).toEqual([
		{
			id: "head",
			position: "head",
			oldStart: 1,
			oldEnd: 3,
			newStart: 1,
			newEnd: 3,
		},
		{
			id: "tail",
			position: "tail",
			oldStart: 7,
			oldEnd: 7,
			newStart: 7,
			newEnd: 7,
		},
	]);
});
test("head chunks grow backward to the file boundary", () => {
	const [head] = diffContextGaps([hunk(31, 1, 31, 1)], 31);
	expect(head).toBeDefined();
	if (!head) throw new Error("Expected head gap");
	const source = Array.from({ length: 31 }, (_, index) => `line ${index + 1}`);

	expect(revealedContextLines(head, source, CONTEXT_CHUNK_SIZE)).toEqual([
		{ oldLine: 11, newLine: 11, text: "line 11" },
		{ oldLine: 12, newLine: 12, text: "line 12" },
		{ oldLine: 13, newLine: 13, text: "line 13" },
		{ oldLine: 14, newLine: 14, text: "line 14" },
		{ oldLine: 15, newLine: 15, text: "line 15" },
		{ oldLine: 16, newLine: 16, text: "line 16" },
		{ oldLine: 17, newLine: 17, text: "line 17" },
		{ oldLine: 18, newLine: 18, text: "line 18" },
		{ oldLine: 19, newLine: 19, text: "line 19" },
		{ oldLine: 20, newLine: 20, text: "line 20" },
		{ oldLine: 21, newLine: 21, text: "line 21" },
		{ oldLine: 22, newLine: 22, text: "line 22" },
		{ oldLine: 23, newLine: 23, text: "line 23" },
		{ oldLine: 24, newLine: 24, text: "line 24" },
		{ oldLine: 25, newLine: 25, text: "line 25" },
		{ oldLine: 26, newLine: 26, text: "line 26" },
		{ oldLine: 27, newLine: 27, text: "line 27" },
		{ oldLine: 28, newLine: 28, text: "line 28" },
		{ oldLine: 29, newLine: 29, text: "line 29" },
		{ oldLine: 30, newLine: 30, text: "line 30" },
	]);
	expect(hiddenContextRange(head, CONTEXT_CHUNK_SIZE)).toEqual({
		startLine: 1,
		endLine: 10,
	});
	expect(revealedContextLines(head, source, 30)?.at(0)).toEqual({
		oldLine: 1,
		newLine: 1,
		text: "line 1",
	});
	expect(hiddenContextRange(head, 30)).toBeNull();
});
test("tail chunks grow forward from the last hunk", () => {
	const [tail] = diffContextGaps([hunk(1, 1, 1, 1)], 31);
	expect(tail).toBeDefined();
	if (!tail) throw new Error("Expected tail gap");
	const source = Array.from({ length: 31 }, (_, index) => `line ${index + 1}`);

	expect(revealedContextLines(tail, source, CONTEXT_CHUNK_SIZE)?.at(0)).toEqual(
		{
			oldLine: 2,
			newLine: 2,
			text: "line 2",
		},
	);
	expect(
		revealedContextLines(tail, source, CONTEXT_CHUNK_SIZE)?.at(-1),
	).toEqual({
		oldLine: 21,
		newLine: 21,
		text: "line 21",
	});
	expect(hiddenContextRange(tail, CONTEXT_CHUNK_SIZE)).toEqual({
		startLine: 22,
		endLine: 31,
	});
});

test("Expand all preserves both coordinates after a net line offset", () => {
	const [between] = diffContextGaps([hunk(1, 1, 1, 3), hunk(8, 1, 10, 1)], 12);
	expect(between).toEqual({
		id: "between-0-1",
		position: "between",
		oldStart: 2,
		oldEnd: 7,
		newStart: 4,
		newEnd: 9,
	});
	if (!between) throw new Error("Expected inter-hunk gap");
	const source = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
	expect(revealedContextLines(between, source, 999)).toEqual([
		{ oldLine: 2, newLine: 4, text: "line 4" },
		{ oldLine: 3, newLine: 5, text: "line 5" },
		{ oldLine: 4, newLine: 6, text: "line 6" },
		{ oldLine: 5, newLine: 7, text: "line 7" },
		{ oldLine: 6, newLine: 8, text: "line 8" },
		{ oldLine: 7, newLine: 9, text: "line 9" },
	]);
});

test("does not number a terminal newline as an empty source line", () => {
	expect(splitSourceLines("one\ntwo\n")).toEqual(["one", "two"]);
	expect(splitSourceLines("one\n\n")).toEqual(["one", ""]);
});
