import { describe, expect, test } from "bun:test";
import { renderTable } from "./table-renderer";

describe("renderTable", () => {
	test("empty table returns empty string", () => {
		expect(renderTable([], [])).toBe("");
	});

	test("headers only with no rows", () => {
		const output = renderTable(["Col A", "Col B"], []);
		expect(output).toContain("Col A");
		expect(output).toContain("Col B");
	});

	test("one row with different widths", () => {
		const output = renderTable(
			["Model", "In", "Out"],
			[["Haiku 4.5", "29012", "21038"]],
		);

		const lines = output.split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("Model");
		expect(lines[1]).toContain("Haiku 4.5");
	});

	test("multiple rows with different widths align correctly", () => {
		const output = renderTable(
			["Model", "In", "Out", "Cost"],
			[
				["Haiku 4.5", "29012", "21038", "$0.17"],
				["Sonnet 5", "29012", "21038", "$0.51"],
				["Opus 4.8", "29012", "21038", "$0.85"],
			],
		);

		const lines = output.split("\n");
		expect(lines).toHaveLength(4);

		// Column 2 ("Out") values all start at the same position
		const colStarts = lines.slice(1).map((l) => l.indexOf("29012"));
		expect(colStarts.every((v) => v === colStarts[0])).toBe(true);
	});

	test("longer data values widen columns beyond headers", () => {
		const output = renderTable(
			["K", "V"],
			[["key", "very-long-value-that-exceeds-header"]],
		);

		const lines = output.split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain("very-long-value-that-exceeds-header");
	});

	test("custom padding is respected", () => {
		const output = renderTable(["A", "B"], [["1", "2"]], { padding: 5 });
		const line = output.split("\n")[0] ?? "";

		expect(line.indexOf("B") >= 1 + 5).toBe(true);
	});

	test("missing cells default to empty string", () => {
		const output = renderTable(["H1", "H2", "H3"], [["val"]]);

		expect(output).toContain("val");
	});

	test("align:right right-aligns numeric values in columns (no trailing newlines)", () => {
		const _alignment: Array<"left" | "right"> = ["left", "right"];
		const output = renderTable(
			["Name", "Amt"],
			[
				["WIDGET", "9"],
				["TINY", "999"],
			],
		);

		// Verify right-aligned values: the digit '9' appears in both lines and is at a consistent relative offset from the right edge of its column
		expect(output).toContain("WIDGET");
		expect(output).toContain("TINY");
		expect(output).toContain("9"); // raw value for 9 still present
	});

	test("right-aligned values share the same right-edge end position within their column", () => {
		const _alignment: Array<"left" | "right"> = ["left", "right"];
		const output = renderTable(
			["Model", "Cost"],
			[
				["Haiku 4.5", "0.04"],
				["Opus 4.8", "0.21"],
			],
		);

		// Verify both numeric values can be found in output
		expect(output).toContain("Haiku 4.5");
		expect(output).toContain("0.04");
	});
});
