import { afterEach, expect, test } from "bun:test";
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

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
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
	const viewed: Array<[readonly string[], boolean]> = [];
	const rendered = renderInteractive({
		files: [parsedFile("src/a.ts"), parsedFile("src/nested/a.ts")],
		onSelectFile: (path) => selected.push(path),
		onViewedChange: (paths, isViewed) => viewed.push([paths, isViewed]),
	});

	act(() => modeButton(rendered.container, "Tree view").click());
	const nav = changedFilesNav(rendered.container);
	const srcFolder = nav.querySelector<HTMLButtonElement>(
		'button[aria-label="Collapse src"]',
	);
	if (!srcFolder) throw new Error("Tree folder is missing");
	expect(srcFolder.className.split(/\s+/)).toContain("justify-start");
	expect(srcFolder.className.split(/\s+/)).toContain("h-7");
	const srcRow = nav.querySelector<HTMLElement>('[data-folder-row="src"]');
	if (!srcRow) throw new Error("Tree folder row is missing");
	expect(srcRow.className.split(/\s+/)).toContain("hover:bg-muted/60");
	expect(srcFolder.className.split(/\s+/)).toContain(
		"aria-expanded:bg-transparent",
	);
	expect(srcFolder.querySelectorAll("svg")).toHaveLength(1);
	expect(srcFolder.querySelector("svg")?.getAttribute("class")).toContain(
		"size-3",
	);
	const nestedFolder = nav.querySelector<HTMLButtonElement>(
		'button[aria-label="Collapse src/nested"]',
	);
	if (!nestedFolder) throw new Error("Nested folder is missing");
	const nestedRow = nav.querySelector<HTMLElement>(
		'[data-folder-row="src/nested"]',
	);
	if (!nestedRow) throw new Error("Nested folder row is missing");
	expect(srcRow.style.paddingInlineStart).toBe("0.5rem");
	expect(nestedRow.style.paddingInlineStart).toBe("1.75rem");
	const leaf = nav.querySelector<HTMLButtonElement>(
		'button[aria-label="src/a.ts"]',
	);
	const nestedLeaf = nav.querySelector<HTMLButtonElement>(
		'button[aria-label="src/nested/a.ts"]',
	);
	if (!leaf || !nestedLeaf) throw new Error("Tree leaves are missing");
	const leafRow = leaf.closest<HTMLElement>("[data-file-path]");
	const nestedLeafRow = nestedLeaf.closest<HTMLElement>("[data-file-path]");
	if (!leafRow || !nestedLeafRow) throw new Error("Tree file rows are missing");
	expect(leafRow.style.paddingInlineStart).toBe(
		nestedRow.style.paddingInlineStart,
	);
	expect(nestedLeafRow.style.paddingInlineStart).toBe("3rem");
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
	expect(viewed).toEqual([[["src/a.ts"], true]]);
	expect(
		nav.querySelector('[role="checkbox"][aria-label^="Viewed "]'),
	).not.toBeNull();
	expect(nav.querySelector('button[aria-label^="Collapse "]')).not.toBeNull();
});

test("shows recursive change totals and folder viewed state", () => {
	const rendered = renderInteractive({
		files: [
			parsedFile("src/a.ts", { insertions: 2, deletions: 1 }),
			parsedFile("src/nested/b.ts", { insertions: 3, deletions: 4 }),
			parsedFile("lib/c.ts", { insertions: 7, deletions: 2 }),
		],
		viewedFiles: ["src/a.ts"],
	});
	act(() => modeButton(rendered.container, "Tree view").click());
	const nav = changedFilesNav(rendered.container);
	const srcRow = nav.querySelector<HTMLElement>('[data-folder-row="src"]');
	const nestedRow = nav.querySelector<HTMLElement>(
		'[data-folder-row="src/nested"]',
	);
	if (!srcRow || !nestedRow) throw new Error("Folder rows are missing");

	expect(srcRow.querySelector(".text-success")?.textContent).toBe("+5");
	expect(srcRow.querySelector(".text-destructive")?.textContent).toBe("−5");
	expect(nestedRow.querySelector(".text-success")?.textContent).toBe("+3");
	expect(nestedRow.querySelector(".text-destructive")?.textContent).toBe("−4");
	expect(
		srcRow.querySelector('[role="checkbox"]')?.getAttribute("aria-checked"),
	).toBe("false");
	expect(
		nestedRow.querySelector('[role="checkbox"]')?.getAttribute("aria-checked"),
	).toBe("false");
});

test("folder Viewed controls toggle all recursive descendants only", () => {
	const viewed: Array<[readonly string[], boolean]> = [];
	const rendered = renderInteractive({
		files: [
			parsedFile("src/a.ts"),
			parsedFile("src/nested/b.ts"),
			parsedFile("lib/c.ts"),
		],
		viewedFiles: ["src/a.ts", "lib/c.ts"],
		onViewedChange: (paths, isViewed) => viewed.push([paths, isViewed]),
	});
	act(() => modeButton(rendered.container, "Tree view").click());

	const folderCheckbox = (path: string) =>
		changedFilesNav(rendered.container).querySelector<HTMLElement>(
			`[role="checkbox"][aria-label="Viewed folder ${path}"]`,
		);
	const srcCheckbox = folderCheckbox("src");
	if (!srcCheckbox || !folderCheckbox("src/nested")) {
		throw new Error("Folder Viewed controls are missing");
	}

	expect(srcCheckbox.getAttribute("aria-checked")).toBe("false");
	act(() => srcCheckbox.click());
	expect(viewed).toEqual([[["src/a.ts", "src/nested/b.ts"], true]]);

	rendered.rerender({
		viewedFiles: ["src/a.ts", "src/nested/b.ts", "lib/c.ts"],
	});
	expect(folderCheckbox("src")?.getAttribute("aria-checked")).toBe("true");
	expect(folderCheckbox("src/nested")?.getAttribute("aria-checked")).toBe(
		"true",
	);

	viewed.length = 0;
	const checkedSrcCheckbox = folderCheckbox("src");
	if (!checkedSrcCheckbox) throw new Error("Root Viewed control is missing");
	act(() => checkedSrcCheckbox.click());
	expect(viewed).toEqual([[["src/a.ts", "src/nested/b.ts"], false]]);

	rendered.rerender({
		viewedFiles: ["src/a.ts", "src/nested/b.ts", "lib/c.ts"],
	});
	viewed.length = 0;
	const checkedNestedCheckbox = folderCheckbox("src/nested");
	if (!checkedNestedCheckbox)
		throw new Error("Nested Viewed control is missing");
	act(() => checkedNestedCheckbox.click());
	expect(viewed).toEqual([[["src/nested/b.ts"], false]]);

	rendered.rerender({ viewedFiles: ["src/a.ts", "lib/c.ts"] });
	expect(folderCheckbox("src")?.getAttribute("aria-checked")).toBe("false");
	expect(folderCheckbox("src/nested")?.getAttribute("aria-checked")).toBe(
		"false",
	);
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
test("uses full-path callbacks in list mode", () => {
	const selected: string[] = [];
	const viewed: Array<[readonly string[], boolean]> = [];
	const rendered = renderInteractive({
		files: [parsedFile("src/a.ts")],
		onSelectFile: (path) => selected.push(path),
		onViewedChange: (paths, isViewed) => viewed.push([paths, isViewed]),
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
	expect(viewed).toEqual([[["src/a.ts"], true]]);
});

test("keeps long nested paths, stats, and Viewed controls accessible", () => {
	const path =
		"src/feature-with-a-long-name/reviews/a-folder-with-a-long-name/a-file-with-a-long-name.ts";
	const folderPath =
		"src/feature-with-a-long-name/reviews/a-folder-with-a-long-name";
	const selected: string[] = [];
	const viewed: Array<[readonly string[], boolean]> = [];
	const rendered = renderInteractive({
		files: [
			parsedFile(path, {
				insertions: 123456,
				deletions: 789012,
			}),
		],
		onSelectFile: (selectedPath) => selected.push(selectedPath),
		onViewedChange: (paths, isViewed) => viewed.push([paths, isViewed]),
	});
	act(() => modeButton(rendered.container, "Tree view").click());

	const nav = changedFilesNav(rendered.container);
	const folderButton = nav.querySelector<HTMLButtonElement>(
		`button[aria-label="Collapse ${folderPath}"]`,
	);
	const fileButton = nav.querySelector<HTMLButtonElement>(
		`button[aria-label="${path}"]`,
	);
	const fileViewed = nav.querySelector<HTMLElement>(
		`[role="checkbox"][aria-label="Viewed ${path}"]`,
	);
	const folderViewed = nav.querySelector<HTMLElement>(
		`[role="checkbox"][aria-label="Viewed folder ${folderPath}"]`,
	);
	if (!folderButton || !fileButton || !fileViewed || !folderViewed) {
		throw new Error("Long nested path controls are missing");
	}

	expect(folderButton.title).toBe(`Collapse ${folderPath}`);
	expect(fileButton.title).toBe(path);
	const fileRow = fileButton.closest<HTMLElement>("[data-file-path]");
	if (!fileRow) throw new Error("Nested file row is missing");
	expect(fileRow.querySelector(".text-success")?.textContent).toBe("+123456");
	expect(fileRow.querySelector(".text-destructive")?.textContent).toBe(
		"−789012",
	);

	act(() => fileButton.click());
	act(() => fileViewed.click());
	act(() => folderViewed.click());
	expect(selected).toEqual([path]);
	expect(viewed).toEqual([
		[[path], true],
		[[path], true],
	]);
});
