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
