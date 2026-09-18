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

	expect(markup).toContain("<textarea");
	expect(markup).toContain('aria-label="Comment draft"');
	expect(markup).toContain('data-status="draft"');
	expect(markup).toContain('disabled=""');
});

test("starts non-empty drafts in Preview and renders Markdown", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={{
				id: "draft-preview",
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
	expect(markup).toContain("<h1>Draft heading</h1>");
	expect(markup).toContain("<strong>Important</strong>");
	expect(markup).toContain("<li>item</li>");
	expect(markup).toContain("<code>inline</code>");
	expect(markup).toContain('aria-label="Draft editor mode"');
	expect(markup).toContain('data-state="on"');
	expect(markup).toContain('data-state="off"');
});

test("marks failed drafts and keeps retry and editor mode controls", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={{
				id: "draft-failed",
				body: "Needs another try",
				selection: {
					path: "src/app.ts",
					side: "new",
					startLine: 5,
					endLine: 5,
				},
				filePath: "src/app.ts",
				status: "failed",
				error: "Posting failed",
				postedDiscussionId: null,
				staleSince: null,
			}}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
		/>,
	);

	expect(markup).toContain('data-status="failed"');
	expect(markup).toContain('role="alert"');
	expect(markup).toContain("Posting failed");
	expect(markup).toContain("Retry");
	expect(markup).toContain('data-state="on"');
	expect(markup).toContain('data-state="off"');
});
test("bounds long draft paths and Markdown regions without removing draft actions", () => {
	const longPath =
		"packages/review/features/comments/components/very-long-draft-file-name.ts";
	const body = [
		`Please inspect ${longPath} and https://example.test/${"draft-segment".repeat(16)}.`,
		"",
		"```text",
		"long fenced draft content",
		"```",
		"",
		"| file | detail |",
		"| --- | --- |",
		`| ${longPath} | table content |`,
	].join("\n");
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={{
				id: "draft-long",
				body,
				selection: {
					path: longPath,
					side: "new",
					startLine: 5,
					endLine: 5,
				},
				filePath: longPath,
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
	const container = document.createElement("div");
	container.innerHTML = markup;
	const article = container.querySelector<HTMLElement>(
		'[data-draft-id="draft-long"]',
	);
	const markdown = article?.querySelector<HTMLElement>(".comment-markdown");
	const tableWrap = markdown?.querySelector<HTMLElement>(
		".rendered-table-wrap",
	);

	expect(article?.className).toContain("min-w-0");
	expect(article?.className).toContain("max-w-full");
	expect(article?.className).toContain("overflow-hidden");
	expect(markdown?.className).toContain("min-w-0");
	expect(markdown?.className).toContain("[overflow-wrap:anywhere]");
	expect(markdown?.querySelector("pre")).not.toBeNull();
	expect(tableWrap?.className).toContain("max-w-full");
	expect(container.textContent).toContain(longPath);
	expect(container.textContent).toContain("Send");
});
