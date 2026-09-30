import type { DiffHunk, DiffLine } from "../../../shared/diff-parse";
import type {
	ImportanceFile,
	ImportanceScore,
	ImportanceSpan,
} from "../importance";

export type { ImportanceScore } from "../importance";

export function lineImportanceMap(
	spans: readonly ImportanceSpan[],
	hunks: readonly DiffHunk[],
): ImportanceLineMap {
	const scores: ImportanceLineMap = new Map();
	for (const hunk of hunks) {
		for (const line of hunk.lines) {
			const oldScore =
				line.oldLine === null ? null : scoreAt(spans, "old", line.oldLine);
			const newScore =
				line.newLine === null ? null : scoreAt(spans, "new", line.newLine);
			if (oldScore !== null) scores.set(`old:${line.oldLine}`, oldScore);
			if (newScore !== null) scores.set(`new:${line.newLine}`, newScore);
		}
	}
	return scores;
}

function scoreAt(
	spans: readonly ImportanceSpan[],
	side: ImportanceSpan["side"],
	line: number,
): ImportanceScore | null {
	let score: ImportanceScore | null = null;
	for (const span of spans) {
		if (
			span.side === side &&
			span.startLine <= line &&
			line <= span.endLine &&
			(score === null || span.score > score)
		) {
			score = span.score;
		}
	}
	return score;
}

export type ImportanceLineMap = Map<string, ImportanceScore>;

export function indexedLineImportance(
	scores: ImportanceLineMap,
	side: ImportanceSpan["side"],
	line: number | null,
): ImportanceScore | null {
	return line === null ? null : (scores.get(`${side}:${line}`) ?? null);
}

export function indexedDiffLineImportance(
	scores: ImportanceLineMap,
	line: DiffLine,
): ImportanceScore | null {
	if (line.kind === "del")
		return indexedLineImportance(scores, "old", line.oldLine);
	if (line.kind === "add")
		return indexedLineImportance(scores, "new", line.newLine);
	const oldScore = indexedLineImportance(scores, "old", line.oldLine);
	const newScore = indexedLineImportance(scores, "new", line.newLine);
	if (oldScore === null) return newScore;
	if (newScore === null) return oldScore;
	return oldScore > newScore ? oldScore : newScore;
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
): Map<string, ImportanceScore> {
	const scores = new Map<string, ImportanceScore>();
	for (const file of files) {
		for (const span of file.spans) {
			const current = scores.get(file.path);
			scores.set(
				file.path,
				current === undefined || span.score > current ? span.score : current,
			);
		}
	}
	return scores;
}
