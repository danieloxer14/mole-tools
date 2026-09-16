import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChangedFilesHeader,
	changedFileCount,
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
		<ChangedFilesHeader viewedCount={0} total={0} />,
	);

	expect(html).toContain("0/0 files");
	expect(html).toContain('style="width:0%"');
});

test("counts unique changed files that are viewed", () => {
	expect(viewedFileCount(["a.ts", "a.ts", "b.ts"], ["a.ts", "gone.ts"])).toBe(
		1,
	);
	expect(changedFileCount(["a.ts", "a.ts", "b.ts"])).toBe(2);
});
