import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView } from "./DiffView";

test("renders distinct tag and comment actions for a diff line", () => {
	const markup = renderToStaticMarkup(
		<DiffView
			file={{
				oldPath: "src/app.ts",
				newPath: "src/app.ts",
				status: "modified",
				binary: false,
				insertions: 1,
				deletions: 0,
				hunks: [
					{
						header: "@@ -1 +1 @@",
						oldStart: 1,
						oldLines: 1,
						newStart: 1,
						newLines: 1,
						lines: [
							{
								kind: "context",
								oldLine: 1,
								newLine: 1,
								text: "export const value = 1;",
							},
						],
					},
				],
			}}
			mode="inline"
			largeFileLineThreshold={800}
			onModeChange={() => {}}
			fileContents={null}
			fileContentsError={null}
			onLineSelection={() => {}}
			onCommentSelection={() => {}}
		/>,
	);

	expect(markup).toContain("Tag line");
	expect(markup).toContain("Comment");
});

test("renders an always-visible find-in-file box in the diff header", () => {
	const markup = renderToStaticMarkup(
		<DiffView
			file={{
				oldPath: "src/app.ts",
				newPath: "src/app.ts",
				status: "modified",
				binary: false,
				insertions: 1,
				deletions: 0,
				hunks: [
					{
						header: "@@ -1 +1 @@",
						oldStart: 1,
						oldLines: 1,
						newStart: 1,
						newLines: 1,
						lines: [
							{ kind: "add", oldLine: null, newLine: 1, text: "findme here" },
						],
					},
				],
			}}
			mode="inline"
			largeFileLineThreshold={800}
			onModeChange={() => {}}
			fileContents={null}
			fileContentsError={null}
			onLineSelection={() => {}}
			onCommentSelection={() => {}}
		/>,
	);
	// The find box is always visible in the file header, idle count 0/0.
	expect(markup).toContain('class="find-input"');
	expect(markup).toContain('aria-label="Find in file"');
	expect(markup).toContain("0/0");
});
