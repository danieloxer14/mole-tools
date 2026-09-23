import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChangedFilesHeader,
	type ChangedFilesHeaderProps,
	changedFileCount,
	viewedFileCount,
} from "./ChangedFilesHeader";

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
const defaultProps: ChangedFilesHeaderProps = {
	viewedCount: 1,
	total: 3,
	showWhitespaceChanges: true,
	whitespaceChanging: false,
	syncing: false,
	onShowWhitespaceChangesChange: () => {},
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

function renderInteractive(
	overrides: Partial<ChangedFilesHeaderProps> = {},
): HTMLDivElement {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => {
		root.render(<ChangedFilesHeader {...defaultProps} {...overrides} />);
	});
	return container;
}

test("renders viewed files progress header", () => {
	const html = markup();

	expect(html).toContain("Viewed files");
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
});

test("emits the next controlled boolean when toggled", async () => {
	const changes: boolean[] = [];
	const container = renderInteractive({
		onShowWhitespaceChangesChange: (show) => changes.push(show),
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
