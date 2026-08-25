import { PortError } from "../core/errors";
import type { DiffRefs } from "../ports/git-host";
import type { DiffLine, ParsedFileDiff } from "./diff-parse";

export interface LineSelection {
	path: string;
	side: "new" | "old";
	startLine: number;
	endLine: number;
}

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

export function lineCode(
	filePath: string,
	oldLine: number | null,
	newLine: number | null,
): string {
	const hasher = new Bun.CryptoHasher("sha1");
	hasher.update(filePath);
	return `${hasher.digest("hex")}_${oldLine ?? 0}_${newLine ?? 0}`;
}

function invalidSelection(message: string): never {
	throw new PortError(`Invalid GitLab line selection: ${message}`);
}
function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isValidLine(value: unknown): value is number | null {
	return value === null || (Number.isInteger(value) && value > 0);
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

function validatePositionShape(position: GitLabPositionPayload): void {
	if (!position || typeof position !== "object") {
		invalidSelection("position is missing");
	}
	if (position.position_type !== "text") {
		invalidSelection("position_type must be text");
	}
	if (
		!isNonEmptyString(position.base_sha) ||
		!isNonEmptyString(position.start_sha) ||
		!isNonEmptyString(position.head_sha)
	) {
		invalidSelection("position refs must be non-empty strings");
	}
	if (
		!(position.old_path === null || isNonEmptyString(position.old_path)) ||
		!(position.new_path === null || isNonEmptyString(position.new_path))
	) {
		invalidSelection("position paths must be non-empty strings or null");
	}
	if (!isValidLine(position.old_line) || !isValidLine(position.new_line)) {
		invalidSelection("position lines must be positive integers or null");
	}
	if ((position.old_line === null) === (position.new_line === null)) {
		invalidSelection("position must anchor exactly one side");
	}

	if (position.line_range === undefined) return;
	if (!position.line_range || typeof position.line_range !== "object") {
		invalidSelection("line range is malformed");
	}
	const start = validateRangeEntry(position.line_range.start, "start");
	const end = validateRangeEntry(position.line_range.end, "end");
	if (start.type !== end.type) {
		invalidSelection("range cannot span new and old sides");
	}
	const side = position.new_line !== null ? "new" : "old";
	if (start.type !== side) {
		invalidSelection("range cannot span new and old sides");
	}
	const startLine = side === "new" ? start.new_line : start.old_line;
	const endLine = side === "new" ? end.new_line : end.old_line;
	if (startLine === null || endLine === null) {
		invalidSelection("position range is missing its selected side line");
	}
	if (startLine > endLine) {
		invalidSelection(`range ${startLine}-${endLine} is reversed`);
	}
}

function validateRangeEntry(
	entry: unknown,
	label: "start" | "end",
): GitLabLineRangeEntry {
	if (!entry || typeof entry !== "object") {
		return invalidSelection(`line range ${label} entry is missing`);
	}
	const candidate = entry as Partial<GitLabLineRangeEntry>;
	if (
		!isNonEmptyString(candidate.line_code) ||
		(candidate.type !== "new" && candidate.type !== "old") ||
		!isValidLine(candidate.old_line) ||
		!isValidLine(candidate.new_line)
	) {
		return invalidSelection(`line range ${label} entry is malformed`);
	}
	return {
		line_code: candidate.line_code,
		type: candidate.type,
		old_line: candidate.old_line,
		new_line: candidate.new_line,
	};
}

function lineNumber(
	line: DiffLine,
	side: LineSelection["side"],
): number | null {
	return side === "new" ? line.newLine : line.oldLine;
}

function validateSelection(
	selection: LineSelection,
	file: ParsedFileDiff,
): DiffLine[] {
	if (
		!selection ||
		typeof selection.path !== "string" ||
		selection.path.length === 0
	) {
		return invalidSelection("path must be non-empty");
	}
	if (selection.side !== "new" && selection.side !== "old") {
		return invalidSelection(`unsupported side ${String(selection.side)}`);
	}
	if (!Number.isInteger(selection.startLine) || selection.startLine <= 0) {
		return invalidSelection(
			`start line ${String(selection.startLine)} must be positive`,
		);
	}
	if (!Number.isInteger(selection.endLine) || selection.endLine <= 0) {
		return invalidSelection(
			`end line ${String(selection.endLine)} must be positive`,
		);
	}
	if (selection.endLine < selection.startLine) {
		return invalidSelection(
			`range ${selection.startLine}-${selection.endLine} is reversed`,
		);
	}

	const expectedPath = selection.side === "new" ? file.newPath : file.oldPath;
	if (expectedPath === null || selection.path !== expectedPath) {
		return invalidSelection(
			`path ${JSON.stringify(selection.path)} does not match ${selection.side} path ${JSON.stringify(expectedPath)}`,
		);
	}

	const linesByNumber = new Map<number, DiffLine>();
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			const number = lineNumber(line, selection.side);
			if (number !== null) linesByNumber.set(number, line);
		}
	}

	const selected: DiffLine[] = [];
	for (
		let number = selection.startLine;
		number <= selection.endLine;
		number++
	) {
		const line = linesByNumber.get(number);
		if (!line) {
			return invalidSelection(
				`line ${number} is not present on ${selection.side} side of ${selection.path}`,
			);
		}
		selected.push(line);
	}
	return selected;
}

function rangeEntry(
	filePath: string,
	side: LineSelection["side"],
	line: DiffLine,
): GitLabLineRangeEntry {
	return {
		line_code: lineCode(filePath, line.oldLine, line.newLine),
		type: side,
		old_line: line.oldLine,
		new_line: line.newLine,
	};
}

export function buildPosition(
	selection: LineSelection,
	file: ParsedFileDiff,
	refs: DiffRefs,
): GitLabPositionPayload {
	validateRefs(refs);
	const selected = validateSelection(selection, file);
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
			start: rangeEntry(filePath, selection.side, first),
			end: rangeEntry(filePath, selection.side, last),
		};
	}
	return payload;
}

function sameRangeEntry(
	actual: GitLabLineRangeEntry,
	expected: GitLabLineRangeEntry,
): boolean {
	return (
		actual.line_code === expected.line_code &&
		actual.type === expected.type &&
		actual.old_line === expected.old_line &&
		actual.new_line === expected.new_line
	);
}

export function validatePosition(
	position: GitLabPositionPayload,
	file: ParsedFileDiff,
	refs?: DiffRefs,
): GitLabPositionPayload {
	validatePositionShape(position);
	const positionRefs: DiffRefs = {
		baseSha: position.base_sha,
		startSha: position.start_sha,
		headSha: position.head_sha,
	};
	validateRefs(positionRefs);
	if (refs) {
		validateRefs(refs);
		if (
			position.base_sha !== refs.baseSha ||
			position.start_sha !== refs.startSha ||
			position.head_sha !== refs.headSha
		) {
			return invalidSelection(
				`position refs ${position.base_sha}/${position.start_sha}/${position.head_sha} do not match current diff refs ${refs.baseSha}/${refs.startSha}/${refs.headSha}`,
			);
		}
	}

	const side = position.new_line !== null ? "new" : "old";
	const range = position.line_range;
	const startLine = range
		? side === "new"
			? range.start.new_line
			: range.start.old_line
		: position[side === "new" ? "new_line" : "old_line"];
	const endLine = range
		? side === "new"
			? range.end.new_line
			: range.end.old_line
		: position[side === "new" ? "new_line" : "old_line"];
	if (startLine === null || endLine === null) {
		return invalidSelection("position range is missing its selected side line");
	}

	const expected = buildPosition(
		{
			path: side === "new" ? (file.newPath ?? "") : (file.oldPath ?? ""),
			side,
			startLine,
			endLine,
		},
		file,
		refs ?? positionRefs,
	);
	const actualRange = position.line_range;
	const expectedRange = expected.line_range;
	const rangeMatches =
		actualRange === undefined && expectedRange === undefined
			? true
			: actualRange !== undefined &&
				expectedRange !== undefined &&
				sameRangeEntry(actualRange.start, expectedRange.start) &&
				sameRangeEntry(actualRange.end, expectedRange.end);
	if (
		position.position_type !== expected.position_type ||
		position.base_sha !== expected.base_sha ||
		position.start_sha !== expected.start_sha ||
		position.head_sha !== expected.head_sha ||
		position.old_path !== expected.old_path ||
		position.new_path !== expected.new_path ||
		position.old_line !== expected.old_line ||
		position.new_line !== expected.new_line ||
		!rangeMatches
	) {
		return invalidSelection("position does not match parsed diff lines");
	}
	return expected;
}
