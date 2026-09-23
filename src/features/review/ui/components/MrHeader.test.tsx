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
	tabTitle,
} from "./MrHeader";

const dom = new Window();
Object.assign(globalThis, {
	window: dom,
	document: dom.document,
	navigator: dom.navigator,
	Node: dom.Node,
	Element: dom.Element,
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

function render(overrides: Partial<MrHeaderProps> = {}): HTMLDivElement {
	const container = document.createElement("div");
	container.innerHTML = renderToStaticMarkup(
		<MrHeader {...base} {...overrides} />,
	);
	return container;
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

function expectBefore(before: Element | null, after: Element | null): void {
	expect(before).not.toBeNull();
	expect(after).not.toBeNull();
	if (before !== null && after !== null) {
		expect(
			Boolean(
				before.compareDocumentPosition(after) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			),
		).toBe(true);
	}
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
	const container = render();
	const title = container.querySelector("h1");
	const sha = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Copy commit sha"]',
	);
	const status = container.querySelector('[data-approval="approved"]');
	const link = container.querySelector<HTMLAnchorElement>('a[target="_blank"]');

	expect(title?.textContent).toBe("Add review header");
	expect(title?.getAttribute("title")).toBe("Add review header");
	expect(sha?.textContent).toContain("12345678");
	expect(sha?.getAttribute("title")).toBe(base.headSha);
	expect(status?.textContent).toBe("Approved");
	expect(status?.getAttribute("title")).toBe(
		"Approved by reviewer, maintainer",
	);
	expect(link?.getAttribute("href")).toBe(base.mr.webUrl);
	expect(link?.getAttribute("target")).toBe("_blank");
	expect(link?.getAttribute("title")).toBeNull();
});

test("falls back to IID when title is empty", () => {
	const title = render({ mr: { ...base.mr, title: "" } }).querySelector("h1");

	expect(title?.textContent).toBe("!42");
	expect(title?.getAttribute("title")).toBe("");
});

test("hides approval pill while loading or unavailable", () => {
	expect(
		render({ approvalLoading: true }).querySelector("[data-approval]"),
	).toBeNull();
	expect(
		render({ approval: null }).querySelector("[data-approval]"),
	).toBeNull();
	const notApproved = render({
		approval: { ...approval, approved: false },
	}).querySelector('[data-approval="not-approved"]');

	expect(notApproved?.textContent).toBe("Not approved");
});

test("renders stale controls between refresh and GitLab link", () => {
	const container = render({
		freshness: { stale: true, newCommitCount: 1 },
	});
	const refresh = container.querySelector(
		'button[aria-label="Refresh merge request"]',
	);
	const sync = container.querySelector('button[aria-label="Sync to latest"]');
	const regenerate = [...container.querySelectorAll("label")].find((label) =>
		label.textContent?.includes("Regenerate layers after sync"),
	);
	const open = container.querySelector('a[target="_blank"]');

	expectBefore(refresh, sync);
	expectBefore(sync, regenerate ?? null);
	expectBefore(regenerate ?? null, open);
	expect(container.querySelector("[data-badge]")).not.toBeNull();
	expect(
		container.querySelector('button[aria-label="Sync to latest"]'),
	).not.toBeNull();
	const freshContainer = render({ freshness: null });
	expect(
		freshContainer.querySelector('button[aria-label="Sync to latest"]'),
	).toBeNull();
	expect(freshContainer.textContent).not.toContain(
		"Regenerate layers after sync",
	);
});

test("refresh busy and disabled states reflect ongoing work", () => {
	const refreshing = render({
		refreshing: true,
	}).querySelector<HTMLButtonElement>(
		'button[aria-label="Refresh merge request"]',
	);
	expect(refreshing?.getAttribute("aria-busy")).toBe("true");
	expect(refreshing?.disabled).toBe(true);

	const syncing = render({ syncing: true }).querySelector<HTMLButtonElement>(
		'button[aria-label="Refresh merge request"]',
	);
	expect(syncing?.disabled).toBe(true);

	const layerGenerating = render({
		layerGenerating: true,
	}).querySelector<HTMLButtonElement>(
		'button[aria-label="Refresh merge request"]',
	);
	expect(layerGenerating?.disabled).toBe(true);
});

test("approve action uses state variant and disabled tooltip precedence", () => {
	const approved = render().querySelector<HTMLButtonElement>(
		'button[aria-label="Unapprove"]',
	);
	expect(approved?.textContent).toContain("Unapprove");
	expect(approved?.disabled).toBe(false);

	const notApproved = render({
		approval: { ...approval, approved: false },
	}).querySelector<HTMLButtonElement>('button[aria-label="Approve"]');
	expect(notApproved?.textContent).toContain("Approve");
	expect(notApproved?.disabled).toBe(false);

	const stale = render({
		freshness: { stale: true, newCommitCount: 2 },
	}).querySelector<HTMLButtonElement>('button[aria-label="Unapprove"]');
	expect(stale?.getAttribute("title")).toBeNull();
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
	expect(tabTitle("group/project", 42)).toBe("project!42");
	expect(tabTitle("group/sub/project", 7)).toBe("project!7");
	expect(tabTitle("project", 1)).toBe("project!1");
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
test("keeps SHA copy control centered with adjacent header controls", async () => {
	Object.defineProperty(dom.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: () => Promise.resolve(),
		},
	});
	const rendered = renderInteractive();
	const sha = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Copy commit sha"]',
	);
	const metadata = sha?.parentElement;
	const actions = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Refresh merge request"]',
	)?.parentElement;

	expect(metadata?.className).toContain("inline-flex");
	expect(metadata?.className).toContain("items-center");
	expect(metadata?.className).toContain("leading-none");
	expect(actions?.className).toContain("inline-flex");
	expect(actions?.className).toContain("items-center");
	expect(actions?.className).toContain("leading-none");
	expect(sha?.className).toContain("items-center");
	expect(sha?.className).toContain("leading-none");
	expect(sha?.querySelector("[data-sha-label]")?.textContent).toBe("12345678");
});

test("uses success approval styling without changing destructive unapproval", () => {
	const approve = render({
		approval: { ...approval, approved: false },
	}).querySelector<HTMLButtonElement>('button[aria-label="Approve"]');
	expect(approve?.className).toContain("bg-success");
	expect(approve?.className).toContain("text-success-foreground");
	expect(approve?.className).toContain("hover:bg-success/80");
	expect(approve?.className).not.toContain("dark:bg-success");
	expect(approve?.className).not.toContain("bg-primary");

	const unapprove = render().querySelector<HTMLButtonElement>(
		'button[aria-label="Unapprove"]',
	);
	expect(unapprove?.className).toContain("bg-destructive/10");
	expect(unapprove?.className).toContain("text-destructive");
	expect(unapprove?.className).not.toContain("bg-success");
});

test("keeps approval disabled states and callbacks intact", () => {
	const unavailable = render({
		approval: null,
	}).querySelector<HTMLButtonElement>('button[aria-label="Approve"]');
	expect(unavailable?.disabled).toBe(true);
	expect(unavailable?.getAttribute("aria-describedby")).toBe("approve-tooltip");
	const unavailableTooltip = render({
		approval: null,
	}).querySelector("#approve-tooltip");
	expect(unavailableTooltip?.textContent).toBe("Approval unavailable");

	const loading = render({
		approvalLoading: true,
	}).querySelector<HTMLButtonElement>('button[aria-label="Unapprove"]');
	expect(loading?.disabled).toBe(true);

	const actions: ApprovalAction[] = [];
	const unapproved = renderInteractive({
		approval: { ...approval, approved: false },
		onApprovalAction: (action) => actions.push(action),
	});
	const approve = unapproved.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Approve"]',
	);
	act(() => approve?.click());
	expect(actions).toEqual(["approve"]);
});
