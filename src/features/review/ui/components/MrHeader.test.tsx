import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { MrApprovalState } from "../../../../ports/git-host";
import {
	approvalPillLabel,
	approveDisabledReason,
	approveTooltip,
	headerTitle,
	MrHeader,
	type MrHeaderProps,
	shaButtonLabel,
	shortSha,
	syncTooltip,
} from "./MrHeader";

const dom = new Window();
Object.assign(globalThis, {
	window: dom,
	document: dom.document,
	navigator: dom.navigator,
	Node: dom.Node,
	HTMLElement: dom.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.replaceChildren();
});

const approval: MrApprovalState = {
	approved: true,
	currentUser: "reviewer",
	approvalsLeft: 0,
	approvedBy: ["reviewer", "maintainer"],
	rules: [
		{
			name: "default",
			approvalsRequired: 2,
			approvalsLeft: 0,
			approvedBy: ["reviewer", "maintainer"],
		},
	],
};

const base: MrHeaderProps = {
	mr: {
		iid: 42,
		title: "Add review header",
		webUrl: "https://gitlab.example.test/group/project/-/merge_requests/42",
	},
	headSha: "1234567890abcdef1234567890abcdef12345678",
	approval,
	approvalLoading: false,
	approvalAction: null,
	onApprovalAction: () => {},
	freshness: null,
	refreshing: false,
	syncing: false,
	layerGenerating: false,
	regenerateAfterSync: false,
	onRegenerateAfterSyncChange: () => {},
	onRefresh: () => {},
	onSync: () => {},
};

function render(overrides: Partial<MrHeaderProps> = {}): string {
	return renderToStaticMarkup(<MrHeader {...base} {...overrides} />);
}

interface InteractiveRender {
	container: HTMLDivElement;
	root: Root;
}

function renderInteractive(
	overrides: Partial<MrHeaderProps> = {},
): InteractiveRender {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => {
		root.render(<MrHeader {...base} {...overrides} />);
	});
	return { container, root };
}

test("reports copied only after clipboard write succeeds", async () => {
	let resolveCopy!: () => void;
	Object.defineProperty(dom.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: () =>
				new Promise<void>((resolve) => {
					resolveCopy = resolve;
				}),
		},
	});
	const rendered = renderInteractive();
	const button = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Copy commit sha"]',
	);
	expect(button).not.toBeNull();

	act(() => button?.click());
	expect(rendered.container.textContent).toContain("12345678");
	expect(rendered.container.textContent).not.toContain("Copied");

	await act(async () => {
		resolveCopy();
		await Promise.resolve();
	});
	expect(rendered.container.textContent).toContain("Copied");
});

test("does not report copied when clipboard write fails", async () => {
	Object.defineProperty(dom.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: () => Promise.reject(new Error("clipboard unavailable")),
		},
	});
	const rendered = renderInteractive();
	const button = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Copy commit sha"]',
	);
	expect(button).not.toBeNull();

	act(() => button?.click());
	await act(async () => {
		await Promise.resolve();
	});
	expect(rendered.container.textContent).not.toContain("Copied");
});

test("renders title, sha identity, approved pill, and GitLab link", () => {
	const html = render();

	expect(html).toContain(
		'<h1 class="mr-title" title="Add review header">Add review header</h1>',
	);
	expect(html).toContain(
		'<button type="button" class="mr-sha" aria-label="Copy commit sha" title="1234567890abcdef1234567890abcdef12345678">12345678',
	);
	expect(html).toContain('class="mr-status-pill mr-status-pill-approved"');
	expect(html).toContain('title="Approved by reviewer, maintainer"');
	expect(html).toContain(
		'href="https://gitlab.example.test/group/project/-/merge_requests/42"',
	);
	expect(html).toContain('target="_blank"');
	expect(html).toContain('title="Open in GitLab"');
});

test("falls back to IID when title is empty", () => {
	const html = render({ mr: { ...base.mr, title: "" } });

	expect(html).toContain('<h1 class="mr-title" title="">!42</h1>');
});

test("hides approval pill while loading or unavailable", () => {
	expect(render({ approvalLoading: true })).not.toContain("mr-status-pill");
	expect(render({ approval: null })).not.toContain("mr-status-pill");
	expect(render({ approval: { ...approval, approved: false } })).toContain(
		'class="mr-status-pill mr-status-pill-neutral"',
	);
	expect(render({ approval: { ...approval, approved: false } })).toContain(
		">Not approved</span>",
	);
});

test("renders stale controls between refresh and GitLab link", () => {
	const html = render({
		freshness: { stale: true, newCommitCount: 1 },
	});
	const refresh = html.indexOf('aria-label="Refresh merge request"');
	const sync = html.indexOf('aria-label="Sync to latest"');
	const regenerate = html.indexOf("Regenerate layers after sync");
	const open = html.indexOf('title="Open in GitLab"');

	expect(sync).toBeGreaterThan(refresh);
	expect(regenerate).toBeGreaterThan(sync);
	expect(open).toBeGreaterThan(regenerate);
	expect(html).toContain('class="icon-button-badge"');
	expect(html).toContain('title="Sync to latest — 1 new commit"');
	expect(render({ freshness: null })).not.toContain("Sync to latest");
	expect(render({ freshness: null })).not.toContain(
		"Regenerate layers after sync",
	);
});

test("refresh busy and disabled states reflect ongoing work", () => {
	const refreshing = render({ refreshing: true });
	expect(refreshing).toContain('aria-label="Refresh merge request"');
	expect(refreshing).toContain('aria-busy="true"');
	expect(refreshing).toContain('disabled=""');

	const syncing = render({ syncing: true });
	expect(syncing).toContain('aria-label="Refresh merge request"');
	expect(syncing).toContain('disabled=""');

	const layerGenerating = render({ layerGenerating: true });
	expect(layerGenerating).toContain('aria-label="Refresh merge request"');
	expect(layerGenerating).toContain('disabled=""');
});

test("approve action uses state variant and disabled tooltip precedence", () => {
	const approved = render();
	expect(approved).toContain('class="mr-approve mr-approve-danger"');
	expect(approved).toContain(">Unapprove</button>");

	const notApproved = render({ approval: { ...approval, approved: false } });
	expect(notApproved).toContain('class="mr-approve mr-approve-success"');
	expect(notApproved).toContain(">Approve</button>");
	expect(render({ freshness: { stale: true, newCommitCount: 2 } })).toContain(
		'title="MR out of date — approves 12345678"',
	);
});

test("covers approval helper matrix", () => {
	expect(approvalPillLabel(approval, true)).toBeNull();
	expect(approvalPillLabel(null, false)).toBeNull();
	expect(approvalPillLabel(approval, false)).toBe("Approved");
	expect(approveDisabledReason(approval, true, null)).toBe("Loading approval…");
	expect(approveDisabledReason(null, false, null)).toBe("Approval unavailable");
	expect(
		approveDisabledReason({ ...approval, currentUser: null }, false, null),
	).toBe("Cannot determine current user");
	expect(approveDisabledReason(approval, false, "approve")).toBe("Approving…");
	expect(approveDisabledReason(approval, false, "unapprove")).toBe(
		"Unapproving…",
	);
	expect(approveDisabledReason(approval, false, null)).toBeNull();
});

test("covers pure display helpers", () => {
	expect(headerTitle("  Title  ", 42)).toBe("  Title  ");
	expect(headerTitle("", 42)).toBe("!42");
	expect(shortSha(base.headSha)).toBe("12345678");
	expect(shaButtonLabel(base.headSha, false)).toBe("12345678");
	expect(shaButtonLabel(base.headSha, true)).toBe("Copied");
	expect(
		approveTooltip("Approval unavailable", true, base.headSha, false),
	).toBe("Approval unavailable");
	expect(approveTooltip(null, true, base.headSha, false)).toBe(
		"MR out of date — approves 12345678",
	);
	expect(approveTooltip(null, false, base.headSha, true)).toBe("Unapprove");
	expect(syncTooltip(1)).toBe("Sync to latest — 1 new commit");
	expect(syncTooltip(2)).toBe("Sync to latest — 2 new commits");
});
