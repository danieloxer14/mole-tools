/// <reference lib="dom" />
/**
 * Scrolls the selected Changed-files row into view in the centre column's
 * file tree.
 *
 * `main.tsx` registers each rendered row by file path and calls this whenever
 * the selection changes (file-tree clicks, layer file chips, chat file
 * references). `block: "nearest"` is the load-bearing behavior: a fully
 * visible row does not move, a clipped row is nudged the minimum distance,
 * and a row outside the tree's scroll port is brought to the nearest edge —
 * so selecting a file the reviewer can already see never re-jumps the tree.
 */
export function scrollSelectedFileRow(
	rows: ReadonlyMap<string, HTMLElement>,
	path: string | null,
): void {
	if (path === null) return;
	rows.get(path)?.scrollIntoView({ block: "nearest" });
}
