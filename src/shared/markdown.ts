import DOMPurify from "dompurify";
import { marked, Renderer } from "marked";
import { mapBlockSourceLines } from "./markdown-blocks";

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/**
 * Parses `source` as GitHub-flavoured markdown and returns sanitized HTML.
 * Pass `configureRenderer` to override individual renderer methods (e.g. to
 * intercept fenced code blocks for a diagram engine).
 */
export function renderMarkdownHtml(
	source: string,
	configureRenderer?: (renderer: Renderer) => void,
): string {
	const renderer = new Renderer();
	configureRenderer?.(renderer);
	const html = marked.parse(source, {
		async: false,
		gfm: true,
		renderer,
	}) as string;
	return DOMPurify.sanitize(html, {
		ADD_ATTR: ["data-mermaid-id", "data-code-block-id"],
		FORBID_TAGS: ["embed", "iframe", "object", "script", "style"],
	});
}

export interface MarkdownBlockSpan {
	/** Stable per-render id; used to correlate DOM elements back to a span. */
	id: string;
	/** Null when the block's source range could not be recovered (non-commentable). */
	startLine: number | null;
	endLine: number | null;
	/** Rendered (but not yet sanitized) HTML for this block only. */
	html: string;
}

/**
 * Renders `source` as GitHub-flavoured markdown one top-level block at a
 * time, pairing each block's HTML with its 1-based source line range. Unlike
 * `renderMarkdownHtml`, the returned HTML is NOT sanitized — callers that
 * assemble additional markup around each block (e.g. comment affordances)
 * must sanitize the final assembled document themselves.
 */
export function renderMarkdownBlocks(
	source: string,
	configureRenderer?: (renderer: Renderer) => void,
): MarkdownBlockSpan[] {
	const renderer = new Renderer();
	configureRenderer?.(renderer);
	const tokens = marked
		.lexer(source, { gfm: true })
		.filter((token) => token.type !== "space");
	const ranges = mapBlockSourceLines(
		source,
		tokens.map((token) => token.raw),
	);
	return tokens.map((token, index) => {
		const range = ranges[index] ?? null;
		const html = marked.parser([token], {
			async: false,
			gfm: true,
			renderer,
		}) as string;
		return {
			id: `mole-markdown-block-${index}`,
			startLine: range?.startLine ?? null,
			endLine: range?.endLine ?? null,
			html,
		};
	});
}

export interface WrappedMarkdownBlocks {
	/** Assembled, unsanitized HTML for every block, ready to sanitize once. */
	html: string;
	/** Source line range for every block that got Tag/Comment affordances. */
	blockRanges: Map<string, { startLine: number; endLine: number }>;
}

/**
 * Wraps each rendered block in a `.markdown-block` container carrying its
 * source line range as data attributes, plus a Tag/Comment action pair for
 * blocks whose range was recovered. Pure string assembly (no DOM), so it is
 * unit-testable under `bun:test` without the DOMPurify/DOM dependency that
 * `renderMarkdownHtml`/`renderMarkdownBlocks`' sanitizing callers need.
 * Callers must sanitize the returned `html` before rendering it.
 */
export function wrapMarkdownBlocksWithActions(
	blocks: readonly MarkdownBlockSpan[],
): WrappedMarkdownBlocks {
	const blockRanges = new Map<string, { startLine: number; endLine: number }>();
	const html = blocks
		.map((block) => {
			if (block.startLine === null || block.endLine === null) {
				return `<div class="markdown-block">${block.html}</div>`;
			}
			blockRanges.set(block.id, {
				startLine: block.startLine,
				endLine: block.endLine,
			});
			return `<div class="markdown-block" data-block-id="${block.id}" data-source-line-start="${block.startLine}" data-source-line-end="${block.endLine}"><span class="markdown-block-actions"><button type="button" class="markdown-block-tag" data-block-id="${block.id}">Tag</button><button type="button" class="markdown-block-comment" data-block-id="${block.id}">Comment</button></span>${block.html}</div>`;
		})
		.join("");
	return { html, blockRanges };
}
