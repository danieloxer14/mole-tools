import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { ParsedFileDiff } from "../../../../shared/diff-parse";
import {
	buildChangedFileTree,
	ChangedFiles,
	type ChangedFilesProps,
	type FileTreeDirectory,
	type FileTreeNode,
} from "./ChangedFiles";

const dom = new Window();
Object.assign(globalThis, {
	window: dom,
	document: dom.document,
	navigator: dom.navigator,
	Node: dom.Node,
	Element: dom.Element,
	HTMLElement: dom.HTMLElement,
	MutationObserver: dom.MutationObserver,
	getComputedStyle: dom.getComputedStyle.bind(dom),
	requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
	cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
	IS_REACT_ACT_ENVIRONMENT: true,
});
const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
});

function parsedFile(
	path: string,
	overrides: Partial<ParsedFileDiff> = {},
): ParsedFileDiff {
	return {
		oldPath: path,
		newPath: path,
		status: "modified",
		binary: false,
		insertions: 2,
		deletions: 1,
		hunks: [],
		...overrides,
	};
}

function entry(path: string): { path: string; file: ParsedFileDiff } {
	return { path, file: parsedFile(path) };
}

function directory(nodes: FileTreeNode[], path: string): FileTreeDirectory {
	const node = nodes.find(
		(candidate) => candidate.kind === "directory" && candidate.path === path,
	);
	if (node?.kind !== "directory") {
		throw new Error(`Missing directory ${path}`);
	}
	return node;
}

interface InteractiveRender {
	container: HTMLDivElement;
	rerender: (nextProps: Partial<ChangedFilesProps>) => void;
}

function renderInteractive(
	overrides: Partial<ChangedFilesProps> = {},
): InteractiveRender {
	const files = overrides.files ?? [
		parsedFile("src/a.ts"),
		parsedFile("src/nested/b.ts"),
		parsedFile("lib/b.ts"),
		parsedFile("README.md"),
	];
	const current: ChangedFilesProps = {
		files,
		viewedFiles: [],
		selectedPath: null,
		onSelectFile: () => {},
		onViewedChange: () => {},
		...overrides,
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const render = () => root.render(<ChangedFiles {...current} />);
	act(render);
	return {
		container,
		rerender(nextProps) {
			Object.assign(current, nextProps);
			act(render);
		},
	};
}

function changedFilesNav(container: HTMLElement): HTMLElement {
	const nav = container.querySelector<HTMLElement>(
		'nav[aria-label="Changed files"]',
	);
	if (!nav) throw new Error("Changed files navigation is missing");
	return nav;
}

function modeButton(container: HTMLElement, label: string): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${label}"]`,
	);
	if (!button) throw new Error(`Missing ${label} mode button`);
	return button;
}

test("builds an ordered tree with roots, duplicate basenames, and collisions", () => {
	const tree = buildChangedFileTree([
		entry("src/first.ts"),
		entry("README.md"),
		entry("src/nested/shared.ts"),
		entry("other/shared.ts"),
		entry("src"),
		entry(""),
	]);

	expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual([
		"directory:src",
		"file:README.md",
		"directory:other",
		"file:src",
	]);
	const src = directory(tree, "src");
	expect(src.children.map((node) => `${node.kind}:${node.name}`)).toEqual([
		"file:first.ts",
		"directory:nested",
	]);
	expect(directory(src.children, "src/nested").children[0]).toMatchObject({
		kind: "file",
		name: "shared.ts",
		path: "src/nested/shared.ts",
	});
	expect(directory(tree, "other").children[0]).toMatchObject({
		kind: "file",
		name: "shared.ts",
		path: "other/shared.ts",
	});
});

test("resolves new paths before old paths and omits empty paths", () => {
	const tree = buildChangedFileTree([
		{
			path: "renamed/new.ts",
			file: parsedFile("renamed/new.ts", { oldPath: "old.ts" }),
		},
		{
			path: "old.ts",
			file: parsedFile("old.ts", { oldPath: "old.ts", newPath: null }),
		},
	]);

	expect(directory(tree, "renamed").children[0]).toMatchObject({
		kind: "file",
		path: "renamed/new.ts",
	});
	expect(tree.map((node) => node.path)).toContain("old.ts");
});

test("renders the default list with encounter order, full labels, stats, and selection", () => {
	const files = [parsedFile("src/a.ts"), parsedFile("README.md")];
	const markup = renderToStaticMarkup(
		<ChangedFiles
			files={files}
			viewedFiles={["README.md"]}
			selectedPath="src/a.ts"
			onSelectFile={() => {}}
			onViewedChange={() => {}}
		/>,
	);

	const aIndex = markup.indexOf('aria-label="src/a.ts"');
	const readmeIndex = markup.indexOf('aria-label="README.md"');
	expect(aIndex).toBeGreaterThan(-1);
	expect(readmeIndex).toBeGreaterThan(aIndex);
	expect(markup).toContain('data-state="selected"');
	expect(markup).toContain("+2");
	expect(markup).toContain("−1");
	expect(markup).toContain('aria-label="Viewed README.md"');
	expect(markup).toContain('aria-checked="true"');
});

test("switches to tree leaves with full-path identity and shared callbacks", () => {
	const selected: string[] = [];
	const viewed: Array<[string, boolean]> = [];
	const rendered = renderInteractive({
		files: [parsedFile("src/a.ts"), parsedFile("src/nested/a.ts")],
		onSelectFile: (path) => selected.push(path),
		onViewedChange: (path, isViewed) => viewed.push([path, isViewed]),
	});

	act(() => modeButton(rendered.container, "Tree view").click());
	const nav = changedFilesNav(rendered.container);
	const leaf = nav.querySelector<HTMLButtonElement>(
		'button[aria-label="src/a.ts"]',
	);
	const nestedLeaf = nav.querySelector<HTMLButtonElement>(
		'button[aria-label="src/nested/a.ts"]',
	);
	if (!leaf || !nestedLeaf) throw new Error("Tree leaves are missing");
	expect(leaf.textContent).toBe("a.ts");
	expect(leaf.title).toBe("src/a.ts");
	expect(nestedLeaf.textContent).toBe("a.ts");
	expect(nestedLeaf.title).toBe("src/nested/a.ts");
	act(() => leaf.click());
	expect(selected).toEqual(["src/a.ts"]);

	const viewedCheckbox = nav.querySelector<HTMLElement>(
		'[role="checkbox"][aria-label="Viewed src/a.ts"]',
	);
	if (!viewedCheckbox) throw new Error("Tree Viewed control is missing");
	act(() => viewedCheckbox.click());
	expect(viewed).toEqual([["src/a.ts", true]]);
	expect(
		nav.querySelector('[role="checkbox"][aria-label^="Viewed "]'),
	).not.toBeNull();
	expect(nav.querySelector('button[aria-label^="Collapse "]')).not.toBeNull();
});

test("collapses folders independently and retains the state across mode switches", () => {
	const rendered = renderInteractive({
		files: [parsedFile("src/a.ts"), parsedFile("lib/b.ts")],
	});
	act(() => modeButton(rendered.container, "Tree view").click());

	const src = () =>
		rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Collapse src"], button[aria-label="Expand src"]',
		);
	const lib = () =>
		rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Collapse lib"], button[aria-label="Expand lib"]',
		);
	const srcButton = src();
	const libButton = lib();
	if (!srcButton || !libButton) throw new Error("Tree folders are missing");
	expect(srcButton.getAttribute("aria-expanded")).toBe("true");
	expect(libButton.getAttribute("aria-expanded")).toBe("true");
	act(() => srcButton.click());
	expect(src()?.getAttribute("aria-expanded")).toBe("false");
	expect(lib()?.getAttribute("aria-expanded")).toBe("true");

	act(() => modeButton(rendered.container, "List view").click());
	act(() => modeButton(rendered.container, "Tree view").click());
	expect(src()?.getAttribute("aria-expanded")).toBe("false");
	expect(lib()?.getAttribute("aria-expanded")).toBe("true");
});

test("does not scroll the selected row when toggling an unrelated folder", () => {
	const scrolls: string[] = [];
	const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
	HTMLElement.prototype.scrollIntoView = function () {
		scrolls.push(this.getAttribute("data-file-path") ?? "");
	};
	try {
		const rendered = renderInteractive({
			files: [parsedFile("src/a.ts"), parsedFile("lib/b.ts")],
			selectedPath: "src/a.ts",
		});
		act(() => modeButton(rendered.container, "Tree view").click());
		scrolls.length = 0;

		const lib = rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Collapse lib"]',
		);
		if (!lib) throw new Error("Library folder is missing");
		act(() => lib.click());

		expect(scrolls).toEqual([]);
	} finally {
		HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
	}
});

test("keeps folder disclosure relationships valid for paths with spaces", () => {
	const rendered = renderInteractive({
		files: [parsedFile("docs/My Notes/file.ts")],
	});
	act(() => modeButton(rendered.container, "Tree view").click());

	const trigger = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Collapse docs/My Notes"]',
	);
	if (!trigger) throw new Error("Nested folder is missing");
	const controlsId = trigger.getAttribute("aria-controls");
	if (!controlsId) throw new Error("Folder controls ID is missing");
	expect(controlsId).not.toMatch(/\s/);
	expect(
		rendered.container.querySelector(`[id="${controlsId}"]`),
	).not.toBeNull();

	act(() => trigger.click());
	expect(
		rendered.container.querySelector(`[id="${controlsId}"]`),
	).not.toBeNull();
});

test("reveals a selected descendant before nearest-row scrolling", () => {
	const scrolls: string[] = [];
	const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
	HTMLElement.prototype.scrollIntoView = function () {
		scrolls.push(this.getAttribute("data-file-path") ?? "");
	};
	try {
		const rendered = renderInteractive({ files: [parsedFile("src/a.ts")] });
		act(() => modeButton(rendered.container, "Tree view").click());
		const collapse = rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Collapse src"]',
		);
		if (!collapse) throw new Error("Source folder is missing");
		act(() => collapse.click());
		scrolls.length = 0;

		rendered.rerender({ selectedPath: "src/a.ts" });
		expect(
			rendered.container
				.querySelector<HTMLButtonElement>('button[aria-label="Collapse src"]')
				?.getAttribute("aria-expanded"),
		).toBe("true");
		expect(scrolls).toEqual(["src/a.ts"]);
	} finally {
		HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
	}
});

test("keeps selected and Viewed state while switching back to list", () => {
	const rendered = renderInteractive({
		files: [parsedFile("src/a.ts")],
		viewedFiles: ["src/a.ts"],
		selectedPath: "src/a.ts",
	});
	act(() => modeButton(rendered.container, "Tree view").click());
	const treeRow = changedFilesNav(rendered.container).querySelector(
		'[data-file-path="src/a.ts"]',
	);
	expect(treeRow?.getAttribute("data-state")).toBe("selected");
	expect(
		changedFilesNav(rendered.container)
			.querySelector<HTMLElement>(
				'[role="checkbox"][aria-label="Viewed src/a.ts"]',
			)
			?.getAttribute("aria-checked"),
	).toBe("true");

	act(() => modeButton(rendered.container, "List view").click());
	const listRow = changedFilesNav(rendered.container).querySelector(
		'[data-file-path="src/a.ts"]',
	);
	expect(listRow?.getAttribute("data-state")).toBe("selected");
	expect(
		changedFilesNav(rendered.container).querySelector<HTMLButtonElement>(
			'button[aria-label="src/a.ts"]',
		),
	).not.toBeNull();
});
test("uses full-path callbacks in list mode and keeps Viewed off folders", () => {
	const selected: string[] = [];
	const viewed: Array<[string, boolean]> = [];
	const rendered = renderInteractive({
		files: [parsedFile("src/a.ts")],
		onSelectFile: (path) => selected.push(path),
		onViewedChange: (path, isViewed) => viewed.push([path, isViewed]),
	});

	const listNav = changedFilesNav(rendered.container);
	const listLeaf = listNav.querySelector<HTMLButtonElement>(
		'button[aria-label="src/a.ts"]',
	);
	const listViewed = listNav.querySelector<HTMLElement>(
		'[role="checkbox"][aria-label="Viewed src/a.ts"]',
	);
	if (!listLeaf || !listViewed)
		throw new Error("List file controls are missing");
	act(() => listLeaf.click());
	act(() => listViewed.click());
	expect(selected).toEqual(["src/a.ts"]);
	expect(viewed).toEqual([["src/a.ts", true]]);

	act(() => modeButton(rendered.container, "Tree view").click());
	const folder = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Collapse src"]',
	);
	if (!folder) throw new Error("Tree folder is missing");
	expect(folder.querySelector('[role="checkbox"]')).toBeNull();
});
