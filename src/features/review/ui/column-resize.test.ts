import { expect, test } from "bun:test";
import { clampColumnWidth, initialColumnWidth } from "./column-resize";

test("uses the current responsive column widths as minimums", () => {
	expect(initialColumnWidth("left", 1200)).toBe(260);
	expect(initialColumnWidth("right", 1200)).toBe(270);
	expect(initialColumnWidth("left", 1201)).toBe(300);
	expect(initialColumnWidth("right", 1201)).toBe(320);
});

test("clamps a column between its minimum and three times that width", () => {
	expect(clampColumnWidth(100, 300, 1200)).toBe(300);
	expect(clampColumnWidth(900, 300, 1200)).toBe(900);
	expect(clampColumnWidth(1200, 300, 1200)).toBe(900);
});

test("preserves the centre column's available space", () => {
	expect(clampColumnWidth(900, 300, 700)).toBe(700);
});
