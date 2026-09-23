import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChangedFilesHeader,
	changedFileCount,
	diffLineTotals,
	viewedFileCount,
} from "./ChangedFilesHeader";

test("renders viewed files progress header", () => {
	const html = renderToStaticMarkup(
		<ChangedFilesHeader viewedCount={1} total={3} />,
	);

	expect(html).toContain("Viewed files");
	expect(html).toContain('role="progressbar"');
	expect(html).toContain('aria-label="Viewed file coverage"');
	expect(html).toContain("1/3 files");
});

test("renders empty viewed files progress", () => {
	const html = renderToStaticMarkup(
		<ChangedFilesHeader viewedCount={0} total={1} />,
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
	const html = renderToStaticMarkup(
		<ChangedFilesHeader viewedCount={1} total={3} />,
	);
	const region = html.match(/<div data-region="changed-files"[^>]*>/)?.[0];

	expect(region).toBeDefined();
	expect(region).toContain("border-t");
	expect(region).toContain("border-b");
	expect(region).not.toContain("border-2");
});

test("keeps viewed count and progress values aligned", () => {
	const html = renderToStaticMarkup(
		<ChangedFilesHeader viewedCount={2} total={4} />,
	);

	expect(html).toContain("2/4 files");
	expect(html).toContain('aria-valuemax="4"');
	expect(html).toContain('aria-valuenow="2"');
	expect(html).toContain('style="width:50%"');
});
