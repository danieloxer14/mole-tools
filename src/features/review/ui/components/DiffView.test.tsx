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
	// The find box stays inline with view controls, with navigation inside the
	// input and a gap before the Inline button.
	const controlsIndex = markup.indexOf('class="diff-controls"');
	const statsIndex = markup.indexOf('class="diff-stats"');
	const findBarIndex = markup.indexOf('class="find-bar"');
	const findCountIndex = markup.indexOf('class="find-count"');
	const inlineButtonIndex = markup.indexOf(">Inline<");
	expect(markup).toContain('class="diff-header"');
	expect(statsIndex).toBeGreaterThanOrEqual(0);
	expect(statsIndex).toBeLessThan(findBarIndex);
	expect(markup).toContain("+1");
	expect(markup).not.toContain(" additions,");
	expect(markup).not.toContain(" deletions");
	expect(controlsIndex).toBeGreaterThanOrEqual(0);
	expect(findBarIndex).toBeGreaterThan(controlsIndex);
	expect(markup).toContain('class="find-input-wrap"');
	expect(markup).toContain('class="find-nav-group"');
	expect(inlineButtonIndex).toBeGreaterThan(findCountIndex);
	expect(markup).toContain('aria-label="Find in file"');
	expect(markup).toContain('class="find-nav" aria-label="Previous match"');
	expect(markup.match(/class="find-nav"/g)).toHaveLength(2);
	expect(markup).toContain('title="Previous match (Shift+Enter)"');
	expect(markup).toContain('title="Next match (Enter)"');
	expect(markup).toContain("0/0");
});
