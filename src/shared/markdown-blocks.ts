/**
 * Maps top-level markdown block source text back to 1-based line ranges in
 * the original document. Pure and DOM-free so it is unit-testable under
 * `bun:test` without a DOMPurify/jsdom dependency (see ticket
 * `specs/review/tickets/01-rendered-view-line-commenting.md`).
 *
 * marked (16.4.2) tokens expose only `raw`/`text`, not `loc`/`startLine`, so
 * the range is recovered by walking a monotonic cursor through `source` and
 * locating each block's `raw` text with `indexOf(raw, cursor)`. Because
 * blocks are supplied in document order and the cursor only ever advances,
 * this also resolves duplicate/identical `raw` text between two blocks
 * correctly: each lookup starts after the previous block's match, so it
 * finds the next occurrence rather than re-matching the first one.
 */
export interface BlockRange {
	startLine: number;
	endLine: number;
}

function countNewlines(text: string): number {
	let count = 0;
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "\n") count++;
	}
	return count;
}

/**
 * Returns one range (or `null` when a block's `raw` text cannot be located
 * from the current cursor position) per entry in `rawBlocks`, in order.
 * A `null` result means the block should be treated as non-commentable
 * rather than guessed at.
 */
export function mapBlockSourceLines(
	source: string,
	rawBlocks: readonly string[],
): (BlockRange | null)[] {
	let cursor = 0;
	return rawBlocks.map((raw) => {
		if (raw.length === 0) return null;
		const index = source.indexOf(raw, cursor);
		if (index === -1) return null;
		const startLine = countNewlines(source.slice(0, index)) + 1;
		const trimmed = raw.replace(/\n+$/, "");
		const endLine = startLine + countNewlines(trimmed);
		cursor = index + raw.length;
		return { startLine, endLine };
	});
}
