import { useMemo } from "react";
import { renderMarkdownHtml } from "../../../../shared/markdown";

/**
 * Renders a review comment body (draft, positioned discussion note, or
 * general discussion note) as sanitized GitHub-flavoured Markdown for the
 * small comment cards. Falls back to plain text when rendering fails.
 */
export function CommentMarkdown({ body }: { body: string }) {
	const parsed = useMemo(() => {
		try {
			return { error: null, html: renderMarkdownHtml(body) };
		} catch (reason: unknown) {
			return {
				error: reason instanceof Error ? reason.message : String(reason),
				html: null,
			};
		}
	}, [body]);

	if (parsed.error) {
		return (
			<p className="comment-markdown-plain min-w-0 max-w-full [overflow-wrap:anywhere]">
				{body}
			</p>
		);
	}
	return (
		<div
			className="comment-markdown min-w-0 w-full max-w-full [overflow-wrap:anywhere]"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown output is sanitized with DOMPurify.
			dangerouslySetInnerHTML={{ __html: parsed.html }}
		/>
	);
}
