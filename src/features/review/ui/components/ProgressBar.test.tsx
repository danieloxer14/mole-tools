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

test("renders proportional fill width", () => {
	const html = renderToStaticMarkup(
		<ProgressBar label="Coverage" value={2} max={4} />,
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
