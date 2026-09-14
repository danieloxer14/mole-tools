import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { HostDiscussion } from "../../../../ports/git-host";
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
const multiHunkFile = {
	oldPath: "src/app.ts",
	newPath: "src/app.ts",
	status: "modified",
	binary: false,
	insertions: 2,
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
					kind: "add",
					oldLine: null,
					newLine: 1,
					text: "first change",
				},
			],
		},
		{
			header: "@@ -4 +4 @@",
			oldStart: 4,
			oldLines: 1,
			newStart: 4,
			newLines: 1,
			lines: [
				{
					kind: "add",
					oldLine: null,
					newLine: 4,
					text: "second change",
				},
				{
					kind: "context",
					oldLine: 3,
					newLine: null,
					text: "context without new line",
				},
			],
		},
	],
} as const;

const multiHunkSource = [
	"first change",
	"context one",
	"context two",
	"second change",
].join("\n");

const markdownFile = {
	oldPath: "README.md",
	newPath: "README.md",
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
					text: "# Review guide",
				},
			],
		},
	],
} as const;

const note = {
	id: "note-1",
	author: "reviewer",
	body: "Please consider this edge case.",
	createdAt: "2026-01-01T00:00:00.000Z",
	system: false,
};

function discussion(
	id: string,
	position: HostDiscussion["position"],
): HostDiscussion {
	return { id, resolved: false, position, notes: [note] };
}

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
	expect(markup).toContain('aria-label="Whole file"');
	expect(markup).toContain('aria-label="Diff only"');
});

test("hides hunk summary in whole-file mode", () => {
	const markup = renderDiff({ wholeFile: true });

	expect(markup).not.toContain('class="hunk-header"');
	expect(markup).toContain("export const value = 1;");
});

const positionedDiscussion = {
	id: "disc-1",
	resolved: false,
	position: {
		newPath: "src/app.ts",
		oldPath: "src/app.ts",
		newLine: 1,
		oldLine: 1,
	},
	notes: [
		{
			id: "note-1",
			author: "reviewer",
			body: "Please rename this.",
			createdAt: "2026-01-01T00:00:00.000Z",
			system: false,
		},
	],
};

test("renders an Explain button on inline discussions when a handler is supplied", () => {
	const markup = renderDiff({
		discussions: [positionedDiscussion],
		onExplainDiscussion: () => {},
	});

	const card = markup.match(
		/<article[^>]*data-discussion-id="disc-1"[^>]*>[\s\S]*?<\/article>/,
	)?.[0];
	expect(card).toBeDefined();
	expect(card).toContain('data-action="explain"');
	expect(card).toContain(">Explain</button>");
	expect(card).not.toContain("disabled");
});

test("disables the inline Explain button when explainDisabled is set", () => {
	const markup = renderDiff({
		discussions: [positionedDiscussion],
		onExplainDiscussion: () => {},
		explainDisabled: true,
	});

	const button = markup.match(/<button[^>]*data-action="explain"[^>]*>/)?.[0];
	expect(button).toBeDefined();
	expect(button).toMatch(/\sdisabled(?:=""|[\s>])/);
});

test("omits Explain when no handler is supplied", () => {
	const markup = renderDiff({ discussions: [positionedDiscussion] });

	expect(markup).toContain('data-discussion-id="disc-1"');
	expect(markup).not.toContain('data-action="explain"');
});

test("marks diff hunk rows with drag identity attributes", () => {
	const markup = renderDiff({ file: multiHunkFile });

	expect(markup).toContain('data-drag-hunk="0"');
	expect(markup).toContain('data-drag-hunk="1"');
	expect(markup).toContain(
		'data-drag-hunk="0" data-drag-side="new" data-drag-line="1"',
	);
	expect(markup).toContain(
		'data-drag-hunk="1" data-drag-side="new" data-drag-line="4"',
	);
	const unaddressableRow = markup.match(
		/<tr[^>]*data-find-line="h:@@ -4 \+4 @@:3:-"[^>]*>/,
	)?.[0];
	expect(unaddressableRow).toBeDefined();
	expect(unaddressableRow).not.toContain("data-drag-hunk");
	expect(unaddressableRow).not.toContain("data-drag-side");
	expect(unaddressableRow).not.toContain("data-drag-line");
});

test("keeps revealed inter-hunk context rows out of drag identity", () => {
	const markup = renderDiff({
		file: multiHunkFile,
		fileContents: multiHunkSource,
		wholeFile: true,
	});
	const contextRow = markup.match(
		/<tr[^>]*data-find-line="c:new:2"[^>]*>/,
	)?.[0];

	expect(contextRow).toBeDefined();
	expect(contextRow).not.toContain("data-drag-hunk");
});

test("renders the find box without results or navigation until a search is made", () => {
	const markup = renderDiff();

	const controlsIndex = markup.indexOf('class="diff-controls"');
	const statsIndex = markup.indexOf('class="diff-stats"');
	const findBarIndex = markup.indexOf('class="find-bar"');
	expect(markup).toContain('class="diff-header"');
	expect(statsIndex).toBeGreaterThanOrEqual(0);
	expect(statsIndex).toBeLessThan(findBarIndex);
	expect(markup).toContain("+1");
	expect(markup).not.toContain(" additions,");
	expect(markup).not.toContain(" deletions");
	expect(controlsIndex).toBeGreaterThanOrEqual(0);
	expect(findBarIndex).toBeGreaterThan(controlsIndex);
	expect(markup).toContain('class="find-input-wrap"');
	expect(markup).toContain('aria-label="Find in file"');
	// The result counter and previous/next arrows appear only after a search.
	expect(markup).not.toContain('class="find-count"');
	expect(markup).not.toContain('class="find-nav-group"');
	// The layout and file-scope controls are icon buttons with tooltips.
	expect(markup).toContain('aria-label="Inline" title="Inline"');
	expect(markup).toContain('aria-label="Side by side" title="Side by side"');
	expect(markup).toContain('aria-label="Whole file" title="Whole file"');
	expect(markup).toContain('aria-label="Diff only" title="Diff only"');
});

test("shows the find result count and navigation once a search is made", () => {
	const markup = renderDiff({ findQuery: "value" });

	expect(markup).toContain('class="find-count"');
	expect(markup).toContain("1/1");
	expect(markup).toContain('class="find-nav-group"');
	expect(markup.match(/class="find-nav"/g)).toHaveLength(2);
	const prevButton = markup.match(
		/<button[^>]*aria-label="Previous match"[^>]*>/,
	)?.[0];
	const nextButton = markup.match(
		/<button[^>]*aria-label="Next match"[^>]*>/,
	)?.[0];
	expect(prevButton).toBeDefined();
	expect(prevButton).not.toMatch(/\sdisabled(?:=""|[\s>])/);
	expect(nextButton).toBeDefined();
	expect(nextButton).not.toMatch(/\sdisabled(?:=""|[\s>])/);
});

test("shows a 0/0 count with disabled arrows when the search matches nothing", () => {
	const markup = renderDiff({ findQuery: "no-such-token" });

	expect(markup).toContain('class="find-count"');
	expect(markup).toContain("0/0");
	const prevButton = markup.match(
		/<button[^>]*aria-label="Previous match"[^>]*>/,
	)?.[0];
	const nextButton = markup.match(
		/<button[^>]*aria-label="Next match"[^>]*>/,
	)?.[0];
	expect(prevButton).toBeDefined();
	expect(prevButton).toMatch(/\sdisabled(?:=""|[\s>])/);
	expect(nextButton).toBeDefined();
	expect(nextButton).toMatch(/\sdisabled(?:=""|[\s>])/);
});

test("offers the markdown rendered/diff view as icon segments with tooltips", () => {
	const markup = renderDiff({ file: markdownFile });

	expect(markup).toContain('aria-label="Rendered" title="Rendered"');
	expect(markup).toContain('aria-label="Diff" title="Diff"');
	// The diff view is the default; the rendered segment is inactive.
	expect(markup).toContain(
		'class="seg active" aria-pressed="true" aria-label="Diff"',
	);
	expect(markup).toContain(
		'class="seg" aria-pressed="false" aria-label="Rendered"',
	);
	// The find box remains available for a markdown diff.
	expect(markup).toContain('class="find-bar"');
});

test("offers a Viewed checkbox in the diff header that defaults to unchecked", () => {
	const markup = renderDiff();

	expect(markup).toContain('title="Mark file viewed"');
	expect(markup).toContain("Viewed");
	const input = markup.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
	expect(input).toBeDefined();
	expect(input).not.toMatch(/\bchecked/);
});

test("marks the header Viewed checkbox when the file is viewed", () => {
	const markup = renderDiff({ viewed: true });

	const input = markup.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
	expect(input).toBeDefined();
	expect(input).toMatch(/\bchecked/);
});

test("keeps the Viewed checkbox when markdown renders instead of the diff", () => {
	const markup = renderDiff({ file: markdownFile, viewMode: "rendered" });

	expect(markup).toContain('title="Mark file viewed"');
});

test("hides the header controls when no file is selected", () => {
	const markup = renderDiff({ file: null });

	expect(markup).toContain("Select changed file");
	expect(markup).not.toContain("Mark file viewed");
});

test("offers a collapse-all control for positioned discussions", () => {
	const markup = renderDiff({
		discussions: [
			discussion("discussion-1", {
				newPath: "src/app.ts",
				oldPath: "src/app.ts",
				newLine: 1,
				oldLine: null,
			}),
		],
	});

	expect(markup).toContain("Collapse all comments");
	expect(markup).toContain('aria-pressed="false"');
	expect(markup).toContain("Please consider this edge case.");
});

test("renders a per-discussion collapse chevron in the expanded state", () => {
	const markup = renderDiff({
		discussions: [
			discussion("discussion-1", {
				newPath: "src/app.ts",
				oldPath: "src/app.ts",
				newLine: 1,
				oldLine: null,
			}),
		],
	});

	expect(markup).toContain('aria-controls="discussion-body-discussion-1"');
	expect(markup).toContain('aria-expanded="true"');
	expect(markup).not.toContain("inline-discussion-preview");
});

test("collapses a seeded discussion to a single-line preview", () => {
	const markup = renderDiff({
		commentsCollapsed: true,
		discussions: [
			discussion("discussion-1", {
				newPath: "src/app.ts",
				oldPath: "src/app.ts",
				newLine: 1,
				oldLine: null,
			}),
		],
	});

	expect(markup).toContain("Expand all comments");
	expect(markup).toContain('aria-pressed="true"');
	expect(markup).toContain('aria-expanded="false"');
	expect(markup).toContain("discussion-details is-collapsed");
	expect(markup).toContain("inline-discussion-preview");
	expect(markup).toContain("Please consider this edge case.");
	expect(markup).toContain("export const value = 1;");
});

test("counts every positioned discussion rendered in the diff", () => {
	const markup = renderDiff({
		file: multiHunkFile,
		discussions: [
			discussion("discussion-1", {
				newPath: "src/app.ts",
				oldPath: "src/app.ts",
				newLine: 1,
				oldLine: null,
			}),
			discussion("discussion-2", {
				newPath: "src/app.ts",
				oldPath: "src/app.ts",
				newLine: 4,
				oldLine: null,
			}),
		],
	});

	expect(markup).toContain("Collapse all comments");
});

test("does not offer a collapse control for general discussions", () => {
	const markup = renderDiff({
		discussions: [discussion("discussion-1", null)],
	});

	expect(markup).not.toContain("Collapse all comments");
	expect(markup).not.toContain("Expand all comments");
});

test("does not count file-level discussions that render no diff row", () => {
	const markup = renderDiff({
		discussions: [
			discussion("discussion-1", {
				newPath: "src/app.ts",
				oldPath: "src/app.ts",
				newLine: null,
				oldLine: null,
			}),
		],
	});

	expect(markup).not.toContain("Collapse all comments");
});

test("hides the collapse control while the large-diff placeholder replaces the table", () => {
	const markup = renderDiff({
		file: multiHunkFile,
		largeFileLineThreshold: 2,
		discussions: [
			discussion("discussion-1", {
				newPath: "src/app.ts",
				oldPath: "src/app.ts",
				newLine: 1,
				oldLine: null,
			}),
		],
	});

	expect(markup).toContain("Large diff collapsed");
	expect(markup).not.toContain("first change");
	expect(markup).not.toContain("Collapse all comments");
	expect(markup).not.toContain("Expand all comments");
});
