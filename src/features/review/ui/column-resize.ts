export type ReviewColumn = "left" | "right";

const compactColumnWidths = { left: 260, right: 270 } as const;
const regularColumnWidths = { left: 300, right: 320 } as const;

export function initialColumnWidth(
	column: ReviewColumn,
	viewportWidth: number,
): number {
	return (viewportWidth <= 1200 ? compactColumnWidths : regularColumnWidths)[
		column
	];
}

export function clampColumnWidth(
	requestedWidth: number,
	minimumWidth: number,
	availableWidth: number,
): number {
	return Math.max(
		minimumWidth,
		Math.min(requestedWidth, minimumWidth * 3, availableWidth),
	);
}
