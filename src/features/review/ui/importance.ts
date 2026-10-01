import type {
	DiffHunk,
	DiffLine,
	ParsedFileDiff,
} from "../../../shared/diff-parse";
import { IMPORTANCE_LABELS } from "../../../shared/importance-labels";
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

export interface ImportanceSpanRef {
	fileIndex: number;
	spanIndex: number;
}

export type ContestableImportanceSpan = ImportanceSpan & ImportanceSpanRef;

export function lineImportanceMap<S extends ImportanceSpan = ImportanceSpan>(
	spans: readonly S[],
	hunks: readonly DiffHunk[],
): ImportanceLineMap<S> {
	const ratings: ImportanceLineMap<S> = new Map();
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

function ratingAt<S extends ImportanceSpan>(
	spans: readonly S[],
	side: ImportanceSpan["side"],
	line: number,
): S | null {
	let rating: S | null = null;
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

export type ImportanceLineMap<S extends ImportanceSpan = ImportanceSpan> = Map<
	string,
	S
>;

export function indexedLineImportance<
	S extends ImportanceSpan = ImportanceSpan,
>(
	ratings: ImportanceLineMap<S>,
	side: ImportanceSpan["side"],
	line: number | null,
): S | null {
	return line === null ? null : (ratings.get(`${side}:${line}`) ?? null);
}

export function indexedDiffLineImportance<
	S extends ImportanceSpan = ImportanceSpan,
>(ratings: ImportanceLineMap<S>, line: DiffLine): S | null {
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

const IMPORTANCE_WEIGHTS: Record<ImportanceScore, number> = {
	1: 0.5,
	2: 0.75,
	3: 1,
	4: 1.25,
	5: 1.5,
};

export interface ImportanceReviewProgress {
	value: number;
	total: number;
	threshold: number;
}

export interface ImportanceReviewFileTotals {
	byPath: ReadonlyMap<string, { total: number; threshold: number }>;
	total: number;
	threshold: number;
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

	const byPath = new Map<string, { total: number; threshold: number }>();
	const seen = new Set<string>();
	let total = 0;
	let threshold = 0;

	for (const file of diff) {
		const key = file.newPath ?? file.oldPath;
		if (!key || seen.has(key)) continue;
		seen.add(key);

		const spans = spansByPath.get(key);
		if (!spans) continue;
		const ratings = lineImportanceMap(spans, file.hunks);
		let fileTotal = 0;
		let fileThreshold = 0;
		for (const hunk of file.hunks) {
			for (const line of hunk.lines) {
				if (line.kind !== "add" && line.kind !== "del") continue;
				const rating = indexedDiffLineImportance(ratings, line);
				if (rating === null) continue;
				const weight = IMPORTANCE_WEIGHTS[rating.score];
				fileTotal += weight;
				if (rating.score >= 3) fileThreshold += weight;
			}
		}

		byPath.set(key, { total: fileTotal, threshold: fileThreshold });
		total += fileTotal;
		threshold += fileThreshold;
	}

	return { byPath, total, threshold: Math.max(threshold, total / 2) };
}

export function importanceReviewProgressForViewedFiles(
	fileTotals: ImportanceReviewFileTotals,
	viewedFiles: readonly string[],
): ImportanceReviewProgress {
	const viewed = new Set(viewedFiles);
	let value = 0;
	for (const [path, totals] of fileTotals.byPath) {
		if (viewed.has(path)) value += totals.total;
	}
	return { value, total: fileTotals.total, threshold: fileTotals.threshold };
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
