import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView } from "./DiffView";

const file = {
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
} as const;

function renderDiff(
	props: Partial<Parameters<typeof DiffView>[0]> = {},
): string {
	return renderToStaticMarkup(
		<DiffView
			file={file}
			mode="inline"
			largeFileLineThreshold={800}
			onModeChange={() => {}}
			fileContents={null}
			fileContentsError={null}
			onLineSelection={() => {}}
			onCommentSelection={() => {}}
			{...props}
		/>,
	);
}

test("renders line actions without hunk actions", () => {
	const markup = renderDiff();

	expect(markup).toContain("Tag line");
	expect(markup).toContain("Comment");
	expect(markup).not.toContain("Tag hunk");
	expect(markup).not.toContain("Add a comment to the full hunk");
	expect(markup).toContain("Whole file");
	expect(markup).toContain("Diff only");
});

test("hides hunk summary in whole-file mode", () => {
	const markup = renderDiff({ wholeFile: true });

	expect(markup).not.toContain('class="hunk-header"');
	expect(markup).toContain("export const value = 1;");
});
