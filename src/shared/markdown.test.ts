import { expect, test } from "bun:test";
import {
	renderMarkdownBlocks,
	wrapMarkdownBlocksWithActions,
} from "./markdown";

test("wraps a commentable block with Tag and Comment buttons and its source range", () => {
	const blocks = renderMarkdownBlocks("# Title\n");
	const { html, blockRanges } = wrapMarkdownBlocksWithActions(blocks);

	expect(html).toContain('class="markdown-block"');
	expect(html).toContain('data-source-line-start="1"');
	expect(html).toContain('data-source-line-end="1"');
	expect(html).toContain('class="markdown-block-tag"');
	expect(html).toContain('class="markdown-block-comment"');
	expect(html).toContain(">Tag<");
	expect(html).toContain(">Comment<");
	expect(html).toContain("<h1>Title</h1>");
	expect(blockRanges.size).toBe(1);
	const [id, range] = [...blockRanges.entries()][0] ?? [];
	expect(range).toEqual({ startLine: 1, endLine: 1 });
	expect(html).toContain(`data-block-id="${id}"`);
});

test("wraps a non-commentable block without Tag/Comment affordances", () => {
	const { html, blockRanges } = wrapMarkdownBlocksWithActions([
		{
			id: "mole-markdown-block-0",
			startLine: null,
			endLine: null,
			html: "<p>x</p>",
		},
	]);

	expect(html).toBe('<div class="markdown-block"><p>x</p></div>');
	expect(html).not.toContain("markdown-block-tag");
	expect(html).not.toContain("markdown-block-comment");
	expect(blockRanges.size).toBe(0);
});

test("assembles every block in document order with a distinct block id each", () => {
	const blocks = renderMarkdownBlocks("# Title\n\nBody text.\n");
	const { html, blockRanges } = wrapMarkdownBlocksWithActions(blocks);

	expect(html.indexOf("<h1>")).toBeLessThan(html.indexOf("<p>"));
	expect(blockRanges.size).toBe(2);
	expect(new Set(blockRanges.keys()).size).toBe(2);
});
