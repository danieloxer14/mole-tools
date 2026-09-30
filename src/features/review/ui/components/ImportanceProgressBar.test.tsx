import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportanceProgressBar } from "./ImportanceProgressBar";

function render(value: number, total: number, threshold: number) {
	return renderToStaticMarkup(
		<ImportanceProgressBar progress={{ value, total, threshold }} />,
	);
}

test("renders importance progress accessibility and target details", () => {
	const withTarget = render(3, 6, 1.5);
	expect(withTarget).toContain("Importance");
	expect(withTarget).toContain("50%</span>");
	expect(withTarget).toContain('role="progressbar"');
	expect(withTarget).toContain('aria-label="Importance review progress"');
	expect(withTarget).toContain('aria-valuemin="0"');
	expect(withTarget).toContain('aria-valuemax="6"');
	expect(withTarget).toContain('aria-valuenow="3"');
	expect(withTarget).toContain('aria-valuetext="50% reviewed, target 25%"');

	const withoutTarget = render(3, 6, 0);
	expect(withoutTarget).toContain('aria-valuetext="50% reviewed"');
});

test("renders proportional fill and threshold marker", () => {
	const html = render(3, 6, 1.5);
	expect(html).toContain('style="width:50%;background-color:');
	expect(html).toContain('class="importance-progress-marker"');
	expect(html).toContain('title="Target: all High and Critical changes"');
	expect(html).toContain('style="left:25%"');

	const withoutMarker = render(3, 6, 0);
	expect(withoutMarker).not.toContain("importance-progress-marker");
});

test("renders flame only after reaching a positive threshold", () => {
	const belowTarget = render(1, 6, 1.5);
	expect(belowTarget).toContain('data-reached="false"');
	expect(belowTarget).not.toContain("importance-progress-flame");

	const reached = render(2, 6, 1.5);
	expect(reached).toContain('data-reached="true"');
	expect(reached).toContain('class="importance-progress-flame"');
	expect(reached).toContain("background-color:var(--color-importance-5)");
});

test("without threshold, reaches only at the total", () => {
	expect(render(5, 6, 0)).toContain('data-reached="false"');
	const complete = render(6, 6, 0);
	expect(complete).toContain('data-reached="true"');
	expect(complete).toContain("importance-progress-flame");
});

test("renders empty markup when total is zero or non-finite", () => {
	expect(render(0, 0, 0)).toBe("");
	expect(render(0, Number.NaN, 0)).toBe("");
	expect(render(0, Number.POSITIVE_INFINITY, 0)).toBe("");
});

test("clamps over-range values and never overstates progress", () => {
	const overRange = render(10, 6, 0);
	expect(overRange).toContain('aria-valuenow="6"');
	expect(overRange).toContain(
		'style="width:100%;background-color:var(--color-importance-5)"',
	);
	expect(overRange).toContain('aria-valuetext="100% reviewed"');

	const rounded = render(1, 3, 0);
	expect(rounded).toContain('aria-valuetext="33% reviewed"');
	expect(rounded).toContain("33%</span>");
	const nearlyComplete = render(199, 200, 0);
	expect(nearlyComplete).toContain('aria-valuetext="99% reviewed"');
	expect(nearlyComplete).toContain("99%</span>");
	const nearlyAtTarget = render(25.8, 100, 25.9);
	expect(nearlyAtTarget).toContain('aria-valuetext="25% reviewed, target 26%"');
	const atTarget = render(25.9, 100, 25.9);
	expect(atTarget).toContain('aria-valuetext="26% reviewed, target 26%"');
});
