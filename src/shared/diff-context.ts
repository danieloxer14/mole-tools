import type { DiffHunk } from "./diff-parse";

export const CONTEXT_CHUNK_SIZE = 20;

export type ContextGapPosition = "head" | "between" | "tail";

/** Unchanged source lines omitted between diff hunks. */
export interface ContextGap {
	id: string;
	position: ContextGapPosition;
	oldStart: number;
	oldEnd: number;
	newStart: number;
	newEnd: number;
}

export interface ContextLine {
	oldLine: number;
	newLine: number;
	text: string;
}

/**
 * Splits UTF-8 source into displayed lines. A terminal newline terminates the
 * preceding line; it does not create an extra, empty line-numbered row.
 */
export function splitSourceLines(source: string): string[] {
	if (source.length === 0) return [];
	const lines = source.split(/\r?\n/);
	if (/\r?\n$/.test(source)) lines.pop();
	return lines;
}

/**
 * Derives every unchanged region outside parsed hunks. Old/new coordinates are
 * carried independently because preceding additions and deletions shift them.
 * The tail requires the fetched new-file line count; callers may pass null
 * while source is still loading or unavailable.
 */
export function diffContextGaps(
	hunks: readonly DiffHunk[],
	sourceLineCount: number | null,
): ContextGap[] {
	const gaps: ContextGap[] = [];
	let oldCursor = 1;
	let newCursor = 1;

	for (const [index, hunk] of hunks.entries()) {
		const oldLength = hunk.oldStart - oldCursor;
		const newLength = hunk.newStart - newCursor;
		if (oldLength > 0 && oldLength === newLength) {
			gaps.push({
				id: index === 0 ? "head" : `between-${index - 1}-${index}`,
				position: index === 0 ? "head" : "between",
				oldStart: oldCursor,
				oldEnd: hunk.oldStart - 1,
				newStart: newCursor,
				newEnd: hunk.newStart - 1,
			});
		}
		oldCursor = hunk.oldStart + hunk.oldLines;
		newCursor = hunk.newStart + hunk.newLines;
	}

	if (sourceLineCount === null || hunks.length === 0) return gaps;
	const tailLength = sourceLineCount - newCursor + 1;
	if (tailLength > 0) {
		gaps.push({
			id: "tail",
			position: "tail",
			oldStart: oldCursor,
			oldEnd: oldCursor + tailLength - 1,
			newStart: newCursor,
			newEnd: sourceLineCount,
		});
	}
	return gaps;
}

export function gapLineCount(gap: ContextGap): number {
	return gap.newEnd - gap.newStart + 1;
}

/**
 * Returns the currently revealed portion of a gap. Head gaps grow backwards
 * from their hunk; tail and inter-hunk gaps grow forwards.
 */
export function revealedContextLines(
	gap: ContextGap,
	sourceLines: readonly string[] | null,
	revealedCount: number,
): ContextLine[] | null {
	if (sourceLines === null) return null;
	const count = Math.min(Math.max(revealedCount, 0), gapLineCount(gap));
	if (count === 0) return [];
	const newStart =
		gap.position === "head" ? gap.newEnd - count + 1 : gap.newStart;
	const oldStart =
		gap.position === "head" ? gap.oldEnd - count + 1 : gap.oldStart;
	return sourceLines
		.slice(newStart - 1, newStart - 1 + count)
		.map((text, index) => ({
			oldLine: oldStart + index,
			newLine: newStart + index,
			text,
		}));
}

/** Lines still hidden by the requested reveal count, in new-file coordinates. */
export function hiddenContextRange(
	gap: ContextGap,
	revealedCount: number,
): { startLine: number; endLine: number } | null {
	const count = Math.min(Math.max(revealedCount, 0), gapLineCount(gap));
	if (count === gapLineCount(gap)) return null;
	return gap.position === "head"
		? { startLine: gap.newStart, endLine: gap.newEnd - count }
		: { startLine: gap.newStart + count, endLine: gap.newEnd };
}
