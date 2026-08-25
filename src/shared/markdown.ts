import DOMPurify from "dompurify";
import { marked, Renderer } from "marked";

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
		ADD_ATTR: ["data-mermaid-id"],
		FORBID_TAGS: ["embed", "iframe", "object", "script", "style"],
	});
}
