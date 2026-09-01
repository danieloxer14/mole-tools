/** Which per-line action started the drag. */
export type DragAction = "tag" | "comment";

/**
 * A drag-addressable diff row. `hunkIndex` is the row's index into
 * `ParsedFileDiff.hunks`, not a hunk header: headers are not guaranteed unique
 * or colon-free, and the index is what `DiffTable` already has in hand.
 */
export interface DiffDragRow {
	hunkIndex: number;
	side: "new" | "old";
	line: number;
}

export interface DiffDragState {
	action: DragAction;
	origin: DiffDragRow;
	end: DiffDragRow;
}

/** Inclusive, normalised line range. */
export interface DragRange {
	startLine: number;
	endLine: number;
}

/**
 * The one clamp rule. A candidate becomes the new endpoint only when it is a
 * real drag row in the origin's hunk on the origin's side; anything else — a
 * different hunk, the other side, a row with no number on the locked side, a
 * revealed context row, or no row at all — leaves the endpoint where it was.
 *
 * Returning `previous` unchanged (rather than clamping to a computed bound) is
 * what makes crossed-over rows non-endpoints while keeping the range contiguous.
 */
export function nextDiffDragEnd(
	origin: DiffDragRow,
	previous: DiffDragRow,
	candidate: DiffDragRow | null,
): DiffDragRow {
	if (candidate === null) return previous;
	if (candidate.hunkIndex !== origin.hunkIndex) return previous;
	if (candidate.side !== origin.side) return previous;
	return candidate;
}

/** Inclusive range between the two endpoints, normalised for upward drags. */
export function diffDragRange(
	origin: DiffDragRow,
	end: DiffDragRow,
): DragRange {
	return {
		startLine: Math.min(origin.line, end.line),
		endLine: Math.max(origin.line, end.line),
	};
}

/** True when `row` should be highlighted for the given drag. */
export function isRowInDiffDrag(
	row: DiffDragRow,
	drag: DiffDragState,
): boolean {
	if (row.hunkIndex !== drag.origin.hunkIndex) return false;
	if (row.side !== drag.origin.side) return false;
	const { startLine, endLine } = diffDragRange(drag.origin, drag.end);
	return row.line >= startLine && row.line <= endLine;
}

/** A rendered markdown block that recovered its source range. */
export interface MarkdownDragBlock {
	blockId: string;
	startLine: number;
	endLine: number;
}

export interface MarkdownDragState {
	action: DragAction;
	origin: MarkdownDragBlock;
	end: MarkdownDragBlock;
}

/**
 * Markdown has no hunks and no sides, so the only rejection is "not a mapped
 * block": blocks whose source range was not recovered carry no data attributes,
 * so they resolve to `null` and are crossed over rather than ending the drag.
 */
export function nextMarkdownDragEnd(
	previous: MarkdownDragBlock,
	candidate: MarkdownDragBlock | null,
): MarkdownDragBlock {
	return candidate ?? previous;
}

/** Union of the two blocks' source spans, normalised for upward drags. */
export function markdownDragRange(
	origin: MarkdownDragBlock,
	end: MarkdownDragBlock,
): DragRange {
	return {
		startLine: Math.min(origin.startLine, end.startLine),
		endLine: Math.max(origin.endLine, end.endLine),
	};
}

/** True when `block` should be highlighted for the given drag. */
export function isBlockInMarkdownDrag(
	block: MarkdownDragBlock,
	drag: MarkdownDragState,
): boolean {
	const { startLine, endLine } = markdownDragRange(drag.origin, drag.end);
	return block.startLine >= startLine && block.endLine <= endLine;
}

/** Distance from a scroll edge, in px, at which a held drag starts scrolling. */
export const DRAG_SCROLL_EDGE_PX = 48;
/** Scroll delta applied per animation frame while auto-scrolling. */
export const DRAG_SCROLL_STEP_PX = 14;

/**
 * Signed auto-scroll delta for a pointer held at `clientY` inside a container
 * spanning `top`..`bottom`. Zero anywhere in the middle band.
 */
export function dragScrollDelta(
	clientY: number,
	top: number,
	bottom: number,
): number {
	if (clientY < top + DRAG_SCROLL_EDGE_PX) return -DRAG_SCROLL_STEP_PX;
	if (clientY > bottom - DRAG_SCROLL_EDGE_PX) return DRAG_SCROLL_STEP_PX;
	return 0;
}
