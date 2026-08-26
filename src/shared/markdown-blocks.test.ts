import { expect, test } from "bun:test";
import { mapBlockSourceLines } from "./markdown-blocks";

test("maps a heading to its single source line", () => {
	const source = "# Title\n\nBody text.\n";
	const [heading] = mapBlockSourceLines(source, ["# Title\n\n"]);
	expect(heading).toEqual({ startLine: 1, endLine: 1 });
});

test("maps a multi-line fenced code block to its full line range", () => {
	const source = ["Intro.", "", "```ts", "const a = 1;", "```", ""].join("\n");
	const fence = "```ts\nconst a = 1;\n```\n";
	const [, code] = mapBlockSourceLines(source, ["Intro.\n\n", fence]);
	expect(code).toEqual({ startLine: 3, endLine: 5 });
});

test("maps a table block spanning multiple lines", () => {
	const source = [
		"# Title",
		"",
		"| a | b |",
		"| - | - |",
		"| 1 | 2 |",
		"",
	].join("\n");
	const table = "| a | b |\n| - | - |\n| 1 | 2 |\n";
	const [, mapped] = mapBlockSourceLines(source, ["# Title\n\n", table]);
	expect(mapped).toEqual({ startLine: 3, endLine: 5 });
});

test("resolves duplicate/normalized raw text via the monotonic cursor", () => {
	// Two identical one-line paragraphs: naive indexOf without a cursor
	// would map both to the first occurrence. A monotonic cursor advances
	// past each match, so the second lookup finds the second occurrence.
	const source = "Same text.\n\nSame text.\n";
	const [first, second] = mapBlockSourceLines(source, [
		"Same text.\n\n",
		"Same text.\n",
	]);
	expect(first).toEqual({ startLine: 1, endLine: 1 });
	expect(second).toEqual({ startLine: 3, endLine: 3 });
});

test("returns null when a block's raw text cannot be found from the cursor", () => {
	const source = "# Title\n\nBody.\n";
	// Second entry claims text that never occurs after the first match ends.
	const [, missing] = mapBlockSourceLines(source, [
		"# Title\n\n",
		"Not present anywhere.\n",
	]);
	expect(missing).toBeNull();
});

test("returns null for an empty raw block instead of matching an empty substring", () => {
	const source = "# Title\n\nBody.\n";
	const [empty] = mapBlockSourceLines(source, [""]);
	expect(empty).toBeNull();
});
