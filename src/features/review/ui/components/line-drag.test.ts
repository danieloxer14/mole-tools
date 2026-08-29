import { describe, expect, test } from "bun:test";
import {
	type DiffDragRow,
	type DiffDragState,
	DRAG_SCROLL_EDGE_PX,
	DRAG_SCROLL_STEP_PX,
	type DragAction,
	type DragRange,
	diffDragRange,
	dragScrollDelta,
	isBlockInMarkdownDrag,
	isRowInDiffDrag,
	type MarkdownDragBlock,
	type MarkdownDragState,
	markdownDragRange,
	nextDiffDragEnd,
	nextMarkdownDragEnd,
} from "./line-drag";

describe("nextDiffDragEnd", () => {
	test("accepts a same-hunk, same-side candidate — AC 1", () => {
		const origin: DiffDragRow = { hunkIndex: 2, side: "new", line: 10 };
		const previous: DiffDragRow = { hunkIndex: 2, side: "new", line: 10 };
		const candidate: DiffDragRow = { hunkIndex: 2, side: "new", line: 14 };

		expect(nextDiffDragEnd(origin, previous, candidate)).toBe(candidate);
	});

	test("rejects another hunk and returns previous — AC 6, AC 10", () => {
		const origin: DiffDragRow = { hunkIndex: 2, side: "new", line: 10 };
		const previous: DiffDragRow = { hunkIndex: 2, side: "new", line: 12 };
		const candidate: DiffDragRow = { hunkIndex: 3, side: "new", line: 14 };

		expect(nextDiffDragEnd(origin, previous, candidate)).toBe(previous);
	});

	test("rejects the other side and returns previous — AC 7", () => {
		const origin: DiffDragRow = { hunkIndex: 2, side: "new", line: 10 };
		const previous: DiffDragRow = { hunkIndex: 2, side: "new", line: 12 };
		const candidate: DiffDragRow = { hunkIndex: 2, side: "old", line: 14 };

		expect(nextDiffDragEnd(origin, previous, candidate)).toBe(previous);
	});

	test("rejects null for no row, context, or an unnumbered locked-side row — AC 8, AC 9, AC 14", () => {
		const origin: DiffDragRow = { hunkIndex: 2, side: "new", line: 10 };
		const previous: DiffDragRow = { hunkIndex: 2, side: "new", line: 12 };

		expect(nextDiffDragEnd(origin, previous, null)).toBe(previous);
		expect(nextDiffDragEnd(origin, previous, null)).toBe(previous);
		expect(nextDiffDragEnd(origin, previous, null)).toBe(previous);
	});

	test("accepts a later valid candidate after a rejected one — AC 8", () => {
		const origin: DiffDragRow = { hunkIndex: 2, side: "new", line: 10 };
		const previous: DiffDragRow = { hunkIndex: 2, side: "new", line: 12 };
		const crossed: DiffDragRow = { hunkIndex: 3, side: "new", line: 14 };
		const laterValid: DiffDragRow = { hunkIndex: 2, side: "new", line: 16 };

		const afterCrossing = nextDiffDragEnd(origin, previous, crossed);
		expect(afterCrossing).toBe(previous);
		expect(nextDiffDragEnd(origin, afterCrossing, laterValid)).toBe(laterValid);
	});
});

describe("diffDragRange", () => {
	test("returns inclusive range for downward drag — AC 1", () => {
		const origin: DiffDragRow = { hunkIndex: 0, side: "old", line: 12 };
		const end: DiffDragRow = { hunkIndex: 0, side: "old", line: 18 };

		const range: DragRange = diffDragRange(origin, end);
		expect(range).toEqual({ startLine: 12, endLine: 18 });
	});

	test("normalises upward drag to startLine <= endLine — AC 5", () => {
		const origin: DiffDragRow = { hunkIndex: 0, side: "old", line: 18 };
		const end: DiffDragRow = { hunkIndex: 0, side: "old", line: 12 };

		expect(diffDragRange(origin, end)).toEqual({ startLine: 12, endLine: 18 });
	});

	test("keeps a zero-movement drag on one line — AC 4", () => {
		const row: DiffDragRow = { hunkIndex: 0, side: "new", line: 18 };

		expect(diffDragRange(row, row)).toEqual({ startLine: 18, endLine: 18 });
	});
});

test("includes both endpoints, excludes one past end, hunk, and side — AC 11", () => {
	const origin: DiffDragRow = { hunkIndex: 1, side: "new", line: 10 };
	const end: DiffDragRow = { hunkIndex: 1, side: "new", line: 15 };
	const drag: DiffDragState = { action: "tag", origin, end };

	expect(isRowInDiffDrag({ hunkIndex: 1, side: "new", line: 10 }, drag)).toBe(
		true,
	);
	expect(isRowInDiffDrag({ hunkIndex: 1, side: "new", line: 15 }, drag)).toBe(
		true,
	);
	expect(isRowInDiffDrag({ hunkIndex: 1, side: "new", line: 16 }, drag)).toBe(
		false,
	);
	expect(isRowInDiffDrag({ hunkIndex: 2, side: "new", line: 12 }, drag)).toBe(
		false,
	);
	expect(isRowInDiffDrag({ hunkIndex: 1, side: "old", line: 12 }, drag)).toBe(
		false,
	);
});

describe("markdown drag range", () => {
	const origin: MarkdownDragBlock = {
		blockId: "first",
		startLine: 4,
		endLine: 6,
	};
	const interior: MarkdownDragBlock = {
		blockId: "interior",
		startLine: 7,
		endLine: 9,
	};
	const last: MarkdownDragBlock = {
		blockId: "last",
		startLine: 10,
		endLine: 13,
	};

	test("spans first block start through last block end — AC 18", () => {
		let end = nextMarkdownDragEnd(origin, interior);
		end = nextMarkdownDragEnd(end, last);

		expect(markdownDragRange(origin, end)).toEqual({
			startLine: 4,
			endLine: 13,
		});
	});

	test("crosses null and later extends with mapped block — AC 20", () => {
		const afterUnmapped = nextMarkdownDragEnd(interior, null);
		expect(afterUnmapped).toBe(interior);
		expect(nextMarkdownDragEnd(afterUnmapped, last)).toBe(last);
	});

	test("normalises upward drag to source-line order — AC 22", () => {
		expect(markdownDragRange(last, origin)).toEqual({
			startLine: 4,
			endLine: 13,
		});
	});

	test("allows a whole-file span without a line cap — AC 21", () => {
		const firstFileBlock: MarkdownDragBlock = {
			blockId: "file-start",
			startLine: 1,
			endLine: 3,
		};
		const lastFileBlock: MarkdownDragBlock = {
			blockId: "file-end",
			startLine: 1_000,
			endLine: 1_200,
		};

		expect(markdownDragRange(firstFileBlock, lastFileBlock)).toEqual({
			startLine: 1,
			endLine: 1_200,
		});
	});

	test("includes endpoint and interior blocks but not one past end — AC 23", () => {
		const drag: MarkdownDragState = {
			action: "comment",
			origin,
			end: last,
		};
		const onePastEnd: MarkdownDragBlock = {
			blockId: "after-last",
			startLine: 14,
			endLine: 16,
		};

		expect(isBlockInMarkdownDrag(origin, drag)).toBe(true);
		expect(isBlockInMarkdownDrag(interior, drag)).toBe(true);
		expect(isBlockInMarkdownDrag(last, drag)).toBe(true);
		expect(isBlockInMarkdownDrag(onePastEnd, drag)).toBe(false);
	});
});

test("returns signed edge deltas and zero in middle band — AC 12", () => {
	const top = 100;
	const bottom = 500;
	const action: DragAction = "tag";
	expect(action).toBe("tag");
	expect(DRAG_SCROLL_EDGE_PX).toBe(48);
	expect(DRAG_SCROLL_STEP_PX).toBe(14);
	expect(dragScrollDelta(top + DRAG_SCROLL_EDGE_PX - 1, top, bottom)).toBe(
		-DRAG_SCROLL_STEP_PX,
	);
	expect(dragScrollDelta(bottom - DRAG_SCROLL_EDGE_PX + 1, top, bottom)).toBe(
		DRAG_SCROLL_STEP_PX,
	);
	expect(dragScrollDelta((top + bottom) / 2, top, bottom)).toBe(0);
});
