import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MrApprovalState } from "../../../../ports/git-host";
import type { ReviewState } from "../../state";
import {
	collapseLayerOnDoneTransition,
	collapseLayerWhenDone,
	LayerPane,
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

const approval: MrApprovalState = {
	approved: true,
	currentUser: "reviewer",
	approvalsLeft: 0,
	approvedBy: ["reviewer"],
	rules: [
		{
			name: "default",
			approvalsRequired: 1,
			approvalsLeft: 0,
			approvedBy: ["reviewer"],
		},
	],
};

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
			actionError={null}
			onRegenerate={() => {}}
			onRetry={() => {}}
			approval={approval}
			approvalLoading={false}
			approvalAction={null}
			approvalError={null}
			onApprovalAction={() => {}}
			onOpenSettings={() => {}}
			{...props}
		/>,
	);
}

test("renders Prompts & Models action and wires its callback", () => {
	let opened = false;
	const onOpenSettings = () => {
		opened = true;
	};
	const markup = renderLayerPane({ onOpenSettings });

	expect(markup).toContain(">Prompts &amp; Models</button>");
	onOpenSettings();
	expect(opened).toBe(true);
});

test("renders layer file chips with shortened labels and full-path accessible labels", () => {
	const markup = renderLayerPane();

	expect(markup).toContain(">routes/route.ts</button>");
	expect(markup).toContain('title="src/routes/route.ts"');
	expect(markup).toContain('aria-label="src/routes/route.ts"');
	expect(markup).toContain(">web/route.ts</button>");
	expect(markup).toContain('title="web/route.ts"');
});

test("marks the selected layer file chip active", () => {
	const markup = renderLayerPane({ selectedPath: "src/routes/route.ts" });

	expect(markup).toContain('class="active"');
});

test("renders layer coverage without BDD and exposes regenerate", () => {
	const markup = renderLayerPane();

	expect(markup).toContain(">Regenerate</button>");
	expect(markup).toContain("File coverage");
	expect(markup).not.toContain("BDD");
});

test("exposes retry for a failed layer guide", () => {
	const markup = renderLayerPane({
		state: reviewState({ layerStatus: "failed" }),
	});

	expect(markup).toContain(">Retry</button>");
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
		approval: null,
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
