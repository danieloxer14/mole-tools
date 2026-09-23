import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChangedFilesHeader,
	changedFileCount,
	viewedFileCount,
} from "./ChangedFilesHeader";

const noop = () => {};

test("renders viewed files progress header", () => {
	const html = renderToStaticMarkup(
		<ChangedFilesHeader
			viewedCount={1}
			total={3}
			mode="list"
			onModeChange={noop}
		/>,
	);

	expect(html).toContain("Viewed files");
	expect(html).toContain('role="progressbar"');
	expect(html).toContain('aria-label="Viewed file coverage"');
	expect(html).toContain("1/3 files");
});

test("renders empty viewed files progress", () => {
	const html = renderToStaticMarkup(
		<ChangedFilesHeader
			viewedCount={0}
			total={1}
			mode="list"
			onModeChange={noop}
		/>,
	);

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
	const html = renderToStaticMarkup(
		<ChangedFilesHeader
			viewedCount={1}
			total={3}
			mode="list"
			onModeChange={noop}
		/>,
	);
	const region = html.match(/<div data-region="changed-files"[^>]*>/)?.[0];

	expect(region).toBeDefined();
	expect(region).toContain("border-t");
	expect(region).toContain("border-b");
	expect(region).not.toContain("border-2");
});

test("keeps viewed count and progress values aligned", () => {
	const html = renderToStaticMarkup(
		<ChangedFilesHeader
			viewedCount={2}
			total={4}
			mode="list"
			onModeChange={noop}
		/>,
	);

	expect(html).toContain("2/4 files");
	expect(html).toContain('aria-valuemax="4"');
	expect(html).toContain('aria-valuenow="2"');
	expect(html).toContain('style="width:50%"');
});

test("renders controlled list and tree layout items", () => {
	const listMarkup = renderToStaticMarkup(
		<ChangedFilesHeader
			viewedCount={1}
			total={2}
			mode="list"
			onModeChange={noop}
		/>,
	);
	expect(listMarkup).toContain('aria-label="Changed files layout"');
	expect(listMarkup).toContain('aria-label="List view"');
	expect(listMarkup).toContain('aria-label="Tree view"');
	expect(listMarkup).toContain('aria-pressed="true"');
	expect(listMarkup).toContain('data-state="on"');

	const treeMarkup = renderToStaticMarkup(
		<ChangedFilesHeader
			viewedCount={1}
			total={2}
			mode="tree"
			onModeChange={noop}
		/>,
	);
	expect(treeMarkup).toContain('aria-pressed="true"');
	expect(treeMarkup).toContain('data-state="on"');
	expect(treeMarkup).toContain('aria-label="Tree view"');
});
