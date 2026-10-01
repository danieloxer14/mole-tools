import type {
	DiffHunk,
	DiffLine,
	ParsedFileDiff,
} from "../../../shared/diff-parse";
import type {
	ImportanceFile,
	ImportanceScore,
	ImportanceSpan,
} from "../importance";

export type { ImportanceScore } from "../importance";

export interface ImportanceRating {
	score: ImportanceScore;
	reason: string;
}

export function lineImportanceMap(
	spans: readonly ImportanceSpan[],
	hunks: readonly DiffHunk[],
): ImportanceLineMap {
	const ratings: ImportanceLineMap = new Map();
	for (const hunk of hunks) {
		for (const line of hunk.lines) {
			const oldRating =
				line.oldLine === null ? null : ratingAt(spans, "old", line.oldLine);
			const newRating =
				line.newLine === null ? null : ratingAt(spans, "new", line.newLine);
			if (oldRating !== null) ratings.set(`old:${line.oldLine}`, oldRating);
			if (newRating !== null) ratings.set(`new:${line.newLine}`, newRating);
		}
	}
	return ratings;
}

function ratingAt(
	spans: readonly ImportanceSpan[],
	side: ImportanceSpan["side"],
	line: number,
): ImportanceRating | null {
	let rating: ImportanceRating | null = null;
	for (const span of spans) {
		if (
			span.side === side &&
			span.startLine <= line &&
			line <= span.endLine &&
			(rating === null || span.score > rating.score)
		) {
			rating = span;
		}
	}
	return rating;
}

export type ImportanceLineMap = Map<string, ImportanceRating>;

export function indexedLineImportance(
	ratings: ImportanceLineMap,
	side: ImportanceSpan["side"],
	line: number | null,
): ImportanceRating | null {
	return line === null ? null : (ratings.get(`${side}:${line}`) ?? null);
}

export function indexedDiffLineImportance(
	ratings: ImportanceLineMap,
	line: DiffLine,
): ImportanceRating | null {
	if (line.kind === "del")
		return indexedLineImportance(ratings, "old", line.oldLine);
	if (line.kind === "add")
		return indexedLineImportance(ratings, "new", line.newLine);
	const oldRating = indexedLineImportance(ratings, "old", line.oldLine);
	const newRating = indexedLineImportance(ratings, "new", line.newLine);
	if (oldRating === null) return newRating;
	if (newRating === null) return oldRating;
	return oldRating.score > newRating.score ? oldRating : newRating;
}

const IMPORTANCE_PROGRESS_WEIGHTS: Record<ImportanceScore, number> = {
	1: 1,
	2: 2,
	3: 3,
	4: 5,
	5: 8,
};

type ImportanceScoreCounts = Record<ImportanceScore, number>;

function emptyImportanceScoreCounts(): ImportanceScoreCounts {
	return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function countImportanceScores(
	target: ImportanceScoreCounts,
	source: ImportanceScoreCounts,
): void {
	for (const score of [1, 2, 3, 4, 5] as const) {
		target[score] += source[score];
	}
}

export interface ImportanceReviewProgress {
	value: number;
	total: number;
	threshold: number;
}

export interface ImportanceReviewFileTotals {
	byPath: ReadonlyMap<string, ImportanceScoreCounts>;
	byScore: ImportanceScoreCounts;
}

export function importanceReviewFileTotals(
	diff: readonly ParsedFileDiff[],
	files: readonly ImportanceFile[],
): ImportanceReviewFileTotals {
	const spansByPath = new Map<string, ImportanceSpan[]>();
	for (const file of files) {
		const spans = spansByPath.get(file.path);
		if (spans) spans.push(...file.spans);
		else spansByPath.set(file.path, [...file.spans]);
	}

	const byPath = new Map<string, ImportanceScoreCounts>();
	const byScore = emptyImportanceScoreCounts();
	const seen = new Set<string>();

	for (const file of diff) {
		const key = file.newPath ?? file.oldPath;
		if (!key || seen.has(key)) continue;
		seen.add(key);

		const spans = spansByPath.get(key);
		if (!spans) continue;
		const ratings = lineImportanceMap(spans, file.hunks);
		const fileCounts = emptyImportanceScoreCounts();
		for (const hunk of file.hunks) {
			for (const line of hunk.lines) {
				if (line.kind !== "add" && line.kind !== "del") continue;
				const rating = indexedDiffLineImportance(ratings, line);
				if (rating === null) continue;
				fileCounts[rating.score] += 1;
			}
		}

		byPath.set(key, fileCounts);
		countImportanceScores(byScore, fileCounts);
	}

	return { byPath, byScore };
}

export function importanceReviewProgressForViewedFiles(
	fileTotals: ImportanceReviewFileTotals,
	viewedFiles: readonly string[],
): ImportanceReviewProgress {
	const viewed = new Set(viewedFiles);
	const viewedByScore = emptyImportanceScoreCounts();
	for (const [path, counts] of fileTotals.byPath) {
		if (viewed.has(path)) countImportanceScores(viewedByScore, counts);
	}

	let scoredLines = 0;
	let value = 0;
	for (const score of [1, 2, 3, 4, 5] as const) {
		const totalAtScore = fileTotals.byScore[score];
		scoredLines += totalAtScore;
		if (totalAtScore > 0) {
			value +=
				IMPORTANCE_PROGRESS_WEIGHTS[score] *
				(viewedByScore[score] / totalAtScore);
		}
	}

	return scoredLines === 0
		? { value: 0, total: 0, threshold: 0 }
		: { value, total: 18, threshold: 13 };
}

export function importanceReviewProgress(
	diff: readonly ParsedFileDiff[],
	files: readonly ImportanceFile[],
	viewedFiles: readonly string[],
): ImportanceReviewProgress {
	return importanceReviewProgressForViewedFiles(
		importanceReviewFileTotals(diff, files),
		viewedFiles,
	);
}

export function importanceProgressColor(ratio: number): string {
	if (!Number.isFinite(ratio) || ratio < 0) ratio = 0;
	if (ratio >= 1) return "var(--color-importance-5)";
	const scaled = ratio * 4;
	const index = Math.floor(scaled);
	const progress = scaled - index;
	return `color-mix(in oklch, var(--color-importance-${index + 1}) ${Math.round((1 - progress) * 100)}%, var(--color-importance-${index + 2}))`;
}

export function importanceTitle(score: ImportanceScore): string {
	return `Importance ${score}/5 (${IMPORTANCE_LABELS[score]})`;
}

export const IMPORTANCE_LABELS: Record<ImportanceScore, string> = {
	1: "Skip",
	2: "Low",
	3: "Moderate",
	4: "High",
	5: "Critical",
};

export const IMPORTANCE_BG_CLASS: Record<ImportanceScore, string> = {
	1: "bg-importance-1",
	2: "bg-importance-2",
	3: "bg-importance-3",
	4: "bg-importance-4",
	5: "bg-importance-5",
};

export function fileImportanceMap(
	files: readonly ImportanceFile[],
): Map<string, ImportanceRating> {
	const ratings = new Map<string, ImportanceRating>();
	for (const file of files) {
		for (const span of file.spans) {
			const current = ratings.get(file.path);
			if (current === undefined || span.score > current.score) {
				ratings.set(file.path, span);
			}
		}
	}
	return ratings;
}
