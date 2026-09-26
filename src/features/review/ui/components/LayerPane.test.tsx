import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { ParsedFileDiff } from "../../../../shared/diff-parse";
import type { ReviewState } from "../../state";
import { ChangedFiles } from "./ChangedFiles";
import {
	collapseLayerOnDoneTransition,
	collapseLayerWhenDone,
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
	const whitespaceChanges: boolean[] = [];
	let selectedPath: string | null = filePaths[0] ?? null;
	let viewedFiles: string[] = [];
	let showWhitespaceChanges = true;
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
						showWhitespaceChanges={showWhitespaceChanges}
						onShowWhitespaceChangesChange={(show) => {
							whitespaceChanges.push(show);
							showWhitespaceChanges = show;
						}}
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
	act(() =>
		container
			.querySelector<HTMLElement>(
				'[role="checkbox"][aria-label="Show whitespace changes"]',
			)
			?.click(),
	);
	act(render);
	expect(fileSelections).toEqual(["src/routes/route.ts"]);
	expect(viewedChanges).toEqual([[["src/routes/route.ts"], true]]);
	expect(whitespaceChanges).toEqual([false]);

	const srcFolder = nav.querySelector<HTMLButtonElement>(
		'button[aria-label="Collapse src"]',
	);
	if (!srcFolder) throw new Error("src folder is missing");
	act(() => srcFolder.click());
	expect(
		nav
			.querySelector('button[aria-label="Expand src"]')
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
			.querySelector('button[aria-label="Expand src"]')
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
	const checkboxIndex = markup.indexOf(`id="layer-done-${layerId}"`);
	expect(checkboxIndex).toBeGreaterThanOrEqual(0);
	const start = markup.lastIndexOf("<li ", checkboxIndex);
	const end = markup.indexOf("</li>", checkboxIndex);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return markup.slice(start, end + "</li>".length);
}

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
	expect(completedCard).toContain('aria-label="Done"');
	expect(completedCard).toContain('data-layer-state="done"');
	expect(staleCard).toContain('data-layer-state="stale"');
	expect(staleCard).toContain(">Stale</span>");
	expect(staleCard).toContain("data-done");
	expect(staleCard).toContain("data-stale");
	expect(openCard).toContain('aria-label="Open"');
	expect(openCard).toContain('data-layer-state="open"');
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
	expect(markup).toContain('title="src/routes/route.ts"');
	expect(markup).toContain('aria-label="src/routes/route.ts"');
	expect(markup).toContain(">web/route.ts</button>");
	expect(markup).toContain('title="web/route.ts"');
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
	expect(markup).toContain(`title="${longPath}"`);
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

test("renders chevron collapse controls before each checkbox", () => {
	const markup = renderCollapseLayers();
	for (const layerId of ["done-layer", "open-layer"]) {
		const collapseControl = markup.indexOf(
			`aria-controls="layer-details-${layerId}"`,
		);
		const doneCheckbox = markup.indexOf(`id="layer-done-${layerId}"`);

		expect(collapseControl).toBeGreaterThanOrEqual(0);
		expect(collapseControl).toBeLessThan(doneCheckbox);
	}
	expect(markup).toContain('aria-label="Expand Done layer"');
	expect(markup).toContain('aria-expanded="false"');
	expect(markup).toContain('aria-label="Collapse Open layer"');
	expect(markup).toContain('aria-expanded="true"');
	expect(markup).toContain('data-collapsed="true"');
	expect(markup).toContain('data-collapsed="false"');
	expect(markup).not.toContain(">Expand</button>");
	expect(markup).toContain('aria-label="Mark Done layer done"');
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

test("collapses a layer as soon as it is marked done", () => {
	const collapsed = collapseLayerWhenDone(
		new Set<string>(),
		"open-layer",
		true,
	);

	expect([...collapsed]).toEqual(["open-layer"]);
	expect([...collapseLayerWhenDone(collapsed, "open-layer", false)]).toEqual([
		"open-layer",
	]);
});

test("auto-collapses only on false-to-true done transitions", () => {
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

	expect([...collapseLayerWhenDone(new Set<string>(), layerId, true)]).toEqual([
		layerId,
	]);
	expect([
		...collapseLayerWhenDone(new Set([layerId]), layerId, false),
	]).toEqual([layerId]);
});
