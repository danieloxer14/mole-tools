import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportanceProgressBar } from "./ImportanceProgressBar";

function render(value: number, total: number, threshold: number): string {
	return renderToStaticMarkup(
		<ImportanceProgressBar progress={{ value, total, threshold }} />,
	);
}

test("renders weighted importance progress and fixed review threshold", () => {
	const html = render(4, 18, 13);
	expect(html).toContain('role="progressbar"');
	expect(html).toContain('aria-label="Importance review progress"');
	expect(html).toContain('aria-valuenow="4"');
	expect(html).toContain('aria-valuemax="18"');
	expect(html).toContain('aria-valuetext="22% reviewed, target 72%"');
	expect(html).toContain('class="importance-progress-marker"');
	expect(html).toContain('style="left:72.22222222222221%"');
});

test("marks target reached only at or above threshold and clamps visible value", () => {
	expect(render(12.99, 18, 13)).toContain('data-reached="false"');
	const reached = render(13, 18, 13);
	expect(reached).toContain('data-reached="true"');
	expect(reached).toContain("importance-progress-flame");
	const over = render(19, 18, 13);
	expect(over).toContain('aria-valuenow="18"');
	expect(over).toContain('aria-valuetext="100% reviewed, target 72%"');
});

test("omits empty progress and reports percentages without a threshold", () => {
	expect(render(0, 0, 0)).toBe("");
	expect(render(3, 6, 0)).toContain('aria-valuetext="50% reviewed"');
	expect(render(3, 6, 0)).not.toContain("importance-progress-marker");
});
