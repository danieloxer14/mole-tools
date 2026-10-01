import { describe, expect, test } from "bun:test";
import {
	ChatTagSchema,
	chatTagsEqual,
	isDescriptionChatTag,
	isFileChatTag,
	isMarkdownChatTag,
	isOnePagerChatTag,
} from "./chat-tags";

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
const fileTag = { kind: "file" as const, path: "src/api.ts" };
const descriptionTag = {
	kind: "description" as const,
	quote: "The request description",
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

	test("accepts a path-only file tag and reports its kind", () => {
		const tag = ChatTagSchema.parse(fileTag);
		expect(isFileChatTag(tag)).toBe(true);
		expect(isMarkdownChatTag(tag)).toBe(false);
	});

	test("rejects a file tag with an empty path", () => {
		expect(() => ChatTagSchema.parse({ ...fileTag, path: "" })).toThrow();
	});

	test("rejects a file tag carrying extra fields", () => {
		expect(() => ChatTagSchema.parse({ ...fileTag, startLine: 1 })).toThrow();
	});

	test("rejects a diff-line tag carrying a file kind", () => {
		expect(() => ChatTagSchema.parse({ ...diffTag, kind: "file" })).toThrow();
	});

	test("accepts a whole description tag", () => {
		const tag = ChatTagSchema.parse(descriptionTag);
		expect(isDescriptionChatTag(tag)).toBe(true);
	});

	test("accepts a block description tag", () => {
		const tag = ChatTagSchema.parse({
			kind: "description",
			startLine: 3,
			endLine: 5,
			quote: "Body",
		});
		expect(isDescriptionChatTag(tag)).toBe(true);
	});

	test("rejects a description tag with startLine but no endLine", () => {
		expect(() =>
			ChatTagSchema.parse({
				kind: "description",
				startLine: 3,
				quote: "Body",
			}),
		).toThrow();
	});

	test("rejects a description tag with a reversed range", () => {
		expect(() =>
			ChatTagSchema.parse({
				kind: "description",
				startLine: 5,
				endLine: 3,
				quote: "Body",
			}),
		).toThrow();
	});

	test("rejects a description tag with an empty quote", () => {
		expect(() =>
			ChatTagSchema.parse({ ...descriptionTag, quote: "" }),
		).toThrow();
	});

	test("rejects a description tag with an extra path field", () => {
		expect(() =>
			ChatTagSchema.parse({ ...descriptionTag, path: "README.md" }),
		).toThrow();
	});

	test("accepts whole and ranged one-pager tags", () => {
		const wholeTag = ChatTagSchema.parse({
			kind: "one-pager",
			quote: "Summary",
		});
		const rangedTag = ChatTagSchema.parse({
			kind: "one-pager",
			startLine: 2,
			endLine: 4,
			quote: "Details",
		});
		expect(isOnePagerChatTag(wholeTag)).toBe(true);
		expect(isOnePagerChatTag(rangedTag)).toBe(true);
	});

	test("rejects incomplete or reversed one-pager ranges", () => {
		expect(() =>
			ChatTagSchema.parse({
				kind: "one-pager",
				startLine: 2,
				quote: "Details",
			}),
		).toThrow();
		expect(() =>
			ChatTagSchema.parse({
				kind: "one-pager",
				startLine: 4,
				endLine: 2,
				quote: "Details",
			}),
		).toThrow();
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

	test("matches identical file tags and rejects any other variant", () => {
		expect(chatTagsEqual(fileTag, { ...fileTag })).toBe(true);
		expect(chatTagsEqual(fileTag, { ...fileTag, path: "src/other.ts" })).toBe(
			false,
		);
		expect(chatTagsEqual(fileTag, { ...markdownTag, path: fileTag.path })).toBe(
			false,
		);
		expect(chatTagsEqual(fileTag, diffTag)).toBe(false);
	});

	test("does not match tags with a different line range", () => {
		expect(chatTagsEqual(diffTag, { ...diffTag, endLine: 7 })).toBe(false);
	});

	test("compares description tags by line range and separates variants", () => {
		const wholeTag = { ...descriptionTag };
		const blockTag = {
			kind: "description" as const,
			startLine: 3,
			endLine: 5,
			quote: "Body",
		};
		expect(chatTagsEqual(wholeTag, blockTag)).toBe(false);
		expect(
			chatTagsEqual(blockTag, { ...blockTag, quote: "Different quote" }),
		).toBe(true);
		expect(chatTagsEqual(wholeTag, fileTag)).toBe(false);
		expect(chatTagsEqual(blockTag, markdownTag)).toBe(false);
		expect(chatTagsEqual(blockTag, diffTag)).toBe(false);
	});

	test("compares one-pager tags by range, ignores quote, and separates descriptions", () => {
		const onePagerTag = {
			kind: "one-pager" as const,
			startLine: 3,
			endLine: 5,
			quote: "Summary",
		};
		expect(chatTagsEqual(onePagerTag, { ...onePagerTag })).toBe(true);
		expect(
			chatTagsEqual(onePagerTag, { ...onePagerTag, quote: "Changed summary" }),
		).toBe(true);
		expect(chatTagsEqual(onePagerTag, { ...onePagerTag, endLine: 6 })).toBe(
			false,
		);
		expect(
			chatTagsEqual(onePagerTag, {
				kind: "description",
				startLine: 3,
				endLine: 5,
				quote: "Summary",
			}),
		).toBe(false);
	});
});
