import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ParsedFileDiff } from "../../../../shared/diff-parse";
import type { ImportanceFile, ImportanceScore } from "../../importance";
import {
	importanceReviewFileTotals,
	importanceReviewProgressForViewedFiles,
} from "../importance";
import { ImportanceProgressBar } from "./ImportanceProgressBar";

test("renders calculator progress through threshold and unmark transitions", () => {
	const scores = [5, 3, 1] as const;
	const diff: ParsedFileDiff[] = scores.map((score) => {
		const path = String(score);
		return {
			oldPath: path,
			newPath: path,
			status: "modified",
			binary: false,
			insertions: 1,
			deletions: 0,
			hunks: [
				{
					header: "@@",
					oldStart: 0,
					oldLines: 0,
					newStart: 1,
					newLines: 1,
					lines: [{ kind: "add", oldLine: null, newLine: 1, text: "line" }],
				},
			],
		};
	});
	const files: ImportanceFile[] = scores.map((score) => ({
		path: String(score),
		spans: [
			{
				side: "new",
				startLine: 1,
				endLine: 1,
				score: score as ImportanceScore,
				reason: "test",
			},
		],
	}));
	const totals = importanceReviewFileTotals(diff, files);
	const cases = [
		{ viewed: [] as string[], value: 0, percent: 0, reached: false },
		{ viewed: ["5"], value: 13, percent: 68, reached: true },
		{ viewed: ["5", "3", "1"], value: 19, percent: 100, reached: true },
		{ viewed: ["3", "1"], value: 6, percent: 32, reached: false },
	];

	for (const { viewed, value, percent, reached } of cases) {
		const progress = importanceReviewProgressForViewedFiles(totals, viewed);
		const html = renderToStaticMarkup(
			<ImportanceProgressBar progress={progress} />,
		);
		expect(progress).toEqual({ value, total: 19, threshold: 13 });
		expect(html).toContain('role="progressbar"');
		expect(html).toContain(`aria-valuenow="${value}"`);
		expect(html).toContain('aria-valuemax="19"');
		expect(html).toContain(`aria-valuetext="${percent}% reviewed, target 68%"`);
		expect(html).toContain(`data-reached="${reached}"`);
	}

	const emptyProgress = importanceReviewProgressForViewedFiles(
		importanceReviewFileTotals([], []),
		[],
	);
	expect(
		renderToStaticMarkup(<ImportanceProgressBar progress={emptyProgress} />),
	).toBe("");
});
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
