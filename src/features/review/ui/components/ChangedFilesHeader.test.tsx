import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChangedFilesHeader,
	type ChangedFilesHeaderProps,
	changedFileCount,
	diffLineTotals,
	viewedFileCount,
} from "./ChangedFilesHeader";

const noop = () => {};

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const defaultProps: ChangedFilesHeaderProps = {
	viewedCount: 1,
	total: 3,
	mode: "list",
	onModeChange: noop,
	filterQuery: "",
	onFilterQueryChange: noop,
};

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.replaceChildren();
});

function markup(overrides: Partial<ChangedFilesHeaderProps> = {}): string {
	return renderToStaticMarkup(
		<ChangedFilesHeader {...defaultProps} {...overrides} />,
	);
}

test("does not render importance markup when absent or null", () => {
	expect(markup()).not.toContain("Scoring importance");
	expect(markup()).not.toContain("Importance failed");
	expect(markup()).not.toContain("Importance legend");
	expect(
		markup({
			importance: {
				status: null,
				error: null,
				canRetry: false,
				onRetry: noop,
			},
		}),
	).toBe(markup());
});

test("renders importance progress between file count and filter", () => {
	const html = markup({
		importanceProgress: { value: 3, total: 6, threshold: 1.5 },
	});

	expect(html).toContain('aria-label="Importance review progress"');
	expect(html.indexOf("Importance review progress")).toBeGreaterThan(
		html.indexOf("files</span>"),
	);
	expect(html.indexOf("Importance review progress")).toBeLessThan(
		html.indexOf('placeholder="Filter files"'),
	);
	expect(markup()).not.toContain("Importance review progress");
});

test("shows pending and running importance status", () => {
	for (const status of ["pending", "running"] as const) {
		const html = markup({
			importance: { status, error: null, canRetry: false, onRetry: noop },
		});
		expect(html).toContain("Scoring…");
	}
});

test("omits the importance legend when scoring is ready", () => {
	const html = markup({
		importance: {
			status: "ready",
			error: null,
			canRetry: false,
			onRetry: noop,
		},
	});
	const container = document.createElement("div");
	container.innerHTML = html;
	expect(
		container.querySelector('[aria-label="Importance legend"]'),
	).toBeNull();
	expect(container.textContent).toContain("1/3 files");
});

test("shows failed importance status and Retry calls onRetry", () => {
	let retries = 0;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<ChangedFilesHeader
				{...defaultProps}
				importance={{
					status: "failed",
					error: "Scoring unavailable",
					canRetry: true,
					onRetry: () => retries++,
				}}
			/>,
		),
	);
	expect(container.textContent).toContain("Importance failed");
	const retry = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Retry",
	);
	expect(retry).not.toBeUndefined();
	act(() => retry?.click());
	expect(retries).toBe(1);
});

test("hides Retry when importance failure requires sync or reload", () => {
	const html = markup({
		importance: {
			status: "failed",
			error: "Importance results are for a different revision.",
			canRetry: false,
			onRetry: noop,
		},
	});

	expect(html).toContain("Importance failed");
	expect(html).not.toContain(">Retry</button>");
});

test("shows failed importance error in tooltip on focus", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<ChangedFilesHeader
				{...defaultProps}
				importance={{
					status: "failed",
					error: "Scoring unavailable",
					canRetry: true,
					onRetry: noop,
				}}
			/>,
		),
	);
	const failed = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Importance failed",
	);
	expect(failed).not.toBeUndefined();
	await act(async () => {
		document.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
		);
		failed?.focus();
		await Bun.sleep(0);
	});
	expect(
		document.body.querySelector('[data-slot="tooltip-content"]')?.textContent,
	).toBe("Scoring unavailable");
});
test("does not render a whitespace control", () => {
	const html = markup();

	expect(html).not.toContain("Show whitespace changes");
	expect(html).not.toContain('role="checkbox"');
});

function renderInteractive(): HTMLDivElement {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(<ChangedFilesHeader {...defaultProps} />));
	return container;
}

test("renders viewed files progress header", () => {
	const html = markup();

	expect(html).not.toContain("Viewed files");
	const container = document.createElement("div");
	container.innerHTML = html;
	const firstRow = container.querySelector(
		'[data-region="changed-files"]',
	)?.firstElementChild;
	expect(
		firstRow?.querySelector('[aria-label="Changed files layout"]'),
	).not.toBeNull();
	expect(firstRow?.querySelector('[role="progressbar"]')).not.toBeNull();
	expect(html).toContain('role="progressbar"');
	expect(html).toContain('aria-label="Viewed file coverage"');
	expect(html).toContain("1/3 files");
});
test("renders full-width file filter beneath global status row", () => {
	const container = document.createElement("div");
	container.innerHTML = markup();
	const region = container.querySelector('[data-region="changed-files"]');
	const rows = region?.children;
	expect(rows).toHaveLength(2);
	expect(
		rows?.[0]?.querySelector('[aria-label="Changed files layout"]'),
	).not.toBeNull();
	expect(rows?.[0]?.querySelector('[role="progressbar"]')).not.toBeNull();
	expect(rows?.[0]?.textContent).toContain("1/3 files");
	const input = region?.querySelector<HTMLInputElement>(
		'input[aria-label="Filter files"]',
	);
	expect(input?.type).toBe("text");
	expect(input?.placeholder).toBe("Filter files");
	expect(input?.value).toBe("");
	expect(input?.className).toContain("w-full");
	expect(input?.parentElement?.parentElement?.className).toContain("min-w-0");
	expect(region?.querySelector("svg.lucide-search")).not.toBeNull();
});

test("renders empty viewed files progress", () => {
	const html = markup({ viewedCount: 0, total: 1 });

	expect(html).toContain("0/1 files");
	expect(html).toContain('role="progressbar"');
	expect(html).toContain('style="width:0%"');
});

test("counts unique changed files that are viewed", () => {
	expect(viewedFileCount(["a.ts", "a.ts", "b.ts"], ["a.ts", "gone.ts"])).toBe(
		1,
	);
	expect(changedFileCount(["a.ts", "a.ts", "b.ts"])).toBe(2);
});

test("sums insertions and deletions across diff files", () => {
	expect(diffLineTotals([])).toEqual({ insertions: 0, deletions: 0 });
	expect(
		diffLineTotals([
			{ insertions: 1, deletions: 0 },
			{ insertions: 3, deletions: 2 },
		]),
	).toEqual({ insertions: 4, deletions: 2 });
});
test("exposes one-pixel boundary borders around changed-files region", () => {
	const html = markup();
	const region = html.match(/<div data-region="changed-files"[^>]*>/)?.[0];

	expect(region).toBeDefined();
	expect(region).toContain("border-t");
	expect(region).toContain("border-b");
	expect(region).not.toContain("border-2");
});

test("keeps viewed count and progress values aligned", () => {
	const html = markup({ viewedCount: 2, total: 4 });

	expect(html).toContain("2/4 files");
	expect(html).toContain('aria-valuemax="4"');
	expect(html).toContain('aria-valuenow="2"');
	expect(html).toContain('style="width:50%"');
});

test("renders controlled list and tree layout items", () => {
	const listMarkup = markup({ mode: "list" });
	expect(listMarkup).toContain('aria-label="Changed files layout"');
	expect(listMarkup).toContain('aria-label="List view"');
	expect(listMarkup).toContain('aria-label="Tree view"');
	expect(listMarkup).toContain('aria-pressed="true"');
	expect(listMarkup).toContain('data-state="on"');

	const treeMarkup = markup({ mode: "tree" });
	expect(treeMarkup).toContain('aria-pressed="true"');
	expect(treeMarkup).toContain('data-state="on"');
	expect(treeMarkup).toContain('aria-label="Tree view"');
	expect(listMarkup).not.toContain('title="List view"');
	expect(listMarkup).not.toContain('title="Tree view"');
});

test("shows a custom tooltip on focus instead of a native title", async () => {
	const container = renderInteractive();
	const listButton = container.querySelector<HTMLButtonElement>(
		'button[aria-label="List view"]',
	);
	expect(listButton).not.toBeNull();
	expect(listButton?.getAttribute("title")).toBeNull();

	await act(async () => {
		document.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
		);
		listButton?.focus();
		await Bun.sleep(0);
	});
	expect(document.activeElement).toBe(listButton);

	const tooltips = document.body.querySelectorAll(
		'[data-slot="tooltip-content"]',
	);
	expect(tooltips).toHaveLength(1);
	expect(tooltips[0]?.textContent).toBe("List view");
});
