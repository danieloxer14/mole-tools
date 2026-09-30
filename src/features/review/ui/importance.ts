import type { DiffHunk, DiffLine } from "../../../shared/diff-parse";
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
