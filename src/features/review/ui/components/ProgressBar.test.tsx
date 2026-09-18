import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgressBar } from "./ProgressBar";

test("renders progressbar accessibility attributes", () => {
	const html = renderToStaticMarkup(
		<ProgressBar label="Viewed file coverage" value={2} max={4} />,
	);

	expect(html).toContain('role="progressbar"');
	expect(html).toContain('aria-label="Viewed file coverage"');
	expect(html).toContain('aria-valuemin="0"');
	expect(html).toContain('aria-valuemax="4"');
	expect(html).toContain('aria-valuenow="2"');
});

test("bounds and right-aligns the progress track", () => {
	const html = renderToStaticMarkup(
		<ProgressBar label="Coverage" value={2} max={4} />,
	);

	expect(html).toContain("max-w-xs");
	expect(html).toContain("ml-auto");
});

test("renders proportional fill width", () => {
	const html = renderToStaticMarkup(
		<ProgressBar label="Coverage" value={2} max={4} />,
	);

	expect(html).toContain(
		'class="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"',
	);
	expect(html).toContain('style="width:50%"');
});

test("renders zero width for empty range", () => {
	const html = renderToStaticMarkup(
		<ProgressBar label="Coverage" value={0} max={0} />,
	);

	expect(html).toContain('style="width:0%"');
});

test("renders full width when value reaches maximum", () => {
	const html = renderToStaticMarkup(
		<ProgressBar label="Coverage" value={4} max={4} />,
	);

	expect(html).toContain('style="width:100%"');
});

test("clamps over-range values for ARIA and fill", () => {
	const html = renderToStaticMarkup(
		<ProgressBar label="Coverage" value={9} max={4} />,
	);

	expect(html).toContain('aria-valuemax="4"');
	expect(html).toContain('aria-valuenow="4"');
	expect(html).toContain('style="width:100%"');
});

test("normalizes invalid values to an empty progress range", () => {
	const invalidValue = renderToStaticMarkup(
		<ProgressBar label="Coverage" value={Number.NaN} max={4} />,
	);
	expect(invalidValue).toContain('aria-valuemax="4"');
	expect(invalidValue).toContain('aria-valuenow="0"');
	expect(invalidValue).toContain('style="width:0%"');

	const invalidMax = renderToStaticMarkup(
		<ProgressBar label="Coverage" value={2} max={Number.NaN} />,
	);
	expect(invalidMax).toContain('aria-valuemax="0"');
	expect(invalidMax).toContain('aria-valuenow="0"');
	expect(invalidMax).toContain('style="width:0%"');
});
