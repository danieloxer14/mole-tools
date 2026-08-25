import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	type ParsedFileDiff,
	parseFileDiff,
	parseFileDiffs,
} from "./diff-parse";

async function patch(name: string): Promise<string> {
	return Bun.file(
		join(import.meta.dir, "../../test/fixtures/diff", name),
	).text();
}

function file(path: string, patchText: string, insertions = 0, deletions = 0) {
	return {
		path,
		statOnly: false,
		patch: patchText,
		insertions,
		deletions,
	};
}

describe("parseFileDiff", () => {
	test("parses added files with new-side lines", async () => {
		const parsed = parseFileDiff(
			file("new.txt", await patch("added.patch"), 2, 0),
		);
		expect(parsed).toMatchObject({
			oldPath: null,
			newPath: "new.txt",
			status: "added",
			binary: false,
			insertions: 2,
			deletions: 0,
		});
		expect(parsed.hunks[0]?.lines).toEqual([
			{ kind: "add", oldLine: null, newLine: 1, text: "first line" },
			{ kind: "add", oldLine: null, newLine: 2, text: "second line" },
		]);
	});

	test("parses deleted files with old-side lines", async () => {
		const parsed = parseFileDiff(
			file("old.txt", await patch("deleted.patch"), 0, 2),
		);
		expect(parsed).toMatchObject({
			oldPath: "old.txt",
			newPath: null,
			status: "deleted",
		});
		expect(parsed.hunks[0]?.lines).toEqual([
			{ kind: "del", oldLine: 1, newLine: null, text: "first line" },
			{ kind: "del", oldLine: 2, newLine: null, text: "second line" },
		]);
	});

	test("tracks context and changed lines in modified files", async () => {
		const parsed = parseFileDiff(
			file("src/app.ts", await patch("modified.patch"), 2, 1),
		);
		expect(parsed.status).toBe("modified");
		expect(parsed.hunks[0]?.lines).toEqual([
			{ kind: "context", oldLine: 1, newLine: 1, text: "const before = true;" },
			{ kind: "del", oldLine: 2, newLine: null, text: "old line" },
			{ kind: "add", oldLine: null, newLine: 2, text: "new line" },
			{ kind: "add", oldLine: null, newLine: 3, text: "another line" },
		]);
	});

	test("keeps header-looking source lines inside modified hunks", () => {
		const parsed = parseFileDiff(
			file(
				"src/app.ts",
				[
					"diff --git a/src/app.ts b/src/app.ts",
					"--- a/src/app.ts",
					"+++ b/src/app.ts",
					"@@ -1,2 +1,2 @@",
					"--- old",
					"+++ new",
					"-gone",
					"+back",
				].join("\n"),
			),
		);

		expect(parsed.oldPath).toBe("src/app.ts");
		expect(parsed.newPath).toBe("src/app.ts");
		expect(parsed.hunks[0]?.lines).toEqual([
			{ kind: "del", oldLine: 1, newLine: null, text: "-- old" },
			{ kind: "add", oldLine: null, newLine: 1, text: "++ new" },
			{ kind: "del", oldLine: 2, newLine: null, text: "gone" },
			{ kind: "add", oldLine: null, newLine: 2, text: "back" },
		]);
	});

	test("recognizes renames without requiring a hunk", async () => {
		const parsed = parseFileDiff(
			file("new-name.ts", await patch("renamed.patch")),
		);
		expect(parsed).toMatchObject({
			oldPath: "old-name.ts",
			newPath: "new-name.ts",
			status: "renamed",
			hunks: [],
		});
	});

	test("recognizes binary files and suppresses hunks", async () => {
		const parsed = parseFileDiff(
			file("image.png", await patch("binary.patch")),
		);
		expect(parsed).toMatchObject({
			oldPath: "image.png",
			newPath: "image.png",
			status: "modified",
			binary: true,
			hunks: [],
		});
	});

	test("keeps line counters independent across multiple hunks", async () => {
		const parsed = parseFileDiff(
			file("src/multi.ts", await patch("multi-hunk.patch"), 3, 2),
		);
		expect(parsed.hunks).toHaveLength(2);
		expect(parsed.hunks[1]?.lines).toEqual([
			{ kind: "context", oldLine: 10, newLine: 10, text: "context" },
			{ kind: "del", oldLine: 11, newLine: null, text: "old second" },
			{ kind: "add", oldLine: null, newLine: 11, text: "new second" },
			{ kind: "add", oldLine: null, newLine: 12, text: "extra second" },
		]);
	});

	test("attaches no-final-newline markers to preceding lines", async () => {
		const parsed = parseFileDiff(
			file("no-newline.txt", await patch("no-final-newline.patch"), 1, 1),
		);
		const lines = parsed.hunks[0]?.lines ?? [];
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ kind: "del", oldLine: 1, newLine: null });
		expect(lines[1]).toMatchObject({ kind: "add", oldLine: null, newLine: 1 });
		expect(lines[0]?.text).toContain("No newline at end of file");
		expect(lines[1]?.text).toContain("No newline at end of file");
	});

	test("returns numstat-only files without inventing hunks", () => {
		const parsed = parseFileDiff({
			path: "ignored.ts",
			statOnly: true,
			patch: null,
			insertions: 4,
			deletions: 2,
		});
		expect(parsed).toEqual<ParsedFileDiff>({
			oldPath: "ignored.ts",
			newPath: "ignored.ts",
			status: "modified",
			binary: false,
			insertions: 4,
			deletions: 2,
			hunks: [],
		});
	});

	test("parses a collection in input order", async () => {
		const parsed = parseFileDiffs([
			file("new.txt", await patch("added.patch")),
			file("old.txt", await patch("deleted.patch")),
		]);
		expect(parsed.map((entry) => entry.status)).toEqual(["added", "deleted"]);
	});
});
