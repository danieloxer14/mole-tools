import { describe, expect, test } from "bun:test";
import { ChatTagSchema, chatTagsEqual, isMarkdownChatTag } from "./chat-tags";

const diffTag = {
	path: "src/app.ts",
	side: "new" as const,
	startLine: 4,
	endLine: 6,
	hunk: "@@ -1,3 +1,4 @@",
};

const markdownTag = {
	kind: "markdown" as const,
	path: "README.md",
	startLine: 4,
	endLine: 6,
	quote: "## Heading\n\nBody.",
};

describe("ChatTagSchema", () => {
	test("accepts a diff-line tag and reports it as non-markdown", () => {
		const tag = ChatTagSchema.parse(diffTag);
		expect(isMarkdownChatTag(tag)).toBe(false);
	});

	test("accepts a markdown-block tag with an optional quote", () => {
		const tag = ChatTagSchema.parse(markdownTag);
		expect(isMarkdownChatTag(tag)).toBe(true);
	});

	test("accepts a markdown-block tag without a quote", () => {
		const { quote, ...withoutQuote } = markdownTag;
		const tag = ChatTagSchema.parse(withoutQuote);
		expect(isMarkdownChatTag(tag)).toBe(true);
	});

	test("rejects a markdown-block tag with a reversed line range", () => {
		expect(() =>
			ChatTagSchema.parse({ ...markdownTag, startLine: 6, endLine: 4 }),
		).toThrow();
	});

	test("rejects a diff-line tag missing its hunk", () => {
		const { hunk, ...withoutHunk } = diffTag;
		expect(() => ChatTagSchema.parse(withoutHunk)).toThrow();
	});
});

describe("chatTagsEqual", () => {
	test("matches identical diff tags and ignores markdown tags with the same range", () => {
		expect(chatTagsEqual(diffTag, { ...diffTag })).toBe(true);
		expect(
			chatTagsEqual(diffTag, {
				...markdownTag,
				startLine: diffTag.startLine,
				endLine: diffTag.endLine,
			}),
		).toBe(false);
	});

	test("matches identical markdown tags regardless of quote text", () => {
		expect(
			chatTagsEqual(markdownTag, { ...markdownTag, quote: "different" }),
		).toBe(true);
	});

	test("does not match diff tags on a different side or hunk", () => {
		expect(chatTagsEqual(diffTag, { ...diffTag, side: "old" })).toBe(false);
		expect(chatTagsEqual(diffTag, { ...diffTag, hunk: "@@ other @@" })).toBe(
			false,
		);
	});

	test("does not match tags with a different line range", () => {
		expect(chatTagsEqual(diffTag, { ...diffTag, endLine: 7 })).toBe(false);
	});
});
