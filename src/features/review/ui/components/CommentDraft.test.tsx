import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommentDraft } from "./CommentDraft";

test("opens an empty comment draft in its editor", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={{
				id: "draft-1",
				body: "",
				selection: {
					path: "src/app.ts",
					side: "new",
					startLine: 5,
					endLine: 5,
				},
				filePath: "src/app.ts",
				status: "draft",
				error: null,
				postedDiscussionId: null,
				staleSince: null,
			}}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
		/>,
	);

	expect(markup).toContain('<textarea aria-label="Comment draft"');
	expect(markup).toContain('disabled=""');
});

test("starts non-empty drafts in Preview and renders Markdown", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={{
				body: "# Draft heading\n\n**Important**\n\n- item\n\n`inline`",
				selection: {
					path: "src/app.ts",
					side: "new",
					startLine: 5,
					endLine: 5,
				},
				filePath: "src/app.ts",
				status: "draft",
				error: null,
				postedDiscussionId: null,
				staleSince: null,
			}}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
		/>,
	);

	expect(markup).not.toContain("<textarea");
	expect(markup).toContain('<div class="comment-draft-preview">');
	expect(markup).toContain("<h1>Draft heading</h1>");
	expect(markup).toContain("<strong>Important</strong>");
	expect(markup).toContain("<li>item</li>");
	expect(markup).toContain("<code>inline</code>");
	expect(markup).toContain('aria-label="Draft editor mode"');
	expect(markup).toContain('aria-pressed="true">Preview</button>');
	expect(markup).toContain('aria-pressed="false">Write</button>');
});
