import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ParsedFileDiff } from "../../../../shared/diff-parse";
import {
	buildChangedFileTree,
	ChangedFiles,
	type ChangedFilesProps,
	type FileTreeDirectory,
	type FileTreeNode,
	fitChangedFileName,
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

function visualName(element: Element): HTMLSpanElement {
	const label = element.querySelector<HTMLSpanElement>(
		'span[aria-hidden="true"]',
	);
	if (!label) throw new Error("Visual changed-file name is missing");
	return label;
}

interface NameMeasurementHarness {
	resize: (width: number) => void;
	loadFont: (glyphWidth: number) => void;
	restore: () => void;
}

let canvasGlyphWidth = 10;

function mockNameMeasurement(
	initialWidth: number,
	initialGlyphWidth: number,
	failFirstCanvasContext = false,
): NameMeasurementHarness {
	const observers: Array<{ resize: () => void }> = [];
	let width = initialWidth;
	canvasGlyphWidth = initialGlyphWidth;
	class TestResizeObserver implements ResizeObserver {
		private active = true;

		constructor(private readonly callback: ResizeObserverCallback) {
			observers.push(this);
		}

		observe(_target: Element, _options?: ResizeObserverOptions) {}
		unobserve(_target: Element) {}
		disconnect() {
			this.active = false;
		}
		resize() {
			if (this.active) this.callback([], this);
		}
	}

	const elementPrototype = HTMLElement.prototype;
	const canvasPrototype = Object.getPrototypeOf(
		document.createElement("canvas"),
	);
	const elementRect = Object.getOwnPropertyDescriptor(
		elementPrototype,
		"getBoundingClientRect",
	);
	const canvasGetContext = Object.getOwnPropertyDescriptor(
		canvasPrototype,
		"getContext",
	);
	const resizeObserver = Object.getOwnPropertyDescriptor(
		globalThis,
		"ResizeObserver",
	);
	const documentFonts = Object.getOwnPropertyDescriptor(document, "fonts");
	let canvasContextCalls = 0;
	const context = {
		font: "",
		measureText(value: string) {
			return { width: Array.from(value).length * canvasGlyphWidth };
		},
	} as CanvasRenderingContext2D;
	const fontEvents = new window.EventTarget();
	Object.defineProperty(fontEvents, "ready", {
		configurable: true,
		value: Promise.resolve(fontEvents),
	});
	Object.defineProperty(elementPrototype, "getBoundingClientRect", {
		configurable: true,
		value() {
			return {
				x: 0,
				y: 0,
				width,
				height: 16,
				top: 0,
				right: width,
				bottom: 16,
				left: 0,
				toJSON: () => ({}),
			} as DOMRect;
		},
	});
	Object.defineProperty(canvasPrototype, "getContext", {
		configurable: true,
		value: () => {
			canvasContextCalls += 1;
			return failFirstCanvasContext && canvasContextCalls === 1
				? null
				: context;
		},
	});
	Object.defineProperty(globalThis, "ResizeObserver", {
		configurable: true,
		writable: true,
		value: TestResizeObserver,
	});
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: fontEvents as unknown as FontFaceSet,
	});

	return {
		resize(nextWidth) {
			width = nextWidth;
			for (const observer of observers) observer.resize();
		},
		loadFont(nextGlyphWidth) {
			canvasGlyphWidth = nextGlyphWidth;
			fontEvents.dispatchEvent(new window.Event("loadingdone"));
		},
		restore() {
			if (elementRect) {
				Object.defineProperty(
					elementPrototype,
					"getBoundingClientRect",
					elementRect,
				);
			} else {
				Reflect.deleteProperty(elementPrototype, "getBoundingClientRect");
			}
			if (canvasGetContext) {
				Object.defineProperty(canvasPrototype, "getContext", canvasGetContext);
			} else {
				Reflect.deleteProperty(canvasPrototype, "getContext");
			}
			if (resizeObserver) {
				Object.defineProperty(globalThis, "ResizeObserver", resizeObserver);
			} else {
				Reflect.deleteProperty(globalThis, "ResizeObserver");
			}
			if (documentFonts) {
				Object.defineProperty(document, "fonts", documentFonts);
			} else {
				Reflect.deleteProperty(document, "fonts");
			}
		},
	};
}

test("fits names with balanced Unicode middles and extensions", () => {
	const measure = (text: string) => Array.from(text).length * 10;
	expect(fitChangedFileName("short.ts", 80, measure)).toBe("short.ts");
	expect(fitChangedFileName("long-name.ts", 70, measure)).toBe("lon….ts");

	const unicodeName = "日本語の長い名前😀.tsx";
	const visible = fitChangedFileName(unicodeName, 90, measure);
	const [prefix = "", suffix = ""] = visible.split("…");
	expect(visible.split("…")).toHaveLength(2);
	expect(
		Math.abs(Array.from(prefix).length - Array.from(suffix).length),
	).toBeLessThanOrEqual(1);
	expect(measure(visible)).toBeLessThanOrEqual(90);
	expect(fitChangedFileName(unicodeName, 50, measure)).toBe("….tsx");
	expect(fitChangedFileName(unicodeName, 0, measure)).toBe(unicodeName);
	expect(fitChangedFileName(unicodeName, 50, () => Number.NaN)).toBe(
		unicodeName,
	);
	expect(fitChangedFileName("foo.bar/verylongfolder", 200, measure)).toBe(
		"foo.bar/ve…ongfolder",
	);
});

test("retries filename measurement after canvas context is initially unavailable", () => {
	const measurement = mockNameMeasurement(200, 10, true);
	try {
		const rendered = renderInteractive({
			files: [parsedFile("src/a-long-file-name.ts")],
		});
		const button = rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="src/a-long-file-name.ts"]',
		);
		if (!button) throw new Error("File name is missing");
		const name = visualName(button);
		expect(name.textContent).toBe("a-long-file-name.ts");

		act(() => measurement.resize(80));
		expect(name.textContent).toContain("…");
	} finally {
		measurement.restore();
	}
});

test("measures shared names on mount, resize, and font loading", async () => {
	const measurement = mockNameMeasurement(200, 10);
	const groupPath = "foo.bar/verylongfolder";
	const filePath = `${groupPath}/deeply-long-component-name😀.tsx`;
	const selected: string[] = [];
	const viewed: Array<[readonly string[], boolean]> = [];
	try {
		const rendered = renderInteractive({
			files: [parsedFile(filePath)],
			onSelectFile: (path) => selected.push(path),
			onViewedChange: (paths, isViewed) => viewed.push([paths, isViewed]),
		});
		await act(async () => {
			await Promise.resolve();
		});

		const nav = changedFilesNav(rendered.container);
		const group = nav.querySelector<HTMLElement>(
			`[data-list-group="${groupPath}"]`,
		);
		const fileButton = Array.from(
			nav.querySelectorAll<HTMLButtonElement>("button"),
		).find((button) => button.getAttribute("aria-label") === filePath);
		if (!group || !fileButton) {
			throw new Error(
				`List names are missing: group=${Boolean(group)}, file=${Boolean(fileButton)}`,
			);
		}
		const groupName = visualName(group);
		const fileName = visualName(fileButton);
		expect(groupName.textContent?.split("…")).toHaveLength(2);
		expect(groupName.textContent).toBe("foo.bar/ve…ongfolder");
		expect(fileName.textContent?.split("…")).toHaveLength(2);
		expect(fileName.textContent?.endsWith(".tsx")).toBe(true);
		expect(fileButton.getAttribute("aria-label")).toBe(filePath);
		expect(fileButton.title).toBe(filePath);
		expect(fileName.getAttribute("aria-hidden")).toBe("true");
		expect(group.getAttribute("aria-label")).toBe(groupPath);
		expect(group.title).toBe(groupPath);
		expect(groupName.getAttribute("aria-hidden")).toBe("true");
		expect(nav.className).toContain("overflow-x-hidden");
		expect(nav.className).toContain("overflow-y-auto");

		act(() => fileButton.click());
		const viewedControl = Array.from(
			nav.querySelectorAll<HTMLElement>('[role="checkbox"]'),
		).find(
			(control) => control.getAttribute("aria-label") === `Viewed ${filePath}`,
		);
		if (!viewedControl) throw new Error("Viewed control is missing");
		act(() => viewedControl.click());
		expect(selected).toEqual([filePath]);
		expect(viewed).toEqual([[[filePath], true]]);
		expect(
			fileButton.closest<HTMLElement>("[data-file-path]")?.className,
		).toContain("flex-wrap");
		expect(viewedControl.parentElement?.className).toContain("flex-wrap");

		const beforeFontLoad = fileName.textContent;
		act(() => measurement.loadFont(20));
		expect(fileName.textContent).not.toBe(beforeFontLoad);
		expect(fileName.textContent?.endsWith(".tsx")).toBe(true);

		act(() => modeButton(rendered.container, "Tree view").click());
		await act(async () => {
			await Promise.resolve();
		});
		const treeNav = changedFilesNav(rendered.container);
		const folderButton = treeNav.querySelector<HTMLButtonElement>(
			`button[aria-label="Collapse ${groupPath}"]`,
		);
		const treeFileButton = Array.from(
			treeNav.querySelectorAll<HTMLButtonElement>("button"),
		).find((button) => button.getAttribute("aria-label") === filePath);
		if (!folderButton || !treeFileButton) {
			throw new Error("Tree names are missing");
		}
		act(() => measurement.resize(400));
		expect(folderButton.title).toBe(`Collapse ${groupPath}`);
		expect(visualName(folderButton).getAttribute("aria-hidden")).toBe("true");
		expect(visualName(folderButton).textContent?.split("…")).toHaveLength(2);
		expect(visualName(folderButton).textContent).toBe("foo.bar/ve…ongfolder");
		expect(visualName(treeFileButton).textContent?.split("…")).toHaveLength(2);

		act(() => measurement.resize(10_000));
		expect(visualName(folderButton).textContent).toBe(groupPath);
		expect(visualName(treeFileButton).textContent).toBe(
			"deeply-long-component-name😀.tsx",
		);
		act(() => measurement.resize(60));
		expect(visualName(treeFileButton).textContent).toContain("…");
		expect(treeFileButton.title).toBe(filePath);
		const narrowViewedControl = Array.from(
			treeNav.querySelectorAll<HTMLElement>('[role="checkbox"]'),
		).find(
			(control) => control.getAttribute("aria-label") === `Viewed ${filePath}`,
		);
		if (!narrowViewedControl)
			throw new Error("Narrow Viewed control is missing");
		expect(narrowViewedControl.parentElement?.className).toContain("flex-wrap");
		expect(
			treeFileButton
				.closest<HTMLElement>("[data-file-path]")
				?.querySelector(".text-success"),
		).not.toBeNull();
	} finally {
		measurement.restore();
	}
});

test("uses full names and CSS end truncation when dimensions cannot be measured", () => {
	const filePath = "src/folder-with-a-long-name/a-long-file-name.ts";
	const rendered = renderInteractive({ files: [parsedFile(filePath)] });
	const fileButton = rendered.container.querySelector<HTMLButtonElement>(
		`button[aria-label="${filePath}"]`,
	);
	if (!fileButton) throw new Error("File name is missing");
	const name = visualName(fileButton);
	expect(name.textContent).toBe("a-long-file-name.ts");
	expect(name.className).toContain("truncate");
	expect(fileButton.title).toBe(filePath);
});

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

test("compacts maximal directory chains and preserves files and path identity", () => {
	const paths = [
		"solo/a/b/first.ts",
		"solo/a/b/second.ts",
		"mixed/a/direct.ts",
		"mixed/a/b/deep.ts",
		"branch/left/file.ts",
		"branch/right/file.ts",
		"src/a.ts",
		"src",
	];
	const renamedFile = parsedFile("renamed/new.ts", {
		oldPath: "old/old.ts",
	});
	const files = [...paths.map((path) => parsedFile(path)), renamedFile];
	const expectedPaths = [...paths, "renamed/new.ts"];
	const selected: string[] = [];

	const identity = entry("identity/file.ts");
	const identityFile = directory(buildChangedFileTree([identity]), "identity")
		.children[0];
	expect(identityFile?.kind).toBe("file");
	if (identityFile?.kind === "file") {
		expect(identityFile.entry).toBe(identity);
	}

	const rendered = renderInteractive({
		files,
		onSelectFile: (path) => selected.push(path),
	});
	act(() => modeButton(rendered.container, "Tree view").click());

	const nav = changedFilesNav(rendered.container);
	const folderRows = Array.from(
		nav.querySelectorAll<HTMLElement>("[data-folder-row]"),
	);
	expect(folderRows.map((row) => row.getAttribute("data-folder-row"))).toEqual([
		"solo/a/b",
		"mixed/a",
		"mixed/a/b",
		"branch",
		"branch/left",
		"branch/right",
		"src",
		"renamed",
	]);
	for (const row of folderRows) {
		const path = row.getAttribute("data-folder-row");
		if (!path) throw new Error("Directory path is missing");
		const disclosures = row.querySelectorAll<HTMLButtonElement>(
			"button[aria-controls]",
		);
		expect(disclosures).toHaveLength(1);
		expect(disclosures[0]?.getAttribute("aria-label")).toBe(`Collapse ${path}`);
		expect(disclosures[0]?.title).toBe(`Collapse ${path}`);
	}

	const compactDisclosure = nav.querySelector<HTMLButtonElement>(
		'button[aria-label="Collapse solo/a/b"]',
	);
	if (!compactDisclosure) throw new Error("Compact directory is missing");
	expect(compactDisclosure.title).toBe("Collapse solo/a/b");
	expect(nav.querySelector('[data-folder-row="solo"]')).toBeNull();
	expect(nav.querySelector('[data-folder-row="solo/a"]')).toBeNull();
	expect(
		nav.querySelectorAll('[data-folder-row="src"], [data-file-path="src"]'),
	).toHaveLength(2);
	expect(nav.querySelectorAll("[data-file-path]")).toHaveLength(
		expectedPaths.length,
	);

	const renderedPaths = Array.from(
		nav.querySelectorAll<HTMLElement>("[data-file-path]"),
		(row) => row.getAttribute("data-file-path"),
	);
	expect(renderedPaths).toEqual(expectedPaths);
	expect(nav.querySelector('button[aria-label="old/old.ts"]')).toBeNull();
	for (const path of expectedPaths) {
		const button = nav.querySelector<HTMLButtonElement>(
			`button[aria-label="${path}"]`,
		);
		if (!button) throw new Error(`Missing file ${path}`);
		act(() => button.click());
	}
	expect(selected).toEqual(expectedPaths);
});

test("indents displayed tree levels by half a rem and caps at two rem", () => {
	const rendered = renderInteractive({
		files: [
			parsedFile("src/root.ts"),
			parsedFile("src/a/first.ts"),
			parsedFile("src/a/b/second.ts"),
			parsedFile("src/a/b/c/d/deep.ts"),
		],
	});
	act(() => modeButton(rendered.container, "Tree view").click());

	const nav = changedFilesNav(rendered.container);
	for (const [path, indent] of [
		["src", "0.5rem"],
		["src/a", "1rem"],
		["src/a/b", "1.5rem"],
		["src/a/b/c/d", "2rem"],
	] as const) {
		const row = nav.querySelector<HTMLElement>(`[data-folder-row="${path}"]`);
		if (!row) throw new Error(`Missing directory ${path}`);
		expect(row.style.paddingInlineStart).toBe(indent);
	}
	for (const [path, indent] of [
		["src/root.ts", "1rem"],
		["src/a/first.ts", "1.5rem"],
		["src/a/b/second.ts", "2rem"],
		["src/a/b/c/d/deep.ts", "2rem"],
	] as const) {
		const row = nav.querySelector<HTMLElement>(`[data-file-path="${path}"]`);
		if (!row) throw new Error(`Missing file row ${path}`);
		expect(row.style.paddingInlineStart).toBe(indent);
	}
});

test("handles empty paths and empty lists in both display modes", () => {
	const rendered = renderInteractive({ files: [] });
	const nav = changedFilesNav(rendered.container);
	expect(
		nav.querySelectorAll("[data-folder-row], [data-file-path]"),
	).toHaveLength(0);

	act(() => modeButton(rendered.container, "Tree view").click());
	expect(
		nav.querySelectorAll("[data-folder-row], [data-file-path]"),
	).toHaveLength(0);

	rendered.rerender({ files: [parsedFile("")] });
	expect(
		nav.querySelectorAll("[data-folder-row], [data-file-path]"),
	).toHaveLength(0);
	act(() => modeButton(rendered.container, "List view").click());
	expect(
		nav.querySelectorAll("[data-folder-row], [data-file-path]"),
	).toHaveLength(0);
});

test("groups the default list by complete parent path at first encounter", () => {
	const files = [
		parsedFile("src/a.ts"),
		parsedFile("README.md"),
		parsedFile("src/b.ts"),
		parsedFile("lib/a.ts"),
		parsedFile("src/nested/c.ts"),
	];
	const rendered = renderInteractive({
		files,
		viewedFiles: ["README.md"],
		selectedPath: "src/a.ts",
	});
	const nav = changedFilesNav(rendered.container);
	const listItems = Array.from(
		nav.querySelectorAll<HTMLElement>("[data-list-group], [data-file-path]"),
	);
	expect(
		listItems.map(
			(item) =>
				item.getAttribute("data-list-group") ??
				item.getAttribute("data-file-path"),
		),
	).toEqual([
		"src",
		"src/a.ts",
		"src/b.ts",
		"README.md",
		"lib",
		"lib/a.ts",
		"src/nested",
		"src/nested/c.ts",
	]);

	const srcHeading = nav.querySelector<HTMLElement>('[data-list-group="src"]');
	const nestedHeading = nav.querySelector<HTMLElement>(
		'[data-list-group="src/nested"]',
	);
	const srcRow = nav.querySelector<HTMLElement>('[data-file-path="src/a.ts"]');
	const readmeRow = nav.querySelector<HTMLElement>(
		'[data-file-path="README.md"]',
	);
	const libRow = nav.querySelector<HTMLElement>('[data-file-path="lib/a.ts"]');
	if (!srcHeading || !nestedHeading || !srcRow || !readmeRow || !libRow) {
		throw new Error("Grouped list items are missing");
	}
	expect(srcHeading.tagName).toBe("H2");
	expect(srcHeading.getAttribute("aria-label")).toBe("src");
	expect(srcHeading.title).toBe("src");
	expect(nestedHeading.title).toBe("src/nested");
	expect(srcHeading.style.paddingInlineStart).toBe("0.5rem");
	expect(srcRow.style.paddingInlineStart).toBe("1rem");
	expect(readmeRow.style.paddingInlineStart).toBe("0.5rem");
	expect(libRow.style.paddingInlineStart).toBe("1rem");
	expect(
		nav.querySelector<HTMLButtonElement>('button[aria-label="src/a.ts"]')
			?.textContent,
	).toBe("a.ts");
	expect(
		nav.querySelector<HTMLButtonElement>('button[aria-label="lib/a.ts"]')
			?.textContent,
	).toBe("a.ts");
	expect(nav.querySelector('[data-list-group="README.md"]')).toBeNull();
	expect(srcRow.getAttribute("data-state")).toBe("selected");
	expect(readmeRow.querySelector(".text-success")?.textContent).toBe("+2");
	expect(readmeRow.querySelector(".text-destructive")?.textContent).toBe("−1");
	expect(
		nav
			.querySelector<HTMLElement>(
				'[role="checkbox"][aria-label="Viewed README.md"]',
			)
			?.getAttribute("aria-checked"),
	).toBe("true");
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
	expect(nestedRow.style.paddingInlineStart).toBe("1rem");
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
	expect(nestedLeafRow.style.paddingInlineStart).toBe("1.5rem");
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

test("omits directory totals and Viewed controls but keeps per-file stats and Viewed", () => {
	const viewed: Array<[readonly string[], boolean]> = [];
	const rendered = renderInteractive({
		files: [
			parsedFile("src/a.ts", { insertions: 2, deletions: 1 }),
			parsedFile("src/nested/b.ts", { insertions: 3, deletions: 4 }),
			parsedFile("lib/c.ts", { insertions: 7, deletions: 2 }),
		],
		onViewedChange: (paths, isViewed) => viewed.push([paths, isViewed]),
	});
	act(() => modeButton(rendered.container, "Tree view").click());

	const nav = changedFilesNav(rendered.container);
	const directoryRows = nav.querySelectorAll<HTMLElement>("[data-folder-row]");
	expect(directoryRows).not.toHaveLength(0);
	for (const row of directoryRows) {
		expect(row.querySelector(".text-success")).toBeNull();
		expect(row.querySelector(".text-destructive")).toBeNull();
		expect(row.querySelector('[role="checkbox"]')).toBeNull();
	}

	const path = "src/nested/b.ts";
	const fileButton = nav.querySelector<HTMLButtonElement>(
		`button[aria-label="${path}"]`,
	);
	const fileViewed = nav.querySelector<HTMLElement>(
		`[role="checkbox"][aria-label="Viewed ${path}"]`,
	);
	if (!fileButton || !fileViewed) {
		throw new Error("Tree file controls are missing");
	}
	const fileRow = fileButton.closest<HTMLElement>("[data-file-path]");
	if (!fileRow) throw new Error("Tree file row is missing");
	expect(fileRow.querySelector(".text-success")?.textContent).toBe("+3");
	expect(fileRow.querySelector(".text-destructive")?.textContent).toBe("−4");

	act(() => fileViewed.click());
	expect(viewed).toEqual([[[path], true]]);
});

test("collapses folders independently and retains the state across mode switches", () => {
	const rendered = renderInteractive({
		files: [parsedFile("src/a/b/a.ts"), parsedFile("lib/c/d/b.ts")],
	});
	act(() => modeButton(rendered.container, "Tree view").click());

	const src = () =>
		rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Collapse src/a/b"], button[aria-label="Expand src/a/b"]',
		);
	const lib = () =>
		rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Collapse lib/c/d"], button[aria-label="Expand lib/c/d"]',
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
		files: [parsedFile("docs/My Notes/More Notes/file.ts")],
	});
	act(() => modeButton(rendered.container, "Tree view").click());

	const trigger = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Collapse docs/My Notes/More Notes"]',
	);
	if (!trigger) throw new Error("Nested folder is missing");
	const controlsId = trigger.getAttribute("aria-controls");
	if (!controlsId) throw new Error("Folder controls ID is missing");
	expect(controlsId).not.toMatch(/\s/);
	expect(
		rendered.container.querySelector(`[id="${controlsId}"]`),
	).not.toBeNull();
	expect(trigger.getAttribute("aria-label")).toBe(
		"Collapse docs/My Notes/More Notes",
	);
	expect(trigger.title).toBe("Collapse docs/My Notes/More Notes");
	act(() => trigger.click());
	expect(
		rendered.container.querySelector(`[id="${controlsId}"]`),
	).not.toBeNull();
});

test("reveals a selected descendant before nearest-row scrolling", async () => {
	const scrolls: Array<{ path: string; block?: ScrollLogicalPosition }> = [];
	const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
	HTMLElement.prototype.scrollIntoView = function (options) {
		scrolls.push({
			path: this.getAttribute("data-file-path") ?? "",
			block: typeof options === "object" ? options?.block : undefined,
		});
	};
	try {
		const selectedPath = "src/a/b/file.ts";
		const rendered = renderInteractive({
			files: [parsedFile(selectedPath)],
		});
		act(() => modeButton(rendered.container, "Tree view").click());
		const collapse = rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Collapse src/a/b"]',
		);
		if (!collapse) throw new Error("Compressed source folder is missing");
		act(() => collapse.click());
		scrolls.length = 0;

		rendered.rerender({ selectedPath });
		await act(async () => {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		});
		expect(scrolls).toEqual([]);
		await act(async () => {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		});
		expect(
			rendered.container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Collapse src/a/b"]',
				)
				?.getAttribute("aria-expanded"),
		).toBe("true");
		expect(scrolls).toEqual([{ path: selectedPath, block: "nearest" }]);
	} finally {
		HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
	}
});

test("keeps pending scroll after folder toggle and transition cancellation", async () => {
	const selectedPath = "src/a/b/file.ts";
	const scrolls: Array<{ path: string; block?: ScrollLogicalPosition }> = [];
	const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
	const originalGetAnimations = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"getAnimations",
	);
	HTMLElement.prototype.scrollIntoView = function (options) {
		scrolls.push({
			path: this.getAttribute("data-file-path") ?? "",
			block: typeof options === "object" ? options?.block : undefined,
		});
	};
	Object.defineProperty(HTMLElement.prototype, "getAnimations", {
		configurable: true,
		value: function (this: HTMLElement) {
			if (
				this.getAttribute("data-slot") === "collapsible-content" &&
				!this.hasAttribute("hidden")
			) {
				return [{ playState: "running" } as Animation];
			}
			return originalGetAnimations?.value?.call(this) ?? [];
		},
	});
	try {
		const rendered = renderInteractive({
			files: [parsedFile(selectedPath), parsedFile("lib/other.ts")],
		});
		act(() => modeButton(rendered.container, "Tree view").click());
		const collapse = rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Collapse src/a/b"]',
		);
		if (!collapse) throw new Error("Compressed source folder is missing");
		act(() => collapse.click());
		scrolls.length = 0;

		rendered.rerender({ selectedPath });
		await act(async () => {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		});
		await act(async () => {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		});
		expect(
			rendered.container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Collapse src/a/b"]',
				)
				?.getAttribute("aria-expanded"),
		).toBe("true");
		expect(scrolls).toEqual([]);

		const unrelatedFolder = rendered.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Collapse lib"]',
		);
		if (!unrelatedFolder) throw new Error("Unrelated folder is missing");
		act(() => unrelatedFolder.click());
		await act(async () => {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		});
		await act(async () => {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		});
		const selectedRow = rendered.container.querySelector<HTMLElement>(
			`[data-file-path="${selectedPath}"]`,
		);
		if (!selectedRow) throw new Error("Selected file row is missing");
		let ancestor = selectedRow.parentElement;
		while (ancestor !== null) {
			if (ancestor.getAttribute("data-slot") === "collapsible-content") {
				act(() => {
					ancestor?.dispatchEvent(
						new window.Event("transitioncancel", { bubbles: true }),
					);
				});
			}
			ancestor = ancestor.parentElement;
		}
		expect(scrolls).toEqual([{ path: selectedPath, block: "nearest" }]);
	} finally {
		HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
		if (originalGetAnimations) {
			Object.defineProperty(
				HTMLElement.prototype,
				"getAnimations",
				originalGetAnimations,
			);
		} else {
			Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
		}
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
test("keeps duplicate basenames and renamed paths distinct in list callbacks", () => {
	const paths = [
		"src/shared.ts",
		"lib/shared.ts",
		"renamed/new.ts",
		"legacy/old.ts",
	];
	const selected: string[] = [];
	const viewed: Array<[readonly string[], boolean]> = [];
	const rendered = renderInteractive({
		files: [
			parsedFile("src/shared.ts"),
			parsedFile("lib/shared.ts"),
			parsedFile("renamed/new.ts", { oldPath: "original/new.ts" }),
			parsedFile("legacy/old.ts", {
				oldPath: "legacy/old.ts",
				newPath: null,
			}),
		],
		viewedFiles: ["src/shared.ts", "legacy/old.ts"],
		selectedPath: "lib/shared.ts",
		onSelectFile: (path) => selected.push(path),
		onViewedChange: (changedPaths, isViewed) =>
			viewed.push([changedPaths, isViewed]),
	});
	const nav = changedFilesNav(rendered.container);
	const fileButton = (root: HTMLElement, path: string): HTMLButtonElement => {
		const button = root.querySelector<HTMLButtonElement>(
			`button[aria-label="${path}"]`,
		);
		if (!button) throw new Error(`Missing file row for ${path}`);
		return button;
	};
	const viewedControl = (root: HTMLElement, path: string): HTMLElement => {
		const checkbox = root.querySelector<HTMLElement>(
			`[role="checkbox"][aria-label="Viewed ${path}"]`,
		);
		if (!checkbox) throw new Error(`Missing Viewed control for ${path}`);
		return checkbox;
	};

	for (const path of paths) {
		const button = fileButton(nav, path);
		expect(button.getAttribute("aria-label")).toBe(path);
		expect(button.title).toBe(path);
		expect(
			button
				.closest<HTMLElement>("[data-file-path]")
				?.getAttribute("data-file-path"),
		).toBe(path);
		act(() => button.click());
		act(() => viewedControl(nav, path).click());
	}
	expect(selected).toEqual(paths);
	expect(viewed).toEqual([
		[["src/shared.ts"], false],
		[["lib/shared.ts"], true],
		[["renamed/new.ts"], true],
		[["legacy/old.ts"], false],
	]);

	act(() => modeButton(rendered.container, "Tree view").click());
	const treeNav = changedFilesNav(rendered.container);
	for (const path of paths) {
		const button = fileButton(treeNav, path);
		expect(button.title).toBe(path);
		expect(
			button
				.closest<HTMLElement>("[data-file-path]")
				?.getAttribute("data-file-path"),
		).toBe(path);
	}
	expect(
		fileButton(treeNav, "lib/shared.ts")
			.closest<HTMLElement>("[data-file-path]")
			?.getAttribute("data-state"),
	).toBe("selected");
	expect(
		viewedControl(treeNav, "src/shared.ts").getAttribute("aria-checked"),
	).toBe("true");
	expect(
		viewedControl(treeNav, "legacy/old.ts").getAttribute("aria-checked"),
	).toBe("true");
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
	if (!folderButton || !fileButton || !fileViewed) {
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
	expect(selected).toEqual([path]);
	expect(viewed).toEqual([[[path], true]]);
});
