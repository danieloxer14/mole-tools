import { PortError } from "../../core/errors";
import type { DiffRefs } from "../../ports/git-host";
import type { DiffLine, ParsedFileDiff } from "../../shared/diff-parse";
import {
	type DiffLineSelection,
	selectDiffLines,
} from "../../shared/diff-selection";

export interface GitLabLineRangeEntry {
	line_code: string;
	type: "new" | "old";
	old_line: number | null;
	new_line: number | null;
}

export interface GitLabPositionPayload {
	position_type: "text";
	base_sha: string;
	start_sha: string;
	head_sha: string;
	old_path: string | null;
	new_path: string | null;
	old_line: number | null;
	new_line: number | null;
	line_range?: {
		start: GitLabLineRangeEntry;
		end: GitLabLineRangeEntry;
	};
}

/** Builds GitLab line code from raw old/new diff cursor positions. */
function lineCode(filePath: string, oldLine: number, newLine: number): string {
	const hasher = new Bun.CryptoHasher("sha1");
	hasher.update(filePath);
	return `${hasher.digest("hex")}_${oldLine}_${newLine}`;
}

function invalidSelection(message: string): never {
	throw new PortError(`Invalid diff line selection: ${message}`);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function validateRefs(refs: DiffRefs): void {
	if (
		!refs ||
		!isNonEmptyString(refs.baseSha) ||
		!isNonEmptyString(refs.startSha) ||
		!isNonEmptyString(refs.headSha)
	) {
		invalidSelection("diff refs must be non-empty strings");
	}
}

function rawLinePosition(
	file: ParsedFileDiff,
	target: DiffLine,
): { oldLine: number; newLine: number } {
	for (const hunk of file.hunks) {
		let oldLine = hunk.oldStart;
		let newLine = hunk.newStart;

		for (const line of hunk.lines) {
			if (line === target) {
				return { oldLine, newLine };
			}

			if (line.kind !== "add") {
				oldLine++;
			}

			if (line.kind !== "del") {
				newLine++;
			}
		}
	}

	return invalidSelection("selected line is not present in parsed diff");
}

function rangeEntry(
	filePath: string,
	side: DiffLineSelection["side"],
	line: DiffLine,
	file: ParsedFileDiff,
): GitLabLineRangeEntry {
	const raw = rawLinePosition(file, line);
	return {
		line_code: lineCode(filePath, raw.oldLine, raw.newLine),
		type: side,
		old_line: line.oldLine,
		new_line: line.newLine,
	};
}

export function buildPosition(
	selection: DiffLineSelection,
	file: ParsedFileDiff,
	refs: DiffRefs,
): GitLabPositionPayload {
	validateRefs(refs);
	const selected = selectDiffLines(selection, file);
	const first = selected[0];
	const last = selected[selected.length - 1];
	if (!first || !last) {
		return invalidSelection("range contains no lines");
	}

	const filePath = file.newPath ?? file.oldPath;
	if (filePath === null) {
		return invalidSelection("diff has no path");
	}

	const payload: GitLabPositionPayload = {
		position_type: "text",
		base_sha: refs.baseSha,
		start_sha: refs.startSha,
		head_sha: refs.headSha,
		old_path: file.oldPath,
		new_path: file.newPath,
		old_line: selection.side === "old" ? last.oldLine : null,
		new_line: selection.side === "new" ? last.newLine : null,
	};

	if (selection.endLine > selection.startLine) {
		payload.line_range = {
			start: rangeEntry(filePath, selection.side, first, file),
			end: rangeEntry(filePath, selection.side, last, file),
		};
	}

	return payload;
}
