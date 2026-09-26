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
	showWhitespaceChanges: true,
	whitespaceChanging: false,
	syncing: false,
	refreshing: false,
	onShowWhitespaceChangesChange: noop,
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

test("renders a controlled accessible whitespace checkbox", () => {
	const checked = markup({ showWhitespaceChanges: true });
	const unchecked = markup({ showWhitespaceChanges: false });

	expect(checked).toContain('role="checkbox"');
	expect(checked).toContain('aria-label="Show whitespace changes"');
	expect(checked).toContain('aria-checked="true"');
	expect(checked).toContain("Show whitespace changes");
	expect(unchecked).toContain('aria-checked="false"');
});

test("disables the whitespace checkbox while changing or syncing", () => {
	expect(markup({ whitespaceChanging: true })).toContain("disabled");
	expect(markup({ syncing: true })).toContain("disabled");
	expect(markup({ refreshing: true })).toContain("disabled");
});

test("emits the next controlled boolean when toggled", async () => {
	const changes: boolean[] = [];
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => {
		root.render(
			<ChangedFilesHeader
				{...defaultProps}
				onShowWhitespaceChangesChange={(show) => changes.push(show)}
			/>,
		);
	});
	const checkbox = container.querySelector('[role="checkbox"]');

	expect(checkbox).not.toBeNull();
	await act(async () => {
		(checkbox as HTMLElement).click();
	});

	expect(changes).toEqual([false]);
});

test("keeps the whitespace control available with no visible files", () => {
	const html = markup({ viewedCount: 0, total: 0 });

	expect(html).toContain("0/0 files");
	expect(html).toContain('aria-label="Show whitespace changes"');
});
