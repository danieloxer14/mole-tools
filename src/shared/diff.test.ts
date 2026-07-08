import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../ports/vcs";
import { filterDiff } from "./diff";

function file(path: string, patch = "@@ patch @@"): FileDiff {
	return { path, statOnly: false, patch, insertions: 1, deletions: 0 };
}

describe("filterDiff", () => {
	test("leaves non-matching files with full patch", () => {
		const result = filterDiff([file("src/index.ts")], ["*.snap"]);
		expect(result).toEqual([file("src/index.ts")]);
	});

	test("strips patch body and marks statOnly for matching glob", () => {
		const result = filterDiff([file("bun.lockb")], ["bun.lockb"]);
		expect(result).toEqual([
			{
				path: "bun.lockb",
				statOnly: true,
				patch: null,
				insertions: 1,
				deletions: 0,
			},
		]);
	});

	test("matches nested paths via glob", () => {
		const result = filterDiff(
			[file("src/__snapshots__/a.snap")],
			["**/*.snap"],
		);
		expect(result[0]).toMatchObject({ statOnly: true, patch: null });
	});

	test("returns files unchanged when no ignore globs configured", () => {
		const files = [file("a.ts"), file("b.ts")];
		expect(filterDiff(files, [])).toEqual(files);
	});

	test("only affects files matching one of multiple globs", () => {
		const result = filterDiff(
			[file("a.snap"), file("b.ts")],
			["*.snap", "*.lock"],
		);
		expect(result[0]?.statOnly).toBe(true);
		expect(result[1]?.statOnly).toBe(false);
	});
});
