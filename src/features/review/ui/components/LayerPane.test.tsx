import { afterEach, expect, test } from "bun:test";
import { marked } from "marked";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { ParsedFileDiff } from "../../../../shared/diff-parse";
import type { ReviewState } from "../../state";
import { ChangedFiles } from "./ChangedFiles";
import {
	collapseLayerOnDoneTransition,
	completedLayerCount,
	LayerPane,
	layersActionState,
	layersStatusMessage,
	shortFilePath,
	toggleLayerCollapsed,
} from "./LayerPane";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.replaceChildren();
});

test("keeps a unique file basename in the shortened label", () => {
	expect(
		shortFilePath("src/modules/studio/services/resolver.service.ts", [
			"src/modules/studio/services/resolver.service.ts",
			"web/index.ts",
		]),
	).toBe("resolver.service.ts");
});

test("extends the label with parent directories until it is unique", () => {
	const paths = ["src/routes/route.ts", "web/route.ts"];
	expect(shortFilePath("src/routes/route.ts", paths)).toBe("routes/route.ts");
	expect(shortFilePath("web/route.ts", paths)).toBe("web/route.ts");
});

test("falls back to the full path for a top-level file", () => {
	expect(shortFilePath("README.md", ["README.md", "src/app.ts"])).toBe(
		"README.md",
	);
});

function reviewState(overrides: Partial<ReviewState> = {}): ReviewState {
	return {
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Add feature",
			description: "",
			sourceBranch: "feature",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "start", headSha: "head" },
			syncedAt: "2026-09-09T12:00:00.000Z",
		},
		worktreePath: "/tmp/review-worktree",
		repoRoot: "/repo",
		layerStatus: "ready",
		layerError: null,
		layers: [
			{
				id: "layer-1",
				title: "Diff",
				tldr: "One paragraph.",
				files: ["src/routes/route.ts", "web/route.ts"],
				done: false,
				stale: false,
			},
		],
		viewedFiles: [],
		chatSessionId: null,
		chats: [],
		activeChatId: null,
		drafts: [],
		...overrides,
	};
}

function firstLayer(): ReviewState["layers"][number] {
	const layer = reviewState().layers[0];
	if (!layer) throw new Error("Expected a layer template");
	return layer;
}

function renderLayerPane(
	props: Partial<Parameters<typeof LayerPane>[0]> = {},
): string {
	return renderToStaticMarkup(
		<LayerPane
			state={reviewState()}
			files={["src/routes/route.ts", "web/route.ts"]}
			filesContent={null}
			selectedPath={null}
			onSelectFile={() => {}}
			onSelectLayer={() => {}}
			onToggleDone={() => {}}
			layerAction={null}
			externallyDisabled={false}
			actionError={null}
			onRegenerate={() => {}}
			onRetry={() => {}}
			{...props}
		/>,
	);
}
test("renders one shared importance progress bar directly below the tab list", () => {
	const container = parseMarkup(
		renderLayerPane({
			importanceProgress: { value: 4, total: 18, threshold: 13 },
		}),
	);
	const tabList = container.querySelector('[role="tablist"]');
	const progress = container.querySelector(
		'[aria-label="Importance review progress"]',
	);
	const tooltipTrigger = container.querySelector(
		'[data-slot="tooltip-trigger"]',
	);

	expect(
		container.querySelectorAll('[aria-label="Importance review progress"]'),
	).toHaveLength(1);
	expect(tabList?.parentElement?.lastElementChild).toBe(tooltipTrigger);
	expect(progress?.closest("header")).toBeNull();
	expect(progress?.getAttribute("aria-valuenow")).toBe("4");
	expect(progress?.getAttribute("aria-valuemax")).toBe("18");
	expect(container.innerHTML).not.toContain('title="Target:');
	expect(container.innerHTML).not.toContain(">Importance</span>");
});

test("omits importance progress when no progress is provided", () => {
	expect(renderLayerPane()).not.toContain("Importance review progress");
});

test("explains importance progress in an accessible tooltip", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<LayerPane
				state={reviewState()}
				files={[]}
				filesContent={null}
				selectedPath={null}
				onSelectFile={() => {}}
				onSelectLayer={() => {}}
				onToggleDone={() => {}}
				layerAction={null}
				actionError={null}
				externallyDisabled={false}
				onRegenerate={() => {}}
				onRetry={() => {}}
				importanceProgress={{ value: 4, total: 18, threshold: 13 }}
			/>,
		),
	);
	const trigger = container.querySelector<HTMLElement>(
		'[data-slot="tooltip-trigger"]',
	);
	if (!trigger) throw new Error("Missing importance tooltip trigger");

	await act(async () => {
		document.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
		);
		trigger.focus();
		await Bun.sleep(0);
	});

	const tooltip = document.body.querySelector('[data-slot="tooltip-content"]');
	expect(trigger.tabIndex).toBe(0);
	expect(tooltip).not.toBeNull();
	expect(tooltip?.textContent).toContain("Fixed contributions: level 1 1/18");
	expect(tooltip?.textContent).toContain("5 8/18");
	expect(tooltip?.textContent).toContain(
		"Fixed target: 13/18 for High+Critical review",
	);
	expect(tooltip?.textContent).toContain("not a completeness guarantee");
});

function parseMarkup(markup: string): HTMLDivElement {
	const container = document.createElement("div");
	container.innerHTML = markup;
	return container;
}
function tabButton(container: HTMLElement, label: string): HTMLButtonElement {
	const tab = [
		...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
	].find((candidate) =>
		candidate.getAttribute("aria-label")?.startsWith(`${label},`),
	);
	if (!tab) throw new Error(`Missing ${label} tab`);
	return tab;
}

function tabPanel(container: HTMLElement, tab: HTMLButtonElement): HTMLElement {
	const index = tab.getAttribute("aria-label")?.startsWith("Layers,") ? 0 : 1;
	const panel =
		container.querySelectorAll<HTMLElement>('[role="tabpanel"]')[index];
	if (!panel)
		throw new Error(`Missing panel for ${tab.getAttribute("aria-label")}`);
	return panel;
}

test("keeps Layers and Files tabs available in empty and failed layer states", () => {
	for (const state of [
		reviewState({ layers: [] }),
		reviewState({
			layerStatus: "failed",
			layerError: "Layer request failed",
			layers: [],
		}),
	]) {
		const pane = parseMarkup(renderLayerPane({ state }));
		const tabs = [...pane.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
		const layersTab = tabButton(pane, "Layers");
		const filesTab = tabButton(pane, "Files");
		const layersPanel = tabPanel(pane, layersTab);
		const filesPanel = tabPanel(pane, filesTab);

		expect(
			tabs.map((tab) => tab.getAttribute("aria-label")?.split(",")[0]),
		).toEqual(["Layers", "Files"]);
		expect(layersTab.getAttribute("aria-selected")).toBe("true");
		expect(filesTab.getAttribute("aria-selected")).toBe("false");
		expect(pane.querySelector("h2")).toBeNull();
		expect(filesPanel.hasAttribute("inert")).toBe(true);
		expect(layersPanel.textContent).toContain(
			state.layerStatus === "failed"
				? "Layer generation failed"
				: "No review layers.",
		);
		if (state.layerStatus === "failed") {
			expect(
				layersPanel.querySelector('[role="alert"]')?.textContent,
			).toContain("Layer request failed");
		}
	}
});

test("shows non-stale layer and unique current-file progress in tabs", () => {
	const layerTemplate = reviewState().layers.at(0);
	if (!layerTemplate) throw new Error("Expected a layer template");

	const pane = parseMarkup(
		renderLayerPane({
			files: ["src/current.ts", "src/current.ts", "", "src/other.ts"],
			state: reviewState({
				layers: [
					{ ...layerTemplate, id: "completed", done: true, stale: false },
					{ ...layerTemplate, id: "stale", done: true, stale: true },
					{ ...layerTemplate, id: "pending", done: false, stale: false },
				],
				viewedFiles: ["src/current.ts", "src/current.ts", "obsolete.ts", ""],
			}),
		}),
	);
	const layersTab = tabButton(pane, "Layers");
	const filesTab = tabButton(pane, "Files");

	expect(layersTab.getAttribute("aria-label")).toBe(
		"Layers, 1 of 3 layers complete",
	);
	expect(
		layersTab.querySelector(".review-sidebar-tab-progress")?.textContent,
	).toBe("1/3");
	expect(filesTab.getAttribute("aria-label")).toBe(
		"Files, 1 of 2 current diff files viewed",
	);
	expect(
		filesTab.querySelector(".review-sidebar-tab-progress")?.textContent,
	).toBe("1/2");
});

test("shows and exposes zero current-file progress", () => {
	const pane = parseMarkup(
		renderLayerPane({
			files: [""],
			state: reviewState({ viewedFiles: ["obsolete.ts", ""] }),
		}),
	);
	const filesTab = tabButton(pane, "Files");

	expect(filesTab.getAttribute("aria-label")).toBe(
		"Files, 0 of 0 current diff files viewed",
	);
	expect(
		filesTab.querySelector(".review-sidebar-tab-progress")?.textContent,
	).toBe("0/0");
});

test("keeps file and layer state across accessible sidebar tab switches", () => {
	const diffFiles: ParsedFileDiff[] = [
		{
			oldPath: "src/routes/route.ts",
			newPath: "src/routes/route.ts",
			status: "modified",
			binary: false,
			insertions: 2,
			deletions: 1,
			hunks: [],
		},
		{
			oldPath: "web/route.ts",
			newPath: "web/route.ts",
			status: "modified",
			binary: false,
			insertions: 2,
			deletions: 1,
			hunks: [],
		},
	];
	const filePaths = ["src/routes/route.ts", "web/route.ts"];
	const fileSelections: string[] = [];
	const viewedChanges: Array<[readonly string[], boolean]> = [];
	let selectedPath: string | null = filePaths[0] ?? null;
	let viewedFiles: string[] = [];
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const onSelectFile = (path: string) => {
		fileSelections.push(path);
		selectedPath = path;
	};
	const onViewedChange = (paths: readonly string[], viewed: boolean) => {
		viewedChanges.push([paths, viewed]);
		viewedFiles = viewed
			? [...new Set([...viewedFiles, ...paths])]
			: viewedFiles.filter((path) => !paths.includes(path));
	};
	const render = () =>
		root.render(
			<LayerPane
				state={reviewState()}
				files={filePaths}
				filesContent={
					<ChangedFiles
						files={diffFiles}
						viewedFiles={viewedFiles}
						selectedPath={selectedPath}
						onSelectFile={onSelectFile}
						onViewedChange={onViewedChange}
					/>
				}
				selectedPath={selectedPath}
				onSelectFile={onSelectFile}
				onSelectLayer={() => {}}
				onToggleDone={() => {}}
				layerAction={null}
				actionError={null}
				externallyDisabled={false}
				onRegenerate={() => {}}
				onRetry={() => {}}
			/>,
		);

	act(render);
	const layersTab = tabButton(container, "Layers");
	const filesTab = tabButton(container, "Files");
	const layersPanel = tabPanel(container, layersTab);
	const filesPanel = tabPanel(container, filesTab);
	expect(layersTab.getAttribute("aria-selected")).toBe("true");
	expect(filesPanel.hasAttribute("hidden")).toBe(true);
	expect(filesPanel.hasAttribute("inert")).toBe(true);
	expect(
		container.querySelectorAll('[data-region="changed-files"]'),
	).toHaveLength(1);
	const changedFilesRegion = container.querySelector(
		'[data-region="changed-files"]',
	);
	expect(changedFilesRegion?.closest('[role="tabpanel"]')).toBe(filesPanel);

	act(() => {
		filesTab.focus();
		filesTab.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: " ",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	expect(filesTab.getAttribute("aria-selected")).toBe("true");
	expect(layersPanel.hasAttribute("inert")).toBe(true);
	expect(filesPanel.hasAttribute("inert")).toBe(false);

	const nav = container.querySelector<HTMLElement>(
		'nav[aria-label="Changed files"]',
	);
	if (!nav) throw new Error("Changed files navigation is missing");
	act(() =>
		container
			.querySelector<HTMLButtonElement>('button[aria-label="Tree view"]')
			?.click(),
	);
	act(() =>
		nav
			.querySelector<HTMLButtonElement>(
				'button[aria-label="src/routes/route.ts"]',
			)
			?.click(),
	);
	act(render);
	act(() =>
		nav
			.querySelector<HTMLElement>(
				'[role="checkbox"][aria-label="Viewed src/routes/route.ts"]',
			)
			?.click(),
	);
	act(render);
	expect(fileSelections).toEqual(["src/routes/route.ts"]);
	expect(viewedChanges).toEqual([[["src/routes/route.ts"], true]]);

	const srcRoutesFolder = nav.querySelector<HTMLButtonElement>(
		'button[aria-label="Collapse src/routes"]',
	);
	if (!srcRoutesFolder) throw new Error("src/routes folder is missing");
	act(() => srcRoutesFolder.click());
	expect(
		nav
			.querySelector('button[aria-label="Expand src/routes"]')
			?.getAttribute("aria-expanded"),
	).toBe("false");

	act(() => layersTab.click());
	const layerFileChip = layersPanel.querySelector<HTMLButtonElement>(
		'button[aria-label="web/route.ts"]',
	);
	if (!layerFileChip) throw new Error("Layer file chip is missing");
	act(() => layerFileChip.click());
	act(render);
	expect(fileSelections).toEqual(["src/routes/route.ts", "web/route.ts"]);
	expect(
		layersPanel
			.querySelector('button[aria-label="web/route.ts"]')
			?.getAttribute("aria-current"),
	).toBe("true");

	act(() =>
		layersPanel
			.querySelector<HTMLButtonElement>('button[aria-label="Collapse Diff"]')
			?.click(),
	);
	expect(
		layersPanel
			.querySelector('button[aria-label="Expand Diff"]')
			?.getAttribute("aria-expanded"),
	).toBe("false");
	act(() => filesTab.click());
	expect(
		container
			.querySelector<HTMLButtonElement>('button[aria-label="Tree view"]')
			?.getAttribute("aria-pressed"),
	).toBe("true");
	expect(
		nav
			.querySelector('button[aria-label="Expand src/routes"]')
			?.getAttribute("aria-expanded"),
	).toBe("false");
	expect(
		nav
			.querySelector('button[aria-label="web/route.ts"]')
			?.closest("[data-file-path]")
			?.getAttribute("data-state"),
	).toBe("selected");

	act(() => layersTab.click());
	expect(
		layersPanel
			.querySelector('button[aria-label="Expand Diff"]')
			?.getAttribute("aria-expanded"),
	).toBe("false");
});

function layerCardMarkup(markup: string, layerId: string): string {
	const detailsIndex = markup.indexOf(`id="layer-details-${layerId}"`);
	expect(detailsIndex).toBeGreaterThanOrEqual(0);
	const start = markup.lastIndexOf("<li ", detailsIndex);
	const end = markup.indexOf("</li>", detailsIndex);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return markup.slice(start, end + "</li>".length);
}

test("renders layer descriptions as safe compact Markdown with preserved breaks", () => {
	const description = [
		"## Summary",
		"First line",
		"second line",
		"",
		"A second paragraph.",
		"",
		"- an item with `inlineCode`",

		"```ts",
		"const value = 1;",
		"```",
		"",
		'<span onclick="alert(1)" style="color:red">safe text</span>',
		'[unsafe](javascript:alert("x"))',
		`long-token-${"x".repeat(240)}`,
	].join("\n");
	const state = reviewState({
		layers: [{ ...firstLayer(), tldr: description }],
	});
	const pane = parseMarkup(renderLayerPane({ state }));
	const markdown = pane.querySelector<HTMLElement>(".layer-markdown");

	expect(markdown?.querySelector("h2")?.textContent).toBe("Summary");
	expect(markdown?.querySelectorAll("p").length).toBeGreaterThanOrEqual(2);
	expect(markdown?.querySelector("br")).not.toBeNull();
	expect(markdown?.querySelector("li")?.textContent).toContain("inlineCode");
	expect(markdown?.querySelector("li code")?.textContent).toBe("inlineCode");
	expect(markdown?.querySelector("pre code")?.textContent).toContain(
		"const value = 1;",
	);
	expect(markdown?.textContent).toContain("safe text");
	expect(markdown?.querySelector("[onclick], [style]")).toBeNull();
	expect(markdown?.querySelector("a[href^='javascript:']")).toBeNull();
	expect(markdown?.innerHTML).not.toContain("<script");
	expect(markdown?.textContent).toContain(`long-token-${"x".repeat(240)}`);
});

test("renders legacy plain layer descriptions as text", () => {
	const state = reviewState({
		layers: [{ ...firstLayer(), tldr: "Plain line\nsecond line" }],
	});
	const markdown = parseMarkup(renderLayerPane({ state })).querySelector(
		".layer-markdown",
	);

	expect(markdown?.querySelector("p")?.innerHTML).toBe(
		"Plain line<br>second line",
	);
});

test("falls back to literal layer text when Markdown rendering throws", () => {
	const state = reviewState({
		layers: [{ ...firstLayer(), tldr: "line <tag>\nsecond line" }],
	});
	const originalParse = marked.parse;
	let pane: HTMLDivElement | null = null;
	try {
		marked.parse = (() => {
			throw new Error("renderer unavailable");
		}) as typeof marked.parse;
		pane = parseMarkup(renderLayerPane({ state }));
	} finally {
		marked.parse = originalParse;
	}
	const markdown = pane?.querySelector<HTMLElement>(".layer-markdown");

	expect(markdown?.textContent).toBe("line <tag>\nsecond line");
	expect(markdown?.querySelector("p, tag")).toBeNull();
	expect(markdown?.classList.contains("layer-markdown-plain")).toBe(true);
});

test("places layer actions beside each status", () => {
	const scenarios = [
		{
			status: "pending",
			message: "Preparing layers…",
			action: "Regenerate layers",
		},
		{
			status: "running",
			message: "Generating layers…",
			action: "Regenerate layers",
		},
		{
			status: "failed",
			message: "Layer generation failed",
			action: "Retry layer generation",
		},
	] as const;

	for (const scenario of scenarios) {
		const pane = parseMarkup(
			renderLayerPane({
				state: reviewState({
					layerStatus: scenario.status,
					layerError: scenario.status === "failed" ? "Agent timed out" : null,
				}),
			}),
		);
		const status = [...pane.querySelectorAll("span")].find(
			(span) => span.textContent === scenario.message,
		);
		const button = pane.querySelector<HTMLButtonElement>(
			`button[aria-label="${scenario.action}"]`,
		);

		expect(status).not.toBeUndefined();
		expect(status?.parentElement?.nextElementSibling).toBe(button);
		expect(button?.querySelector("svg")).not.toBeNull();
		expect(status?.previousElementSibling?.matches("svg") ?? false).toBe(
			scenario.status === "running",
		);
		expect(button?.disabled).toBe(scenario.status === "running");
		expect(button?.getAttribute("aria-busy")).toBe(
			scenario.status === "running" ? "true" : null,
		);
		if (scenario.status === "failed") {
			expect(pane.querySelector('[role="alert"]')?.textContent).toContain(
				"Agent timed out",
			);
		}
	}
	expect(layersStatusMessage("running")).toBe("Generating layers…");
});

test("orders ready completion status, progress, fraction, and regenerate action", () => {
	const readyState = reviewState({
		layers: [
			{
				id: "completed",
				title: "Completed",
				tldr: "Done",
				files: ["src/completed.ts"],
				done: true,
				stale: false,
			},
			{
				id: "stale",
				title: "Stale",
				tldr: "Needs refresh",
				files: ["src/stale.ts"],
				done: true,
				stale: true,
			},
			{
				id: "open",
				title: "Open",
				tldr: "Not done",
				files: ["src/open.ts"],
				done: false,
				stale: false,
			},
		],
	});
	const readyMarkup = renderLayerPane({
		state: readyState,
		files: ["src/completed.ts", "src/stale.ts", "src/open.ts"],
	});
	const pane = parseMarkup(readyMarkup);
	const completedLabel = [...pane.querySelectorAll("span")].find(
		(span) => span.textContent === "Completed",
	);
	const progress = pane.querySelector(
		'[role="progressbar"][aria-label="Completed"]',
	);
	const fraction = [
		...(progress?.parentElement?.querySelectorAll("span") ?? []),
	].find((span) => span.textContent === "1/3");
	const regenerate = pane.querySelector<HTMLButtonElement>(
		'button[aria-label="Regenerate layers"]',
	);

	expect(completedLabel).not.toBeUndefined();
	expect(progress?.getAttribute("aria-valuenow")).toBe("1");
	expect(progress?.getAttribute("aria-valuemax")).toBe("3");
	expect(completedLabel?.nextElementSibling).toBe(progress);
	expect(progress?.nextElementSibling).toBe(fraction);
	expect(fraction?.nextElementSibling).toBe(regenerate);
	expect(regenerate?.querySelector("svg")).not.toBeNull();
	expect(completedLabel?.previousElementSibling).toBeNull();

	const completedCard = layerCardMarkup(readyMarkup, "completed");
	const staleCard = layerCardMarkup(readyMarkup, "stale");
	const openCard = layerCardMarkup(readyMarkup, "open");
	const staleHeader = parseMarkup(staleCard).querySelector(
		"div.flex.items-center.gap-2.p-3",
	);
	const staleChevron = staleHeader?.querySelector(
		'button[aria-controls^="layer-details-"]',
	);
	const staleTitle = staleHeader?.querySelector("button[data-active]");
	const staleBadge = staleHeader?.querySelector('[data-layer-state="stale"]');
	const staleCompletion = staleHeader?.querySelector("button[aria-pressed]");
	if (
		!staleHeader ||
		!staleChevron ||
		!staleTitle ||
		!staleBadge ||
		!staleCompletion
	) {
		throw new Error("Missing stale layer header controls");
	}
	const staleChildren = [...staleHeader.children];
	expect(staleChildren.indexOf(staleChevron)).toBeLessThan(
		staleChildren.indexOf(staleTitle),
	);
	expect(staleChildren.indexOf(staleTitle)).toBeLessThan(
		staleChildren.indexOf(staleBadge),
	);
	expect(staleChildren.indexOf(staleBadge)).toBeLessThan(
		staleChildren.indexOf(staleCompletion),
	);
	expect(staleCompletion.classList.contains("size-6")).toBe(true);
	expect(completedCard).toContain('aria-label="Mark Completed not done"');
	expect(completedCard).toContain('aria-pressed="true"');
	expect(completedCard).toContain('data-layer-state="done"');
	expect(staleCard).toContain('aria-label="Mark Stale not done"');
	expect(staleCard).toContain('data-layer-state="stale"');
	expect(staleCard).toContain(">Stale</span>");
	expect(staleCard).toContain("data-done");
	expect(staleCard).toContain("data-stale");
	expect(openCard).toContain('aria-label="Mark Open done"');
	expect(openCard).toContain('aria-pressed="false"');
	expect(openCard).toContain('data-layer-state="open"');
	expect([...pane.querySelectorAll("button[aria-pressed]")]).toHaveLength(3);
	expect(completedLayerCount(readyState.layers)).toBe(1);
});

test("covers layer action state precedence across statuses", () => {
	const pendingAction = layersActionState("pending", null);
	expect(pendingAction).toEqual({
		mode: "regenerate",
		disabled: false,
		tooltip: "Regenerate layers (resets completed)",
		label: "Regenerate layers",
	});

	const runningAction = layersActionState("running", null);
	expect(runningAction.disabled).toBe(true);
	expect(runningAction.tooltip).toBe("Generating layers…");

	const actionPending = layersActionState("ready", "regenerate");
	expect(actionPending.disabled).toBe(true);
	expect(actionPending.tooltip).toBe("Generating layers…");

	const failedAction = layersActionState("failed", null);
	expect(failedAction.mode).toBe("retry");
	expect(failedAction.tooltip).toBe("Retry layer generation");
});

test("keeps layer actions disabled with refresh and generation feedback", () => {
	const refreshAction = layersActionState("ready", null, true);
	expect(refreshAction.disabled).toBe(true);
	expect(refreshAction.tooltip).toBe("Refresh in progress…");
	const refreshPane = parseMarkup(
		renderLayerPane({ externallyDisabled: true }),
	);
	const refreshButton = refreshPane.querySelector<HTMLButtonElement>(
		'button[aria-label="Regenerate layers"]',
	);

	expect(refreshButton?.getAttribute("aria-disabled")).toBe("true");
	expect(
		refreshPane.querySelector('[data-slot="tooltip-trigger"]'),
	).not.toBeNull();
	expect(refreshPane.querySelector('[tabindex="0"]')).not.toBeNull();
	expect(refreshButton?.getAttribute("aria-busy")).toBeNull();

	const generationPane = parseMarkup(
		renderLayerPane({ layerAction: "regenerate" }),
	);
	const generationButton = generationPane.querySelector<HTMLButtonElement>(
		'button[aria-label="Regenerate layers"]',
	);
	expect(generationButton?.disabled).toBe(true);
	expect(generationButton?.getAttribute("aria-busy")).toBe("true");
	expect(generationButton?.querySelector("svg")).not.toBeNull();
});

test("regenerate and retry actions invoke their layer callbacks", () => {
	const actions: string[] = [];
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const props = {
		files: ["src/routes/route.ts", "web/route.ts"],
		filesContent: null,
		selectedPath: null,
		onSelectFile: () => {},
		onSelectLayer: () => {},
		onToggleDone: () => {},
		layerAction: null,
		actionError: null,
		externallyDisabled: false,
		onRegenerate: () => actions.push("regenerate"),
		onRetry: () => actions.push("retry"),
	};

	act(() => root.render(<LayerPane {...props} state={reviewState()} />));
	const regenerate = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Regenerate layers"]',
	);
	act(() => regenerate?.click());
	expect(actions).toEqual(["regenerate"]);

	act(() =>
		root.render(
			<LayerPane {...props} state={reviewState({ layerStatus: "failed" })} />,
		),
	);
	const retry = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Retry layer generation"]',
	);
	act(() => retry?.click());
	expect(actions).toEqual(["regenerate", "retry"]);
});

test("renders layer action errors as alerts", () => {
	const markup = renderLayerPane({
		actionError: "Unable to regenerate layers",
	});

	expect(markup).toContain('role="alert"');
	expect(markup).toContain("Unable to regenerate layers");
});

test("renders layer file chips with shortened labels and full-path accessible labels", () => {
	const markup = renderLayerPane();

	expect(markup).toContain(">routes/route.ts</button>");
	expect(markup).not.toContain('title="src/routes/route.ts"');
	expect(markup).toContain('aria-label="src/routes/route.ts"');
	expect(markup).toContain(">web/route.ts</button>");
	expect(markup).not.toContain('title="web/route.ts"');
});
test("shows score reasons and full unscored paths in layer pill component tooltips", async () => {
	const scoredPath = "src/routes/route.ts";
	const unscoredPath = "web/route.ts";
	const paths = [scoredPath, unscoredPath];
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<LayerPane
				state={reviewState({
					layers: [{ ...firstLayer(), files: paths }],
				})}
				files={paths}
				filesContent={null}
				selectedPath={null}
				onSelectFile={() => {}}
				onSelectLayer={() => {}}
				onToggleDone={() => {}}
				layerAction={null}
				actionError={null}
				externallyDisabled={false}
				onRegenerate={() => {}}
				onRetry={() => {}}
				importanceByPath={
					new Map([
						[
							scoredPath,
							{
								score: 4 as const,
								reason: "This changes how requests are authorized.",
							},
						],
					])
				}
			/>,
		),
	);
	const scoredChip = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${scoredPath}"]`,
	);
	const unscoredChip = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${unscoredPath}"]`,
	);
	if (!scoredChip || !unscoredChip) throw new Error("Missing layer file chip");
	expect(scoredChip.title).toBe("");
	expect(unscoredChip.title).toBe("");

	await act(async () => {
		document.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
		);
		scoredChip.focus();
		await Bun.sleep(0);
	});
	expect(
		document.body.querySelector('[data-slot="tooltip-content"]')?.textContent,
	).toBe("Importance 4/5 (High)This changes how requests are authorized.");

	await act(async () => {
		document.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
		);
		unscoredChip.focus();
		await Bun.sleep(0);
	});
	expect(
		Array.from(
			document.body.querySelectorAll('[data-slot="tooltip-content"]'),
		).at(-1)?.textContent,
	).toBe(unscoredPath);
});

test("styles layer file chips by Viewed state with selection taking precedence", () => {
	const selected = "src/routes/selected.ts";
	const viewed = "src/routes/viewed.ts";
	const unviewed = "src/routes/unviewed.ts";
	const paths = [selected, viewed, unviewed];
	const markup = renderLayerPane({
		state: reviewState({
			layers: [
				{
					...reviewState().layers[0],
					files: paths,
				},
			],
			viewedFiles: [selected, viewed],
		}),
		files: paths,
		selectedPath: selected,
		importanceByPath: new Map(
			paths.map(
				(path) =>
					[
						path,
						{
							score: 4,
							reason: "This file supports changed request behavior.",
						},
					] as const,
			),
		),
	});
	const container = parseMarkup(markup);
	const selectedChip = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${selected}"]`,
	);
	const viewedChip = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${viewed}"]`,
	);
	const unviewedChip = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${unviewed}"]`,
	);
	if (!selectedChip || !viewedChip || !unviewedChip) {
		throw new Error("Missing layer file chip");
	}

	for (const chip of [selectedChip, viewedChip, unviewedChip]) {
		const endCap = chip.firstElementChild;
		expect(endCap?.tagName).toBe("SPAN");
		expect(endCap?.classList).toContain("bg-importance-4");
		expect(endCap?.classList).toContain("w-4");
		expect(endCap?.getAttribute("title")).toBeNull();
		expect(chip.getAttribute("title")).toBeNull();
		expect(chip.querySelector("svg")).toBeNull();
	}

	const selectedClasses = new Set(selectedChip.className.split(/\s+/));
	expect(selectedClasses).toContain("bg-primary");
	expect(selectedClasses).toContain("text-primary-foreground");
	expect(selectedClasses).toContain("hover:bg-primary/90");
	expect(selectedClasses).toContain("hover:text-primary-foreground");
	expect(selectedClasses).not.toContain("bg-success/15");
	expect(selectedClasses).not.toContain("text-success");
	expect(selectedClasses).not.toContain("hover:bg-success/20");
	expect(selectedClasses).not.toContain("hover:text-success");
	expect(selectedChip.getAttribute("aria-current")).toBe("true");

	const viewedClasses = new Set(viewedChip.className.split(/\s+/));
	expect(viewedClasses).toContain("bg-success/15");
	expect(viewedClasses).toContain("text-success");
	expect(viewedClasses).toContain("hover:bg-success/20");
	expect(viewedClasses).toContain("hover:text-success");
	expect(viewedChip.hasAttribute("aria-current")).toBe(false);

	const unviewedClasses = new Set(unviewedChip.className.split(/\s+/));
	expect(unviewedClasses).toContain("hover:bg-muted");
	expect(unviewedClasses).toContain("hover:text-foreground");
	expect(unviewedClasses).not.toContain("bg-primary");
	expect(unviewedClasses).not.toContain("bg-success/15");
	expect(unviewedClasses).not.toContain("text-success");
	expect(unviewedChip.hasAttribute("aria-current")).toBe(false);
});

test("omits file icons and importance indicators without scores", () => {
	const markup = renderLayerPane();
	const container = parseMarkup(markup);
	const chip = container.querySelector<HTMLButtonElement>(
		'button[aria-label="src/routes/route.ts"]',
	);
	if (!chip) throw new Error("Missing layer file chip");

	expect(chip.querySelector("svg")).toBeNull();
	expect(chip.querySelector('[class*="bg-importance-"]')).toBeNull();
});

test("keeps long layer file labels readable and accessible", () => {
	const longPath =
		"src/features/review/components/very-long-file-name-that-wraps-safely-and-stays-visible-in-chip.ts";
	const visibleLabel =
		"very-long-file-name-that-wraps-safely-and-stays-visible-in-chip.ts";
	const markup = renderLayerPane({
		files: [longPath],
		state: reviewState({
			layers: [
				{
					...reviewState().layers[0],
					files: [longPath],
				},
			],
		}),
	});

	expect(markup).toContain(`>${visibleLabel}</button>`);
	expect(markup).not.toContain(`title="${longPath}"`);
	expect(markup).toContain(`aria-label="${longPath}"`);
});

test("marks the selected layer file chip active", () => {
	const markup = renderLayerPane({ selectedPath: "src/routes/route.ts" });

	expect(markup).toContain('data-active="true"');
	expect(markup).toContain('data-active="false"');
});

test("renders zero and full changed-file coverage", () => {
	const zeroMarkup = renderLayerPane();
	expect(zeroMarkup).toContain('aria-label="Diff file coverage"');
	expect(zeroMarkup).toContain('aria-valuenow="0"');
	expect(zeroMarkup).toContain('aria-valuemax="2"');
	expect(zeroMarkup).toContain('style="width:0%"');

	const fullMarkup = renderLayerPane({
		state: reviewState({
			viewedFiles: ["src/routes/route.ts", "web/route.ts"],
		}),
	});
	expect(fullMarkup).toContain('aria-label="Diff file coverage"');
	expect(fullMarkup).toContain('aria-valuenow="2"');
	expect(fullMarkup).toContain('aria-valuemax="2"');
	expect(fullMarkup).toContain('style="width:100%"');
});

function renderCollapseLayers(): string {
	return renderLayerPane({
		state: reviewState({
			layers: [
				{
					id: "done-layer",
					title: "Done layer",
					tldr: "Done details",
					files: ["src/done.ts"],
					done: true,
					stale: false,
				},
				{
					id: "open-layer",
					title: "Open layer",
					tldr: "Open details",
					files: ["src/open.ts"],
					done: false,
					stale: false,
				},
			],
		}),
		files: ["src/done.ts", "src/open.ts"],
	});
}

test("renders chevron and completion controls for each layer", () => {
	const markup = renderCollapseLayers();
	for (const layerId of ["done-layer", "open-layer"]) {
		const card = parseMarkup(layerCardMarkup(markup, layerId));
		const header = card.querySelector("div.flex.items-center.gap-2.p-3");
		const collapseControl = header?.querySelector<HTMLButtonElement>(
			'button[aria-controls^="layer-details-"]',
		);
		const title = header?.querySelector<HTMLButtonElement>(
			"button[data-active]",
		);
		const completion = header?.querySelector<HTMLButtonElement>(
			"button[aria-pressed]",
		);
		if (!header || !collapseControl || !title || !completion) {
			throw new Error(`Missing layer header controls for ${layerId}`);
		}
		const controls = [...header.children].filter(
			(child): child is HTMLButtonElement => child.tagName === "BUTTON",
		);

		expect(collapseControl.parentElement).toBe(header);
		expect(title.parentElement).toBe(header);
		expect(completion.parentElement).toBe(header);
		expect(controls.indexOf(collapseControl)).toBeLessThan(
			controls.indexOf(title),
		);
		expect(controls.indexOf(title)).toBeLessThan(controls.indexOf(completion));
		expect(title.classList.contains("min-w-0")).toBe(true);
		expect(title.classList.contains("flex-1")).toBe(true);
		expect(title.classList.contains("truncate")).toBe(true);
		expect(completion.classList.contains("shrink-0")).toBe(true);
		expect(collapseControl.classList.contains("size-6")).toBe(true);
		expect(completion.classList.contains("size-6")).toBe(true);
		expect(completion.classList.contains("size-7")).toBe(false);
		expect(collapseControl.getAttribute("aria-expanded")).toBe(
			layerId === "done-layer" ? "false" : "true",
		);
	}

	expect(markup).toContain('data-collapsed="true"');
	expect(markup).toContain('data-collapsed="false"');
	expect(markup).not.toContain(">Expand</button>");
	expect(markup).toContain('aria-label="Mark Done layer not done"');
	expect(markup).toContain('aria-label="Mark Open layer done"');
	expect(markup).toContain(">Done layer</button>");
	expect(markup).toContain(">Open layer</button>");

	const initiallyCollapsed = new Set(["done-layer"]);
	expect([...toggleLayerCollapsed(initiallyCollapsed, "done-layer")]).toEqual(
		[],
	);
	expect([...toggleLayerCollapsed(initiallyCollapsed, "open-layer")]).toEqual([
		"done-layer",
		"open-layer",
	]);
});

test("auto-collapses only on confirmed false-to-true done transitions", () => {
	const layerId = "open-layer";

	expect([
		...collapseLayerOnDoneTransition(new Set<string>(), layerId, false, true),
	]).toEqual([layerId]);
	expect([
		...collapseLayerOnDoneTransition(new Set<string>(), layerId, true, true),
	]).toEqual([]);
	expect([
		...collapseLayerOnDoneTransition(new Set([layerId]), layerId, true, false),
	]).toEqual([layerId]);
	expect([
		...collapseLayerOnDoneTransition(new Set<string>(), layerId, false, false),
	]).toEqual([]);

	const manuallyExpanded = toggleLayerCollapsed(new Set([layerId]), layerId);
	expect([
		...collapseLayerOnDoneTransition(manuallyExpanded, layerId, true, true),
	]).toEqual([]);
	expect([
		...collapseLayerOnDoneTransition(manuallyExpanded, layerId, false, true),
	]).toEqual([layerId]);
});

test("completion button toggles callback once and collapses only after saved state", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const events: Array<[string, boolean]> = [];
	const initialState = reviewState();
	const render = (state: ReviewState, actionError: string | null = null) =>
		root.render(
			<LayerPane
				state={state}
				files={["src/routes/route.ts", "web/route.ts"]}
				filesContent={null}
				selectedPath={null}
				onSelectFile={() => {}}
				onSelectLayer={() => {}}
				onToggleDone={(id, done) => events.push([id, done])}
				layerAction={null}
				actionError={actionError}
				externallyDisabled={false}
				onRegenerate={() => {}}
				onRetry={() => {}}
			/>,
		);

	act(() => render(initialState));
	const completion = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Mark Diff done"]',
	);
	expect(completion?.type).toBe("button");
	expect(completion?.getAttribute("aria-pressed")).toBe("false");
	expect(container.querySelector('[data-collapsed="false"]')).not.toBeNull();

	act(() => {
		completion?.focus();
		completion?.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	expect(document.activeElement).toBe(completion);
	act(() => completion?.click());
	expect(events).toEqual([["layer-1", true]]);
	act(() => render(initialState));
	expect(container.querySelector('[data-collapsed="false"]')).not.toBeNull();

	act(() => render(initialState, "Progress save failed"));
	expect(container.querySelector('[role="alert"]')?.textContent).toContain(
		"Progress save failed",
	);
	expect(completion?.getAttribute("aria-pressed")).toBe("false");
	expect(container.querySelector('[data-collapsed="false"]')).not.toBeNull();

	const savedState = reviewState({
		layers: initialState.layers.map((layer) => ({ ...layer, done: true })),
	});
	act(() => render(savedState));
	expect(container.querySelector('[data-collapsed="true"]')).not.toBeNull();
	const expand = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Expand Diff"]',
	);
	act(() => expand?.click());
	expect(container.querySelector('[data-collapsed="false"]')).not.toBeNull();

	const uncheck = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Mark Diff not done"]',
	);
	act(() => uncheck?.click());
	expect(events).toEqual([
		["layer-1", true],
		["layer-1", false],
	]);
	expect(container.querySelector('[data-collapsed="false"]')).not.toBeNull();
	expect(uncheck?.getAttribute("aria-pressed")).toBe("true");
});
