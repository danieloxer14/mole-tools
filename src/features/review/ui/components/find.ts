import type { DiffLine, ParsedFileDiff } from "../../../../shared/diff-parse";

export type FindSide = "new" | "old";

/**
 * A rendered diff line that find-in-file can match and scroll to.
 *
 * `id` is stable and unique within a file; it doubles as the DOM scroll anchor
 * (`data-find-line`) and the highlight key, so the ordered list produced here
 * lines up exactly with the rows DiffTable renders.
 */
export interface FindLine {
	id: string;
	side: FindSide;
	hunkHeader: string;
	oldLine: number | null;
	newLine: number | null;
	text: string;
}

/**
 * Inter-hunk context gap: source lines the UI hides behind an "Expand lines …"
 * toggle between two consecutive hunks.
 */
export interface ContextRange {
	startLine: number;
	endLine: number;
	lines: { line: number; text: string }[];
	side: FindSide;
}

/**
 * The render-time find context threaded from DiffView down to every diff row.
 *
 * - `query`: the active search text (empty when find is idle).
 * - `currentId`: the id of the match currently highlighted, or null.
 * - `registerRow`: registers a rendered row's DOM node so find can scroll to it.
 * - `forceContext`: when true, inter-hunk context is shown regardless of its
 *   local toggle so hidden matches stay reachable.
 */
export interface FindRender {
	query: string;
	currentId: string | null;
	registerRow: (id: string, el: HTMLElement | null) => void;
	forceContext: boolean;
}

/**
 * Case-insensitive literal substring test. No regex, no whole-word matching.
 * An empty query matches nothing.
 */
export function lineTextMatches(text: string, query: string): boolean {
	if (!query) return false;
	return text.toLowerCase().includes(query.toLowerCase());
}

/** Stable id for a hunk diff line. */
export function diffLineId(header: string, line: DiffLine): string {
	return `h:${header}:${line.oldLine ?? "-"}:${line.newLine ?? "-"}`;
}

/** Stable id for an inter-hunk context line. */
export function contextLineId(side: FindSide, line: number): string {
	return `c:${side}:${line}`;
}

/**
 * The inter-hunk context ranges between consecutive hunks, in render order. Each
 * range holds the source lines (from `fileContents`) that the UI hides behind an
 * expand toggle. When `fileContents` is unavailable the range carries no lines,
 * matching the "context source unavailable" rendering.
 */
export function contextRanges(
	file: ParsedFileDiff,
	fileContents: string | null,
	side: FindSide,
): ContextRange[] {
	const sourceLines = fileContents?.split(/\r?\n/) ?? null;
	const hunks = file.hunks;
	const ranges: ContextRange[] = [];
	for (let i = 0; i < hunks.length - 1; i++) {
		const hunk = hunks[i];
		const next = hunks[i + 1];
		if (!hunk || !next) continue;
		const currentStart = side === "old" ? hunk.oldStart : hunk.newStart;
		const currentLength = side === "old" ? hunk.oldLines : hunk.newLines;
		const nextStart = side === "old" ? next.oldStart : next.newStart;
		const contextStart = currentStart + currentLength;
		if (nextStart === undefined || nextStart <= contextStart) continue;
		const lines = sourceLines
			? sourceLines
					.slice(contextStart - 1, nextStart - 1)
					.map((text, offset) => ({ line: contextStart + offset, text }))
			: [];
		ranges.push({
			startLine: contextStart,
			endLine: nextStart - 1,
			lines,
			side,
		});
	}
	return ranges;
}

/**
 * The ordered list of rendered diff lines find-in-file searches: every hunk line
 * plus, when `includeContext`, the inter-hunk context between hunks. The order
 * matches the rendered table, so ids line up with DOM rows.
 */
export function collectFindLines(
	file: ParsedFileDiff,
	fileContents: string | null,
	includeContext: boolean,
): FindLine[] {
	const side: FindSide = file.status === "deleted" ? "old" : "new";
	const ranges = includeContext ? contextRanges(file, fileContents, side) : [];
	const out: FindLine[] = [];
	for (let i = 0; i < file.hunks.length; i++) {
		const hunk = file.hunks[i];
		if (!hunk) continue;
		for (const line of hunk.lines) {
			out.push({
				id: diffLineId(hunk.header, line),
				side: line.kind === "del" ? "old" : "new",
				hunkHeader: hunk.header,
				oldLine: line.oldLine,
				newLine: line.newLine,
				text: line.text,
			});
		}
		const range = ranges[i];
		if (!range) continue;
		for (const line of range.lines) {
			out.push({
				id: contextLineId(range.side, line.line),
				side: range.side,
				hunkHeader: "",
				oldLine: range.side === "old" ? line.line : null,
				newLine: range.side === "new" ? line.line : null,
				text: line.text,
			});
		}
	}
	return out;
}

/** Matched lines, in document order, for a query. Empty query yields none. */
export function findMatches(
	file: ParsedFileDiff,
	fileContents: string | null,
	query: string,
	includeContext: boolean,
): FindLine[] {
	if (!query) return [];
	const needle = query.toLowerCase();
	return collectFindLines(file, fileContents, includeContext).filter((line) =>
		line.text.toLowerCase().includes(needle),
	);
}

/**
 * Step the active match index by `direction` (+1 next, -1 previous), wrapping
 * within `count`. With no matches the index is returned unchanged, so a
 * no-match query neither scrolls nor moves the counter.
 */
export function stepMatchIndex(
	current: number,
	count: number,
	direction: 1 | -1,
): number {
	if (count <= 0) return current;
	return (((current + direction) % count) + count) % count;
}
