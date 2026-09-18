import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { HostDiscussion } from "../../../../ports/git-host";
import { DiffView } from "./DiffView";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

function mountDiff(props: Partial<Parameters<typeof DiffView>[0]> = {}): {
	container: HTMLDivElement;
	root: Root;
} {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => {
		root.render(
			<DiffView
				file={multiHunkFile}
				mode="inline"
				largeFileLineThreshold={800}
				fileContents={null}
				fileContentsError={null}
				onModeChange={() => {}}
				onLineSelection={() => {}}
				onCommentSelection={() => {}}
				{...props}
			/>,
		);
	});
	return { container, root };
}

function setInputValue(input: HTMLInputElement, value: string): void {
	Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set?.call(input, value);
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test("renders line actions without hunk actions", () => {
	const markup = renderDiff();

	expect(markup).toContain("Tag line");
	expect(markup).toContain("Comment");
	expect(markup).not.toContain("Tag hunk");
	expect(markup).not.toContain("Add a comment to the full hunk");
	expect(markup).toContain('aria-label="Full file"');
	expect(markup).toContain('aria-label="Diff only"');
});

const renamedFile = {
	oldPath: "src/old.ts",
	newPath: "src/new.ts",
	status: "renamed",
	binary: false,
	insertions: 1,
	deletions: 1,
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
					text: "renamed body",
				},
			],
		},
	],
} as const;

test("hides Tag whole file when no file tag handler is supplied", () => {
	const markup = renderDiff();

	expect(markup).not.toContain("Tag whole file");
});

test("tags the whole selected file from the diff header as its new path", () => {
	const markup = renderDiff({
		file: renamedFile,
		onFileTag: () => {},
	});

	expect(markup).toContain('aria-label="Tag whole file"');
	expect(markup).not.toContain(
		'title="Add this whole file to the active chat context"',
	);
	expect(markup).not.toMatch(/>Tag whole file<\/button>/);
	// The button tags the same resolved path (newPath ?? oldPath) shown in
	// the header, so a renamed file is tagged by its new path.
	expect(markup).toMatch(/<h2[^>]*>src\/new\.ts<\/h2>/);
});

test("tags a deleted file by its old path", () => {
	const markup = renderDiff({
		file: {
			...renamedFile,
			oldPath: "src/gone.ts",
			newPath: null,
			status: "deleted",
		},
		onFileTag: () => {},
	});

	expect(markup).toContain('aria-label="Tag whole file"');
	expect(markup).toMatch(/<h2[^>]*>src\/gone\.ts<\/h2>/);
});

test("offers Tag whole file for a collapsed stat-only file", () => {
	const markup = renderDiff({
		file: {
			oldPath: "src/stats.ts",
			newPath: "src/stats.ts",
			status: "modified",
			binary: false,
			insertions: 4,
			deletions: 2,
			hunks: [],
		},
		onFileTag: () => {},
	});

	expect(markup).toContain('aria-label="Tag whole file"');
	expect(markup).toMatch(/<h2[^>]*>src\/stats\.ts<\/h2>/);
});

test("offers Tag whole file for a binary file", () => {
	const markup = renderDiff({
		file: {
			oldPath: "assets/logo.png",
			newPath: "assets/logo.png",
			status: "modified",
			binary: true,
			insertions: 1,
			deletions: 1,
			hunks: [],
		},
		onFileTag: () => {},
	});

	expect(markup).toContain('aria-label="Tag whole file"');
	expect(markup).toMatch(/<h2[^>]*>assets\/logo\.png<\/h2>/);
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
	expect(card).toContain('data-resolved="false"');
	expect(card).toContain('data-collapsed="false"');
	expect(card).toContain("Explain");
	expect(card).not.toMatch(/\sdisabled(?:=""|[\s>])/);
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

test("marks resolved discussion state with data attributes", () => {
	const markup = renderDiff({
		discussions: [{ ...positionedDiscussion, resolved: true }],
	});

	expect(markup).toContain('data-resolved="true"');
	expect(markup).toContain('data-collapsed="false"');
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

	expect(markup).toContain("+1");
	expect(markup).toContain("−0");
	expect(markup).toContain('placeholder="Find in file…"');
	expect(markup).toContain('aria-label="Find in file"');
	// The result counter and previous/next arrows appear only after a search.
	expect(markup).not.toContain("1/1");
	expect(markup).not.toContain("Previous match");
	expect(markup).not.toContain("Next match");
	// The layout and file-scope controls are icon toggles with accessible labels.
	expect(markup).toContain('aria-label="Inline"');
	expect(markup).toContain('aria-label="Side by side"');
	expect(markup).toContain('aria-label="Full file"');
	expect(markup).toContain('aria-label="Diff only"');
});

test("shows the find result count and navigation once a search is made", () => {
	const markup = renderDiff({ findQuery: "value" });

	expect(markup).toContain("1/1");
	expect(markup).toContain('aria-label="Previous match"');
	expect(markup).toContain('aria-label="Next match"');
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

	expect(markup).toContain("0/0");
	expect(markup).toContain('aria-live="polite"');
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
test("keeps find controls in one constrained inline group", () => {
	const markup = renderDiff({
		file: multiHunkFile,
		findQuery: "change",
	});
	const documentFragment = document.createElement("div");
	documentFragment.innerHTML = markup;
	const control = documentFragment.querySelector<HTMLElement>(
		"[data-find-control]",
	);

	expect(control).not.toBeNull();
	if (!control) throw new Error("find control missing");
	expect(control.classList.contains("min-w-0")).toBe(true);
	expect(control.classList.contains("max-w-full")).toBe(true);
	expect(control.classList.contains("shrink")).toBe(true);
	expect(control.classList.contains("overflow-hidden")).toBe(true);
	expect(control.classList.contains("flex-wrap")).toBe(false);
	expect(
		control.querySelector('input[aria-label="Find in file"]'),
	).not.toBeNull();
	expect(control.querySelector("[data-find-count]")).not.toBeNull();
	expect(control.querySelector("[data-find-navigation]")).not.toBeNull();
	expect(
		control.querySelector('button[aria-label="Previous match"]'),
	).not.toBeNull();
	expect(
		control.querySelector('button[aria-label="Next match"]'),
	).not.toBeNull();
});
test("keeps toolbar buttons aligned to the find control height", () => {
	const markup = renderDiff({
		file: markdownFile,
		findQuery: "Review",
		onFileTag: () => {},
		onViewModeChange: () => {},
		onWholeFileChange: () => {},
	});
	const container = document.createElement("div");
	container.innerHTML = markup;

	const findControl = container.querySelector<HTMLElement>(
		"[data-find-control]",
	);
	const segmentedGroups = [
		...container.querySelectorAll<HTMLElement>(
			'[data-slot="toggle-group"][data-variant="segmented"]',
		),
	];
	const segmentedItems = [
		...container.querySelectorAll<HTMLElement>(
			'[data-slot="toggle-group-item"][data-variant="segmented"]',
		),
	];
	const tagButton = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Tag whole file"]',
	);

	expect(findControl?.classList.contains("h-8")).toBe(true);
	expect(segmentedGroups).toHaveLength(3);
	expect(segmentedItems.every((item) => item.classList.contains("h-7"))).toBe(
		true,
	);
	expect(tagButton?.className).toContain("size-8");
});

test("shows the current match and total for multiple matches", () => {
	const markup = renderDiff({
		file: multiHunkFile,
		findQuery: "change",
	});

	expect(markup).toContain("1/2");
});

test("navigates find matches with mouse controls and wraps around", () => {
	const { container, root } = mountDiff();

	const originalScrollIntoView = Element.prototype.scrollIntoView;
	Element.prototype.scrollIntoView = () => {};
	try {
		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Find in file"]',
		);
		expect(input).not.toBeNull();
		if (!input) throw new Error("find input missing");

		act(() => setInputValue(input, "change"));
		expect(
			container.querySelector<HTMLElement>("[data-find-count]")?.textContent,
		).toBe("1/2");

		const previous = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Previous match"]',
		);
		const next = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Next match"]',
		);
		expect(previous).not.toBeNull();
		expect(next).not.toBeNull();
		if (!previous || !next) throw new Error("find navigation missing");

		act(() => next.click());
		expect(
			container.querySelector<HTMLElement>("[data-find-count]")?.textContent,
		).toBe("2/2");
		act(() => next.click());
		expect(
			container.querySelector<HTMLElement>("[data-find-count]")?.textContent,
		).toBe("1/2");
		act(() => previous.click());
		expect(
			container.querySelector<HTMLElement>("[data-find-count]")?.textContent,
		).toBe("2/2");
	} finally {
		act(() => root.unmount());
		container.remove();
		Element.prototype.scrollIntoView = originalScrollIntoView;
	}
});

test("focuses find with Cmd/Ctrl-F and preserves keyboard navigation", () => {
	const { container, root } = mountDiff();

	const originalScrollIntoView = Element.prototype.scrollIntoView;
	Element.prototype.scrollIntoView = () => {};
	try {
		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Find in file"]',
		);
		expect(input).not.toBeNull();
		if (!input) throw new Error("find input missing");

		act(() => {
			document.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "f",
					metaKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(document.activeElement).toBe(input);

		act(() => {
			document.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "f",
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(document.activeElement).toBe(input);

		act(() => setInputValue(input, "change"));
		expect(
			container.querySelector<HTMLElement>("[data-find-count]")?.textContent,
		).toBe("1/2");

		act(() => {
			input.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(
			container.querySelector<HTMLElement>("[data-find-count]")?.textContent,
		).toBe("2/2");

		act(() => {
			input.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Enter",
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(
			container.querySelector<HTMLElement>("[data-find-count]")?.textContent,
		).toBe("1/2");

		act(() => {
			input.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(input.value).toBe("");
		expect(container.querySelector("[data-find-count]")).toBeNull();
		expect(document.activeElement).not.toBe(input);
	} finally {
		act(() => root.unmount());
		container.remove();
		Element.prototype.scrollIntoView = originalScrollIntoView;
	}
});
test("offers the markdown rendered/diff view as icon segments with custom tooltips", () => {
	const markup = renderDiff({ file: markdownFile });

	expect(markup).toContain('aria-label="Rendered"');
	expect(markup).toContain('aria-label="Raw"');
	expect(markup).not.toContain('title="Rendered"');
	expect(markup).not.toContain('title="Raw"');
	// The diff view is the default; the rendered segment is inactive.
	expect(markup).toContain('aria-label="Raw"');
	expect(markup).toContain('aria-label="Rendered"');
	expect(markup).toContain('data-state="on"');
	expect(markup).toContain('data-state="off"');
	expect(markup).toContain('aria-pressed="true"');
	expect(markup).toContain('aria-pressed="false"');
	expect(markup).toContain("aria-pressed:bg-primary");
	expect(markup).toContain("aria-pressed:text-primary-foreground");
	expect(markup).toContain("data-[state=on]:bg-primary");
	// The find box remains available for a markdown diff.
	expect(markup).toContain('placeholder="Find in file…"');
});
test("keeps the icon-only whole-file tag callback and custom trigger", () => {
	const taggedPaths: string[] = [];
	const { container, root } = mountDiff({
		onFileTag: (path) => taggedPaths.push(path),
	});

	try {
		const button = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Tag whole file"]',
		);
		expect(button).not.toBeNull();
		expect(button?.getAttribute("title")).toBeNull();
		expect(button?.getAttribute("data-slot")).toBe("tooltip-trigger");
		expect(button?.textContent?.trim()).toBe("");

		act(() => button?.click());
		expect(taggedPaths).toEqual(["src/app.ts"]);
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});
test("transitions layout and file-scope toggles while keeping one option pressed", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	let mode: "inline" | "side-by-side" = "inline";
	let wholeFile = false;
	const modeChanges: string[] = [];
	const wholeFileChanges: boolean[] = [];
	const render = () => {
		root.render(
			<DiffView
				file={file}
				mode={mode}
				wholeFile={wholeFile}
				largeFileLineThreshold={800}
				fileContents={null}
				fileContentsError={null}
				onModeChange={(next) => {
					modeChanges.push(next);
					mode = next;
					render();
				}}
				onWholeFileChange={(next) => {
					wholeFileChanges.push(next);
					wholeFile = next;
					render();
				}}
				onLineSelection={() => {}}
				onCommentSelection={() => {}}
			/>,
		);
	};
	const toggle = (label: string) =>
		container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

	try {
		act(render);
		const inline = toggle("Inline");
		const sideBySide = toggle("Side by side");
		const whole = toggle("Full file");
		const diffOnly = toggle("Diff only");
		expect(inline?.getAttribute("aria-pressed")).toBe("true");
		expect(sideBySide?.getAttribute("aria-pressed")).toBe("false");
		expect(whole?.getAttribute("aria-pressed")).toBe("false");
		expect(diffOnly?.getAttribute("aria-pressed")).toBe("true");
		if (!inline || !sideBySide || !whole || !diffOnly) return;

		act(() => sideBySide.click());
		expect(modeChanges).toEqual(["side-by-side"]);
		expect(toggle("Inline")?.getAttribute("aria-pressed")).toBe("false");
		expect(toggle("Side by side")?.getAttribute("aria-pressed")).toBe("true");

		// Pressing active single-select option must not leave group empty.
		act(() => sideBySide.click());
		expect(modeChanges).toEqual(["side-by-side"]);
		expect(toggle("Side by side")?.getAttribute("aria-pressed")).toBe("true");

		act(() => toggle("Full file")?.click());
		expect(wholeFileChanges).toEqual([true]);
		expect(toggle("Full file")?.getAttribute("aria-pressed")).toBe("true");
		expect(toggle("Diff only")?.getAttribute("aria-pressed")).toBe("false");

		act(() => toggle("Diff only")?.click());
		expect(wholeFileChanges).toEqual([true, false]);
		expect(toggle("Full file")?.getAttribute("aria-pressed")).toBe("false");
		expect(toggle("Diff only")?.getAttribute("aria-pressed")).toBe("true");
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("transitions markdown view toggles and preserves one pressed option", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	let viewMode: "rendered" | "diff" = "diff";
	const viewModeChanges: string[] = [];
	const render = () => {
		root.render(
			<DiffView
				file={markdownFile}
				mode="inline"
				viewMode={viewMode}
				largeFileLineThreshold={800}
				fileContents={null}
				fileContentsError={null}
				onModeChange={() => {}}
				onViewModeChange={(next) => {
					viewModeChanges.push(next);
					viewMode = next;
					render();
				}}
				onLineSelection={() => {}}
				onCommentSelection={() => {}}
			/>,
		);
	};
	const toggle = (label: string) =>
		container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

	try {
		act(render);
		expect(toggle("Rendered")?.getAttribute("aria-pressed")).toBe("false");
		expect(toggle("Raw")?.getAttribute("aria-pressed")).toBe("true");
		const rendered = toggle("Rendered");
		const diff = toggle("Raw");
		if (!rendered || !diff) return;

		act(() => rendered.click());
		expect(viewModeChanges).toEqual(["rendered"]);
		expect(toggle("Rendered")?.getAttribute("aria-pressed")).toBe("true");
		expect(toggle("Raw")?.getAttribute("aria-pressed")).toBe("false");

		act(() => rendered.click());
		expect(viewModeChanges).toEqual(["rendered"]);
		expect(toggle("Rendered")?.getAttribute("aria-pressed")).toBe("true");

		act(() => diff.click());
		expect(viewModeChanges).toEqual(["rendered", "diff"]);
		expect(toggle("Rendered")?.getAttribute("aria-pressed")).toBe("false");
		expect(toggle("Raw")?.getAttribute("aria-pressed")).toBe("true");
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("moves focus between layout toggles with horizontal arrow keys", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);

	try {
		act(() => {
			root.render(
				<DiffView
					file={file}
					mode="inline"
					largeFileLineThreshold={800}
					fileContents={null}
					fileContentsError={null}
					onModeChange={() => {}}
					onLineSelection={() => {}}
					onCommentSelection={() => {}}
				/>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});
		const inline = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Inline"]',
		);
		const sideBySide = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Side by side"]',
		);
		expect(inline).not.toBeNull();
		expect(sideBySide).not.toBeNull();
		if (!inline || !sideBySide) return;
		await act(async () => {
			inline.focus();
			inline.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "ArrowRight",
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});
		expect(document.activeElement).toBe(sideBySide);

		await act(async () => {
			sideBySide.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "ArrowLeft",
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});
		expect(document.activeElement).toBe(inline);
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});
test("offers a Viewed checkbox in the diff header that defaults to unchecked", () => {
	const markup = renderDiff();

	expect(markup).toContain('title="Mark file viewed"');
	expect(markup).toContain("Viewed");
	expect(markup).toContain('aria-label="Viewed"');
	expect(markup).toMatch(/role="checkbox"[^>]*aria-checked="false"/);
});

test("marks the header Viewed checkbox when the file is viewed", () => {
	const markup = renderDiff({ viewed: true });

	expect(markup).toContain('aria-label="Viewed"');
	expect(markup).toMatch(/role="checkbox"[^>]*aria-checked="true"/);
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

	expect(markup).toContain('aria-label="Collapse all comments"');
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

test("omits discussion paths and repeated note metadata", () => {
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

	expect(markup).toContain(">new:1</span>");
	expect(markup).not.toContain("src/app.ts:new:1");
	expect(markup).not.toContain("<time");
	expect(markup).not.toContain("2026-01-01T00:00:00.000Z");
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

	expect(markup).toContain('aria-label="Expand all comments"');
	expect(markup).toContain('aria-expanded="false"');
	expect(markup).toContain('data-collapsed="true"');
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

test("renders positioned discussion Markdown through the sanitized comment renderer", () => {
	const markup = renderDiff({
		discussions: [
			{
				id: "markdown-discussion",
				resolved: false,
				position: {
					newPath: "src/app.ts",
					oldPath: "src/app.ts",
					newLine: 1,
					oldLine: null,
				},
				notes: [
					{
						id: "markdown-note",
						author: "reviewer",
						body: [
							"# Review note",
							"",
							"**Important**",
							"",
							"- item",
							"",
							"`inline`",
							"",
							"```ts",
							"const answer = 42;",
							"```",
							"",
							'<img src="x" onerror="alert(1)">',
							'<script>alert("x")</script>',
						].join("\n"),
						createdAt: "2026-01-01T00:00:00.000Z",
						system: false,
					},
				],
			},
		],
	});

	expect(markup).toContain("<h1>Review note</h1>");
	expect(markup).toContain("<strong>Important</strong>");
	expect(markup).toContain("<li>item</li>");
	expect(markup).toContain("<code>inline</code>");
	expect(markup).toContain("<pre><code");
	expect(markup).not.toContain("<script");
	expect(markup).not.toContain("onerror");
});

test("keeps collapsed discussion summaries as plain text", () => {
	const markup = renderDiff({
		commentsCollapsed: true,
		discussions: [
			{
				id: "collapsed-markdown-discussion",
				resolved: false,
				position: {
					newPath: "src/app.ts",
					oldPath: "src/app.ts",
					newLine: 1,
					oldLine: null,
				},
				notes: [
					{
						id: "collapsed-markdown-note",
						author: "reviewer",
						body: "**Important**\n\nMore detail",
						createdAt: "2026-01-01T00:00:00.000Z",
						system: false,
					},
				],
			},
		],
	});
	const preview = markup.match(
		/<span[^>]*title="\*\*Important\*\*"[^>]*>\*\*Important\*\*<\/span>/,
	)?.[0];

	expect(preview).toBeDefined();
	expect(preview).toContain("**Important**");
	expect(preview).not.toContain("<strong>");
});

test("highlights multiline source comments with shared grammar state", {
	timeout: 30_000,
}, async () => {
	const multilineCommentFile = {
		oldPath: "src/example.ts",
		newPath: "src/example.ts",
		status: "added",
		binary: false,
		insertions: 4,
		deletions: 0,
		hunks: [
			{
				header: "@@ -0,0 +1,4 @@",
				oldStart: 0,
				oldLines: 0,
				newStart: 1,
				newLines: 4,
				lines: [
					{ kind: "add", oldLine: null, newLine: 1, text: "/**" },
					{
						kind: "add",
						oldLine: null,
						newLine: 2,
						text: " * multiline comment",
					},
					{ kind: "add", oldLine: null, newLine: 3, text: " */" },
					{
						kind: "add",
						oldLine: null,
						newLine: 4,
						text: "const value = 1;",
					},
				],
			},
		],
	} as const;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);

	try {
		act(() => {
			root.render(
				<DiffView
					file={multilineCommentFile}
					mode="inline"
					largeFileLineThreshold={800}
					fileContents={null}
					fileContentsError={null}
					onModeChange={() => {}}
					onLineSelection={() => {}}
					onCommentSelection={() => {}}
				/>,
			);
		});
		for (let attempt = 0; attempt < 500; attempt++) {
			const commentToken = container
				.querySelectorAll<HTMLElement>(".diff-line")[1]
				?.querySelector<HTMLElement>(".line-text > span:nth-child(2) > span");
			if (commentToken?.style.color === "rgb(106, 115, 125)") break;
			await act(async () => {
				const { promise, resolve } = Promise.withResolvers<void>();
				setTimeout(resolve, 10);
				await promise;
			});
		}

		const rows = container.querySelectorAll(".diff-line");
		const commentToken = rows[1]?.querySelector<HTMLElement>(
			".line-text > span:nth-child(2) > span",
		);
		expect(["#6A737D", "rgb(106, 115, 125)"]).toContain(
			commentToken?.style.color,
		);
		expect(commentToken?.style.color).not.toBe("rgb(249, 117, 131)");
	} finally {
		act(() => {
			root.unmount();
		});
		container.remove();
	}
});

test("keeps rendered markdown DOM intact during unrelated parent updates", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const fileContents = "# Guide\n\n```ts\nconst value = 1;\n```";
	const drafts = [] as const;

	const render = () => {
		root.render(
			<DiffView
				file={markdownFile}
				mode="inline"
				viewMode="rendered"
				largeFileLineThreshold={800}
				fileContents={fileContents}
				fileContentsError={null}
				drafts={drafts}
				onModeChange={() => {}}
				onLineSelection={() => {}}
				onCommentSelection={() => {}}
				onMarkdownTag={() => {}}
				onMarkdownComment={() => {}}
			/>,
		);
	};

	try {
		act(render);
		const markdown = container.querySelector(".rendered-markdown");
		expect(markdown).not.toBeNull();
		if (!markdown) return;
		const marker = document.createElement("span");
		marker.dataset.testMarker = "sentinel";
		marker.textContent = "sentinel";
		markdown.append(marker);

		act(render);

		expect(markdown.querySelector('[data-test-marker="sentinel"]')).toBe(
			marker,
		);
	} finally {
		act(() => {
			root.unmount();
		});
		container.remove();
	}
});

test("marks selected diff rows with data-selected", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);

	try {
		act(() => {
			root.render(
				<DiffView
					file={file}
					mode="inline"
					largeFileLineThreshold={800}
					fileContents={null}
					fileContentsError={null}
					onModeChange={() => {}}
					onLineSelection={() => {}}
					onCommentSelection={() => {}}
				/>,
			);
		});

		const row = container.querySelector<HTMLTableRowElement>(
			'.diff-line[role="button"]',
		);
		expect(row).not.toBeNull();
		if (!row) return;

		act(() => {
			row.click();
		});

		expect(
			container.querySelector('.diff-line[data-selected="true"]'),
		).not.toBeNull();
	} finally {
		act(() => {
			root.unmount();
		});
		container.remove();
	}
});
test("bounds long inline discussion content and keeps code and table regions internal", () => {
	const longPath =
		"packages/review/features/comments/components/very-long-discussion-file-name.ts";
	const body = [
		`Please inspect ${longPath} and https://example.test/review/${"segment".repeat(20)}.`,
		"",
		"`inline-code-that-needs-to-wrap-within-the-card`",
		"",
		"```ts",
		"const result = calculateSomethingWithAnIntentionallyLongIdentifier();",
		"```",
		"",
		"| file | detail |",
		"| --- | --- |",
		`| ${longPath} | table content |`,
	].join("\n");
	const markup = renderDiff({
		discussions: [
			{
				...positionedDiscussion,
				notes: [{ ...positionedDiscussion.notes[0], body }],
			},
		],
	});
	const container = document.createElement("div");
	container.innerHTML = markup;
	const card = container.querySelector<HTMLElement>(
		'[data-discussion-id="disc-1"]',
	);
	const markdown = card?.querySelector<HTMLElement>(".comment-markdown");
	const tableWrap = markdown?.querySelector<HTMLElement>(
		".rendered-table-wrap",
	);

	expect(card?.className).toContain("min-w-0");
	expect(card?.className).toContain("max-w-full");
	expect(card?.className).toContain("overflow-hidden");
	expect(markdown?.className).toContain("min-w-0");
	expect(markdown?.className).toContain("max-w-full");
	expect(markdown?.className).toContain("[overflow-wrap:anywhere]");
	expect(tableWrap?.className).toContain("max-w-full");
	expect(markdown?.querySelector("pre")).not.toBeNull();
	expect(container.textContent).toContain(longPath);
});

test("groups inline Explain in compact actions and preserves its callback", () => {
	let explained = "";
	const { container } = mountDiff({
		discussions: [positionedDiscussion],
		onExplainDiscussion: (discussionId) => {
			explained = discussionId;
		},
	});
	const group = container.querySelector<HTMLElement>(
		'[data-action-group="discussion-actions"]',
	);
	const button = container.querySelector<HTMLButtonElement>(
		'button[data-action="explain"]',
	);

	expect(group?.className).toContain("flex");
	expect(group?.className).toContain("shrink-0");
	expect(button?.className).toContain("bg-primary");
	expect(button?.getAttribute("aria-busy")).toBeNull();
	act(() => button?.click());
	expect(explained).toBe("disc-1");
});

test("marks inline Explain as busy while disabled", () => {
	const markup = renderDiff({
		discussions: [positionedDiscussion],
		onExplainDiscussion: () => {},
		explainDisabled: true,
	});
	const container = document.createElement("div");
	container.innerHTML = markup;
	const button = container.querySelector<HTMLButtonElement>(
		'button[data-action="explain"]',
	);

	expect(button?.disabled).toBe(true);
	expect(button?.getAttribute("aria-busy")).toBe("true");
	expect(button?.querySelector("svg.animate-spin")).not.toBeNull();
});
