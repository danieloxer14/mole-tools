import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewState } from "../../state";
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

function layerCardMarkup(markup: string, layerId: string): string {
	const checkboxIndex = markup.indexOf(`id="layer-done-${layerId}"`);
	expect(checkboxIndex).toBeGreaterThanOrEqual(0);
	const start = markup.lastIndexOf("<li ", checkboxIndex);
	const end = markup.indexOf("</li>", checkboxIndex);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return markup.slice(start, end + "</li>".length);
}

function classNames(markup: string): string[] {
	return markup.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
}

test("renders layers-only sticky header controls", () => {
	const markup = renderLayerPane();

	expect(markup).toContain("<h2");
	expect(markup).toContain("Review layers");
	expect(markup).toContain('aria-label="Regenerate layers"');
	expect(markup).not.toContain("<h1");
});

test("renders status-specific sticky header content", () => {
	expect(
		renderLayerPane({ state: reviewState({ layerStatus: "pending" }) }),
	).toContain("Preparing layers…");

	const runningMarkup = renderLayerPane({
		state: reviewState({ layerStatus: "running" }),
	});
	expect(runningMarkup).toContain("Generating layers…");
	expect(runningMarkup).not.toContain('aria-label="Completed layers"');
	expect(runningMarkup).toContain("data-dimmed");
	expect(runningMarkup).toContain(">Diff</button>");
	expect(layersStatusMessage("running")).toBe("Generating layers…");

	const failedMarkup = renderLayerPane({
		state: reviewState({
			layerStatus: "failed",
			layerError: "Agent timed out",
		}),
	});
	expect(failedMarkup).toContain("Layer generation failed");
	expect(failedMarkup).toContain('role="alert"');
	expect(failedMarkup).toContain("Agent timed out");
	expect(failedMarkup).toContain('aria-label="Retry layer generation"');

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
	const completedCard = layerCardMarkup(readyMarkup, "completed");
	const staleCard = layerCardMarkup(readyMarkup, "stale");
	const openCard = layerCardMarkup(readyMarkup, "open");
	const completedStatus = [
		...completedCard.matchAll(
			/<span\b(?=[^>]*\brole="img")[^>]*>[\s\S]*?<\/span>/g,
		),
	].map(([statusMarkup]) => statusMarkup);
	const openStatus = [
		...openCard.matchAll(/<span\b(?=[^>]*\brole="img")[^>]*>[\s\S]*?<\/span>/g),
	].map(([statusMarkup]) => statusMarkup);

	expect(readyMarkup).toContain("Completed layers");
	expect(readyMarkup).toContain('role="progressbar"');
	expect(readyMarkup).toContain('aria-valuenow="1"');
	expect(readyMarkup).toContain('aria-valuemax="3"');
	expect(readyMarkup).toContain(">1/3</span>");
	expect(completedStatus).toHaveLength(1);
	expect(completedStatus[0]).toContain('aria-label="Done"');
	expect(completedStatus[0]).toContain('data-layer-state="done"');
	expect(classNames(completedStatus[0])).toEqual(
		expect.arrayContaining([
			"inline-flex",
			"size-5",
			"shrink-0",
			"items-center",
			"justify-center",
			"rounded-full",
			"bg-success",
			"text-success-foreground",
		]),
	);
	expect(completedStatus[0]).not.toContain("<button");
	expect(completedCard).not.toContain(">Done</span>");
	const completedStatusContent = completedStatus[0]
		.replace(/^<span\b[^>]*>/, "")
		.replace(/<\/span>$/, "");
	expect(completedStatusContent).toContain("<svg");
	expect(completedStatusContent).toContain('aria-hidden="true"');
	const checkSvg = completedStatusContent.match(/<svg\b[^>]*>/)?.[0] ?? "";
	expect(checkSvg).toContain("lucide-check");
	expect(classNames(checkSvg)).toContain("size-3");
	expect(completedStatusContent).not.toContain("Done");

	expect(openStatus).toHaveLength(1);
	expect(openStatus[0]).toContain('aria-label="Open"');
	expect(openStatus[0]).toContain('data-layer-state="open"');
	expect(classNames(openStatus[0])).toEqual(
		expect.arrayContaining([
			"inline-flex",
			"size-5",
			"shrink-0",
			"items-center",
			"justify-center",
			"rounded-full",
			"bg-secondary",
		]),
	);
	expect(openStatus[0]).not.toContain("<button");
	expect(openCard).not.toContain(">Open</span>");
	const openStatusContent = openStatus[0]
		.replace(/^<span\b[^>]*>/, "")
		.replace(/<\/span>$/, "");
	expect(openStatusContent).toBe("");

	expect(staleCard).toContain('data-layer-state="stale"');
	expect(staleCard).toContain(">Stale</span>");
	expect(staleCard).not.toContain('role="img"');
	expect(staleCard).not.toContain("bg-success");
	const staleBadge =
		staleCard.match(/<span\b(?=[^>]*data-layer-state="stale")[^>]*>/)?.[0] ??
		"";
	expect(classNames(staleBadge)).toEqual(
		expect.arrayContaining(["bg-warning/15", "text-warning"]),
	);
	expect(staleCard).toContain("data-done");
	expect(staleCard).toContain("data-stale");
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

test("blocks the layer action during refresh without showing generation busy", () => {
	const action = layersActionState("ready", null, true);
	expect(action.disabled).toBe(true);
	expect(action.tooltip).toBe("Refresh in progress…");
	const markup = renderLayerPane({ externallyDisabled: true });

	expect(markup).toContain('data-slot="tooltip-trigger"');
	expect(markup).toContain('tabindex="0"');
	expect(markup).not.toContain('aria-busy="true"');
});

test("renders layer action errors as alerts in the sticky header", () => {
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

test("allows long file chip labels to wrap without clipping", () => {
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
	expect(markup).toContain("h-auto");
	expect(markup).toContain("overflow-visible");
	expect(markup).toContain("whitespace-normal");
	expect(markup).toContain("break-words");
	expect(markup).toContain("[overflow-wrap:anywhere]");
	expect(markup).toContain("justify-start");
	expect(markup).toContain("text-left");
});

test("marks the selected layer file chip active", () => {
	const markup = renderLayerPane({ selectedPath: "src/routes/route.ts" });

	expect(markup).toContain('data-active="true"');
	expect(markup).toContain('data-active="false"');
});

test("uses foreground title text without orange selected override", () => {
	const markup = renderLayerPane({ selectedPath: "src/routes/route.ts" });

	expect(markup).toContain(
		'class="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground transition-colors duration-150 ease-out"',
	);
	expect(markup).toContain("space-y-3 px-3 pb-3 text-sm text-foreground");
});

test("keeps foreground title text for done and stale layers", () => {
	const markup = renderLayerPane({
		state: reviewState({
			layers: [
				{
					id: "done",
					title: "Done layer",
					tldr: "Done details",
					files: ["src/done.ts"],
					done: true,
					stale: false,
				},
				{
					id: "stale",
					title: "Stale layer",
					tldr: "Stale details",
					files: ["src/stale.ts"],
					done: false,
					stale: true,
				},
			],
		}),
		files: ["src/done.ts", "src/stale.ts"],
	});

	const titleClass =
		'class="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground transition-colors duration-150 ease-out"';
	expect((markup.match(new RegExp(titleClass, "g")) ?? []).length).toBe(2);
});

test("gives file labels hover and filled selected treatments", () => {
	const markup = renderLayerPane({ selectedPath: "src/routes/route.ts" });

	expect(markup).toContain("hover:bg-muted");
	expect(markup).toContain("data-[active=true]:bg-primary");
	expect(markup).toContain("data-[active=true]:text-primary-foreground");
	expect(markup).toContain('aria-current="true"');
});
test("uses padded spacing between layer header and cards", () => {
	const markup = renderLayerPane();

	expect(markup).toContain(
		'class="m-0 flex-1 list-none space-y-2 overflow-auto px-4 pt-4 pb-4 transition-opacity duration-200 ease-out data-[dimmed]:opacity-60"',
	);
});

test("uses centered, tight alignment for layer header controls", () => {
	const markup = renderLayerPane();

	expect(markup).toContain("px-4 pt-4 pb-3 leading-none");
	expect(markup).toContain("items-center gap-2 px-4 pb-3 text-xs leading-none");
	expect(markup).toContain(
		'class="inline-flex items-center tabular-nums leading-none"',
	);
	expect(markup).toContain(
		"grid-cols-[auto_minmax(0,1fr)_minmax(3rem,1fr)_auto]",
	);
});

test("keeps white title and description classes for done and stale layers", () => {
	const markup = renderLayerPane({
		state: reviewState({
			layers: [
				{
					id: "done",
					title: "Done layer",
					tldr: "Done details",
					files: ["src/done.ts"],
					done: true,
					stale: false,
				},
				{
					id: "stale",
					title: "Stale layer",
					tldr: "Stale details",
					files: ["src/stale.ts"],
					done: true,
					stale: true,
				},
			],
		}),
		files: ["src/done.ts", "src/stale.ts"],
	});

	expect(
		(markup.match(/text-foreground/g) ?? []).length,
	).toBeGreaterThanOrEqual(4);
});

test("renders layer coverage on one row without BDD and exposes regenerate", () => {
	const markup = renderLayerPane({
		state: reviewState({ viewedFiles: ["src/routes/route.ts"] }),
	});

	expect(markup).toContain('aria-label="Regenerate layers"');
	expect(markup).toContain('class="flex items-center gap-3 text-xs"');
	expect(markup).toContain("File coverage");
	expect(markup).toContain("flex-1");
	expect(markup).toContain('style="width:50%"');
	expect(markup).not.toContain("BDD");
});

test("renders zero and full layer coverage", () => {
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

test("exposes retry for a failed layer guide", () => {
	const markup = renderLayerPane({
		state: reviewState({ layerStatus: "failed" }),
	});

	expect(markup).toContain('aria-label="Retry layer generation"');
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
