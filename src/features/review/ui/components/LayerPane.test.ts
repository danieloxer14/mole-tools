import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewStateSchema } from "../../state";
import {
	collapseLayerOnDoneTransition,
	collapseLayerWhenDone,
	LayerPane,
	splitBddScenario,
	toggleLayerCollapsed,
} from "./LayerPane";

const reviewState = ReviewStateSchema.parse({
	version: 1,
	mode: "code",
	mr: {
		host: "gitlab.example.com",
		projectPath: "group/project",
		iid: 42,
		webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
		title: "Review layers",
		sourceBranch: "feature/review-layers",
		targetBranch: "main",
	},
	revision: {
		headSha: "head",
		mergeBaseSha: "base",
		diffRefs: { baseSha: "base", startSha: "start", headSha: "head" },
		syncedAt: "2026-01-01T00:00:00.000Z",
	},
	worktreePath: "/worktree",
	repoRoot: "/repo",
	layerStatus: "ready",
	layerError: null,
	layers: [
		{
			id: "done-layer",
			title: "Done layer",
			tldr: "Done details",
			files: ["src/done.ts"],
			bdd: ["Given done behavior, When reviewed, Then it passes."],
			done: true,
			stale: false,
		},
		{
			id: "open-layer",
			title: "Open layer",
			tldr: "Open details",
			files: ["src/open.ts"],
			bdd: ["Given open behavior, When reviewed, Then it passes."],
			done: false,
			stale: false,
		},
	],
	viewedFiles: [],
	drafts: [],
});

function renderLayers(): string {
	return renderToStaticMarkup(
		createElement(LayerPane, {
			state: reviewState,
			files: ["src/done.ts", "src/open.ts"],
			selectedPath: null,
			onSelectFile: () => {},
			onSelectLayer: () => {},
			onToggleDone: () => {},
			layerAction: null,
			actionError: null,
			onRegenerate: () => {},
			onRetry: () => {},
			approval: null,
			approvalLoading: false,
			approvalAction: null,
			approvalError: null,
			onApprovalAction: () => {},
		}),
	);
}

test("renders chevron collapse controls before each checkbox", () => {
	const markup = renderLayers();
	for (const layerId of ["done-layer", "open-layer"]) {
		const collapseControl = markup.indexOf(
			`aria-controls="layer-details-${layerId}"`,
		);
		const doneCheckbox = markup.indexOf(`id="layer-done-${layerId}"`);

		expect(collapseControl).toBeGreaterThanOrEqual(0);
		expect(collapseControl).toBeLessThan(doneCheckbox);
	}
	expect(markup).toContain(
		'class="layer-collapse" aria-label="Expand Done layer" aria-expanded="false" aria-controls="layer-details-done-layer"',
	);
	expect(markup).toContain(
		'class="layer-collapse" aria-label="Collapse Open layer" aria-expanded="true" aria-controls="layer-details-open-layer"',
	);
	expect(markup).toContain('class="layer-collapse-icon"');
	expect(markup).not.toContain(">Expand</button>");
	expect(markup).toContain(
		'id="layer-details-done-layer" class="layer-details is-collapsed" aria-hidden="true" inert=""><div class="layer-details-content"><p>Done details</p>',
	);
	expect(markup).toContain(
		'id="layer-details-open-layer" class="layer-details" aria-hidden="false"><div class="layer-details-content"><p>Open details</p>',
	);
	expect(markup).toContain('aria-label="Mark Done layer done"');
	expect(markup).toContain('aria-label="Mark Open layer done"');
	expect(markup).toContain(">Done</span>");
	expect(markup).toContain(">Open</span>");

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
test("splits Given, When, Then clauses into display steps", () => {
	expect(
		splitBddScenario(
			"Given a video model with capacity, when tagged assets are calculated, then capacity is used.",
		),
	).toEqual([
		"Given a video model with capacity",
		"when tagged assets are calculated",
		"then capacity is used.",
	]);
});
