import { expect, test } from "bun:test";
import {
	renderMarkdownBlocks,
	renderMarkdownHtml,
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

test("sanitizes unsafe tags, attributes, and URLs from comment HTML", () => {
	const html = renderMarkdownHtml(
		[
			"# Safe",
			'<script>alert("x")</script>',
			'<span onclick="alert(1)" style="position:fixed">click</span>',
			'<iframe src="https://example.test"></iframe>',
			'<object data="movie.swf"></object>',
			'<embed src="movie.swf">',
			"<style>body{display:none}</style>",
			'[unsafe](javascript:alert("x"))',
		].join("\n\n"),
	);

	expect(html).toContain("<h1>Safe</h1>");
	expect(html).toContain(">click</span>");
	expect(html).not.toContain("<script");
	expect(html).not.toContain("onclick");
	expect(html).not.toContain('style="');
	expect(html).not.toContain("<iframe");
	expect(html).not.toContain("<object");
	expect(html).not.toContain("<embed");
	expect(html).not.toContain("<style");
	expect(html).not.toContain("javascript:");
	expect(html).not.toContain("alert(");
});
