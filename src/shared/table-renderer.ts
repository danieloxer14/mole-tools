export interface TableConfig {
  /** Minimum padding between columns (default 2) */
  padding?: number;
}

/** Per-column alignment — defaults to left-aligned when omitted. */
export type CellAlign = "left" | "right";

const DEFAULT_PADDING = 2;

/**
 * Render a monospace-aligned table from headers and row values.
 * Column widths are computed from the widest cell per column.
 * Pass `align` to control per-column alignment ("left" or "right").
 * Empty input produces an empty string.
 */
export function renderTable(
  headers: string[],
  rows: string[][],
  config: TableConfig & { align?: CellAlign[] } = {},
): string {
  const { padding = DEFAULT_PADDING, align } = config;

  if (headers.length === 0) return "";

  const colCount = headers.length;
  const allRows = [headers, ...rows];

  // Compute column widths from all cells
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = 0;
    for (const row of allRows) {
      const cell = row[c] ?? "";
      if (cell.length > max) max = cell.length;
    }
    colWidths[c] = max;
  }

  const lines: string[] = [];

  for (const row of allRows) {
    const cells: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] ?? "";
      const targetWidth = colWidths[c]! + (c < colCount - 1 ? padding : 0);
      if (targetWidth === 0) continue;

      // Right-align when the column alignment is "right"
      if (align && align[c] === "right") {
        cells.push(cell.padStart(targetWidth));
      } else {
        cells.push(cell.padEnd(targetWidth));
      }
    }
    lines.push(cells.join(""));
  }

  return lines.join("\n");
}
