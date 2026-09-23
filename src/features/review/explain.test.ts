import { describe, expect, test } from "bun:test";
import type { HostDiscussion, HostNote } from "../../ports/git-host";
import type { DiffLine, ParsedFileDiff } from "../../shared/diff-parse";
import {
	buildExplainMessage,
	discussionDiffExcerpt,
	draftDiffExcerpt,
	explainChatTitle,
	NO_EXCERPT,
} from "./explain";

/** Lines of the fixture hunk that are a del/add pair instead of context. */
const REPLACED_LINES: readonly number[] = [3, 15, 22];

function note(overrides: Partial<HostNote> = {}): HostNote {
	return {
		id: "note-1",
		author: "alice",
		body: "Please rename this helper",
		createdAt: "2026-08-15T10:00:00.000Z",
		system: false,
		...overrides,
	};
}

function discussion(overrides: Partial<HostDiscussion> = {}): HostDiscussion {
	return {
		id: "discussion-1",
		resolved: false,
		notes: [note()],
		position: {
			newPath: "src/a.ts",
			oldPath: "src/a.ts",
			newLine: 15,
			oldLine: null,
		},
		...overrides,
	};
}

/** One hunk covering old lines 1-30 and new lines 1-30; REPLACED_LINES are del+add pairs. */
function fileDiff(
	overrides: Partial<ParsedFileDiff> = {},
	label = "line",
): ParsedFileDiff {
	const lines: DiffLine[] = [];
	for (let i = 1; i <= 30; i += 1) {
		if (REPLACED_LINES.includes(i)) {
			lines.push({
				kind: "del",
				oldLine: i,
				newLine: null,
				text: `${label} old ${i}`,
			});
			lines.push({
				kind: "add",
				oldLine: null,
				newLine: i,
				text: `${label} new ${i}`,
			});
		} else {
			lines.push({
				kind: "context",
				oldLine: i,
				newLine: i,
				text: `${label} ${i}`,
			});
		}
	}
	return {
		oldPath: "src/a.ts",
		newPath: "src/a.ts",
		status: "modified",
		binary: false,
		insertions: REPLACED_LINES.length,
		deletions: REPLACED_LINES.length,
		hunks: [
			{
				header: "@@ -1,30 +1,30 @@",
				oldStart: 1,
				oldLines: 30,
				newStart: 1,
				newLines: 30,
				lines,
			},
		],
		...overrides,
	};
}

function rowsOf(excerpt: string | null): string[] {
	expect(excerpt).not.toBeNull();
	return (excerpt ?? "").split("\n");
}

describe("explainChatTitle", () => {
	test("titles after the first non-system note with text, bounded like chat titles", () => {
		const long =
			"This helper duplicates the retry logic that already lives in the http client module";
		const title = explainChatTitle(
			discussion({
				notes: [
					note({
						id: "sys",
						author: "gitlab",
						body: "changed this line",
						system: true,
					}),
					note({ id: "blank", body: "   \n " }),
					note({ id: "long", body: long }),
					note({ id: "later", body: "Second opinion" }),
				],
			}),
		);
		expect(title).toBe(
			"Explain: This helper duplicates the retry logic that alre…",
		);
		expect(title.length).toBe("Explain: ".length + 48 + 1);
		expect(
			explainChatTitle(
				discussion({ notes: [note({ body: "Please rename\n  this helper" })] }),
			),
		).toBe("Explain: Please rename this helper");
	});

	test("falls back to the anchored path and line when only system notes exist", () => {
		const systemOnly = [
			note({
				author: "gitlab",
				body: "changed this line in version 2",
				system: true,
			}),
		];
		expect(
			explainChatTitle(
				discussion({
					notes: systemOnly,
					position: {
						newPath: "src/a.ts",
						oldPath: "src/a.ts",
						newLine: 12,
						oldLine: null,
					},
				}),
			),
		).toBe("Explain: src/a.ts:12");
		expect(
			explainChatTitle(
				discussion({
					notes: systemOnly,
					position: {
						newPath: null,
						oldPath: "src/old.ts",
						newLine: null,
						oldLine: 7,
					},
				}),
			),
		).toBe("Explain: src/old.ts:7");
	});

	test("uses a generic title for unpositioned discussions without a usable body", () => {
		expect(explainChatTitle(discussion({ notes: [], position: null }))).toBe(
			"Explain comment",
		);
		expect(
			explainChatTitle(
				discussion({
					notes: [note({ body: "resolved this thread", system: true })],
					position: null,
				}),
			),
		).toBe("Explain comment");
	});
});

describe("discussionDiffExcerpt", () => {
	test("keeps new-side lines within the radius and marks the anchor row", () => {
		const excerpt = discussionDiffExcerpt(discussion(), [[fileDiff()]]);
		const rows = rowsOf(excerpt);
		expect(rows).toHaveLength(21);
		expect(rows[0]).toBe("  5\t5\t line 5");
		expect(rows[10]).toBe("> \t15\t+line new 15");
		expect(rows[20]).toBe("  25\t25\t line 25");
		expect(rows).toContain("  \t22\t+line new 22");
		expect(rows.filter((row) => row.startsWith("> "))).toHaveLength(1);
		const newNumbers = rows.map((row) => Number(row.split("\t")[1]));
		expect(Math.min(...newNumbers)).toBe(5);
		expect(Math.max(...newNumbers)).toBe(25);
		// Deleted lines carry no new line number, so a new-side excerpt omits them.
		expect(excerpt).not.toContain("line old 15");
		expect(excerpt).not.toContain("\t-");
	});

	test("honours a custom radius", () => {
		const rows = rowsOf(discussionDiffExcerpt(discussion(), [[fileDiff()]], 2));
		expect(rows).toEqual([
			"  13\t13\t line 13",
			"  14\t14\t line 14",
			"> \t15\t+line new 15",
			"  16\t16\t line 16",
			"  17\t17\t line 17",
		]);
	});

	test("anchors old-side positions on oldPath and old line numbers", () => {
		const renamed = fileDiff({ oldPath: "src/old.ts", newPath: "src/a.ts" });
		const oldSide = discussion({
			position: {
				newPath: null,
				oldPath: "src/old.ts",
				newLine: null,
				oldLine: 7,
			},
		});
		const excerpt = discussionDiffExcerpt(oldSide, [[renamed]]);
		const rows = rowsOf(excerpt);
		expect(rows).toHaveLength(17);
		expect(rows[0]).toBe("  1\t1\t line 1");
		expect(rows[2]).toBe("  3\t\t-line old 3");
		expect(rows[6]).toBe("> 7\t7\t line 7");
		expect(rows[14]).toBe("  15\t\t-line old 15");
		expect(rows[16]).toBe("  17\t17\t line 17");
		// Added lines carry no old line number, so an old-side excerpt omits them.
		expect(excerpt).not.toContain("line new 3");
		expect(
			discussionDiffExcerpt(oldSide, [
				[fileDiff({ oldPath: "src/other.ts", newPath: "src/a.ts" })],
			]),
		).toBeNull();
	});

	test("prefers the first diff set and falls back through later ones", () => {
		const expanded = fileDiff({}, "expanded");
		const compact = fileDiff({}, "compact");
		const other = fileDiff({
			oldPath: "src/other.ts",
			newPath: "src/other.ts",
		});
		const both = discussionDiffExcerpt(discussion(), [[expanded], [compact]]);
		expect(both).toContain("expanded new 15");
		expect(both).not.toContain("compact");
		expect(discussionDiffExcerpt(discussion(), [[other], [compact]])).toContain(
			"compact new 15",
		);
		// A matching file without any line in range yields to the next set.
		expect(
			discussionDiffExcerpt(discussion(), [
				[fileDiff({ hunks: [] }, "expanded")],
				[compact],
			]),
		).toContain("compact new 15");
		expect(discussionDiffExcerpt(discussion(), [[other], []])).toBeNull();
		expect(discussionDiffExcerpt(discussion(), [])).toBeNull();
		expect(
			discussionDiffExcerpt(discussion({ position: null }), [
				[expanded],
				[compact],
			]),
		).toBeNull();
	});
});

describe("draftDiffExcerpt", () => {
	test("marks the selected range with context", () => {
		const excerpt = draftDiffExcerpt(
			{
				path: "src/a.ts",
				side: "new",
				startLine: 15,
				endLine: 16,
			},
			[[fileDiff()]],
			1,
		);
		expect(excerpt).not.toBeNull();
		expect(excerpt?.includes("> ")).toBe(true);
		expect(excerpt?.includes("line new 15")).toBe(true);
		expect(excerpt?.includes("line 16")).toBe(true);
		expect(excerpt?.includes("line 14")).toBe(true);
	});

	test("returns null for an unknown path", () => {
		expect(
			draftDiffExcerpt(
				{
					path: "src/missing.ts",
					side: "new",
					startLine: 1,
					endLine: 1,
				},
				[[fileDiff()]],
			),
		).toBeNull();
	});
});
describe("buildExplainMessage", () => {
	test("joins the trimmed prefix, comment block, and diff excerpt block", () => {
		const message = buildExplainMessage({
			prefix: "  Explain prefix.\n",
			discussion: discussion({
				resolved: true,
				notes: [
					note({ id: "n1" }),
					note({
						id: "n2",
						author: "gitlab",
						body: "changed this line in version 2 of the diff",
						system: true,
					}),
					note({
						id: "n3",
						author: "bob",
						body: "Agreed, `fetchRetry` reads better.\n\nAlso drop the default.",
						createdAt: "2026-08-15T11:00:00.000Z",
					}),
				],
			}),
			diffs: [[fileDiff()]],
		});
		expect(
			message.startsWith(
				"Explain prefix.\n\n## Comment\nResolved discussion at src/a.ts:new:15\n\n",
			),
		).toBe(true);
		expect(message).toContain(
			"alice (2026-08-15T10:00:00.000Z):\nPlease rename this helper\n\n" +
				"bob (2026-08-15T11:00:00.000Z):\nAgreed, `fetchRetry` reads better.\n\nAlso drop the default.\n\n" +
				"## Diff excerpt\n  5\t5\t line 5\n",
		);
		expect(message).not.toContain("changed this line");
		expect(message).toContain("\n> \t15\t+line new 15\n");
		expect(message.endsWith("  25\t25\t line 25")).toBe(true);
	});

	test("describes unpositioned discussions and ends with the no-excerpt line", () => {
		const message = buildExplainMessage({
			prefix: "Explain prefix.",
			discussion: discussion({
				position: null,
				notes: [
					note({ id: "n1" }),
					note({
						id: "n2",
						author: "gitlab",
						body: "resolved this thread",
						system: true,
					}),
				],
			}),
			diffs: [[fileDiff()]],
		});
		expect(message).toBe(
			"Explain prefix.\n\n## Comment\nUnresolved general MR discussion (no diff position)\n\n" +
				`alice (2026-08-15T10:00:00.000Z):\nPlease rename this helper\n\n## Diff excerpt\n${NO_EXCERPT}`,
		);
	});

	test("substitutes a placeholder paragraph when no non-system note exists", () => {
		const message = buildExplainMessage({
			prefix: "Explain prefix.",
			discussion: discussion({
				position: null,
				notes: [note({ body: "resolved this thread", system: true })],
			}),
			diffs: [],
		});
		expect(message).toBe(
			"Explain prefix.\n\n## Comment\nUnresolved general MR discussion (no diff position)\n\n" +
				`(no comment text)\n\n## Diff excerpt\n${NO_EXCERPT}`,
		);
	});
});
