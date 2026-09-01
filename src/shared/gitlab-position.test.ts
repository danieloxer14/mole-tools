import { describe, expect, test } from "bun:test";
import { PortError } from "../core/errors";
import { parseFileDiff } from "./diff-parse";
import {
	buildPosition,
	type GitLabPositionPayload,
	lineCode,
	validatePosition,
} from "./gitlab-position";

const refs = {
	baseSha: "base-sha",
	startSha: "start-sha",
	headSha: "head-sha",
};

function parsed(path: string, patch: string, insertions = 0, deletions = 0) {
	return parseFileDiff({
		path,
		statOnly: false,
		patch,
		insertions,
		deletions,
	});
}

const modified = parsed(
	"src/app.ts",
	[
		"diff --git a/src/app.ts b/src/app.ts",
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		"@@ -1,3 +1,4 @@",
		" context",
		"-old line",
		"+new line",
		"+another line",
	].join("\n"),
	2,
	1,
);

function expectedHash(path: string, oldLine: number, newLine: number) {
	const hasher = new Bun.CryptoHasher("sha1");
	hasher.update(path);
	return `${hasher.digest("hex")}_${oldLine}_${newLine}`;
}

describe("lineCode", () => {
	test("hashes raw old and new positions", () => {
		expect(lineCode("src/app.ts", 2, 2)).toBe(
			"216381173f187cf4c2baf119193855699f4bc616_2_2",
		);
		expect(lineCode("src/app.ts", 3, 2)).toBe(
			"216381173f187cf4c2baf119193855699f4bc616_3_2",
		);
	});
});

describe("buildPosition", () => {
	test("maps a single new-side line with refs", () => {
		expect(
			buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 2, endLine: 2 },
				modified,
				refs,
			),
		).toEqual({
			position_type: "text",
			base_sha: "base-sha",
			start_sha: "start-sha",
			head_sha: "head-sha",
			old_path: "src/app.ts",
			new_path: "src/app.ts",
			old_line: null,
			new_line: 2,
		});
	});

	test("uses raw hunk cursors for multi-line line-code entries", () => {
		expect(
			buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 2, endLine: 3 },
				modified,
				refs,
			),
		).toEqual({
			position_type: "text",
			base_sha: "base-sha",
			start_sha: "start-sha",
			head_sha: "head-sha",
			old_path: "src/app.ts",
			new_path: "src/app.ts",
			old_line: null,
			new_line: 3,
			line_range: {
				start: {
					line_code: expectedHash("src/app.ts", 3, 2),
					type: "new",
					old_line: null,
					new_line: 2,
				},
				end: {
					line_code: expectedHash("src/app.ts", 3, 3),
					type: "new",
					old_line: null,
					new_line: 3,
				},
			},
		});
	});

	test("maps added files to the new side", () => {
		const file = parsed(
			"new.txt",
			[
				"diff --git a/new.txt b/new.txt",
				"new file mode 100644",
				"--- /dev/null",
				"+++ b/new.txt",
				"@@ -0,0 +1,2 @@",
				"+first",
				"+second",
			].join("\n"),
			2,
		);
		const position = buildPosition(
			{ path: "new.txt", side: "new", startLine: 1, endLine: 2 },
			file,
			refs,
		);
		expect(position.old_path).toBeNull();
		expect(position.new_path).toBe("new.txt");
		expect(position.old_line).toBeNull();
		expect(position.new_line).toBe(2);
		expect(position.line_range?.start).toEqual({
			line_code: expectedHash("new.txt", 0, 1),
			type: "new",
			old_line: null,
			new_line: 1,
		});
	});

	test("maps deleted files to the old side", () => {
		const file = parsed(
			"old.txt",
			[
				"diff --git a/old.txt b/old.txt",
				"deleted file mode 100644",
				"--- a/old.txt",
				"+++ /dev/null",
				"@@ -1,2 +0,0 @@",
				"-first",
				"-second",
			].join("\n"),
			0,
			2,
		);
		const position = buildPosition(
			{ path: "old.txt", side: "old", startLine: 1, endLine: 2 },
			file,
			refs,
		);
		expect(position.old_path).toBe("old.txt");
		expect(position.new_path).toBeNull();
		expect(position.old_line).toBe(2);
		expect(position.new_line).toBeNull();
		expect(position.line_range?.end).toEqual({
			line_code: expectedHash("old.txt", 2, 0),
			type: "old",
			old_line: 2,
			new_line: null,
		});
	});

	test("maps renamed files using new path for line codes", () => {
		const file = parsed(
			"new-name.ts",
			[
				"diff --git a/old-name.ts b/new-name.ts",
				"similarity index 80%",
				"rename from old-name.ts",
				"rename to new-name.ts",
				"@@ -1,1 +1,1 @@",
				"-old",
				"+new",
			].join("\n"),
			1,
			1,
		);
		expect(file.status).toBe("renamed");
		expect(
			buildPosition(
				{ path: "old-name.ts", side: "old", startLine: 1, endLine: 1 },
				file,
				refs,
			),
		).toMatchObject({
			old_path: "old-name.ts",
			new_path: "new-name.ts",
			old_line: 1,
			new_line: null,
		});
		const newPosition = buildPosition(
			{ path: "new-name.ts", side: "new", startLine: 1, endLine: 1 },
			file,
			refs,
		);
		expect(newPosition.new_line).toBe(1);
		expect(newPosition.line_range).toBeUndefined();
	});

	test("rejects out-of-range and reversed selections", () => {
		expect(() =>
			buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 2, endLine: 4 },
				modified,
				refs,
			),
		).toThrow("line 4");
		expect(() =>
			buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 3, endLine: 2 },
				modified,
				refs,
			),
		).toThrow(PortError);
	});
});

describe("validatePosition", () => {
	test("rejects cross-side ranges and stale line codes before a write", () => {
		const valid = buildPosition(
			{ path: "src/app.ts", side: "new", startLine: 2, endLine: 3 },
			modified,
			refs,
		);
		const crossSide = {
			...valid,
			line_range: {
				start: {
					line_code: expectedHash("src/app.ts", 2, 2),
					type: "old" as const,
					old_line: 2,
					new_line: null,
				},
				end: {
					line_code: expectedHash("src/app.ts", 3, 3),
					type: "old" as const,
					old_line: 3,
					new_line: null,
				},
			},
		};
		expect(() => validatePosition(crossSide, modified)).toThrow(
			"span new and old",
		);

		const stale = structuredClone(valid) as GitLabPositionPayload;
		if (stale.line_range) {
			stale.line_range.start.line_code = "stale-line-code";
		}
		expect(() => validatePosition(stale, modified, refs)).toThrow(
			"parsed diff lines",
		);
	});

	test("rejects refs from a stale MR head", () => {
		const position = buildPosition(
			{ path: "src/app.ts", side: "new", startLine: 2, endLine: 2 },
			modified,
			refs,
		);
		expect(() =>
			validatePosition(position, modified, {
				...refs,
				headSha: "new-head-sha",
			}),
		).toThrow("current diff refs");
	});
});
