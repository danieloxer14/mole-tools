import { PortError } from "../core/errors";
import type { DiffLine, ParsedFileDiff } from "./diff-parse";

export interface DiffLineSelection {
	path: string;
	side: "new" | "old";
	startLine: number;
	endLine: number;
}

function invalidSelection(message: string): never {
	throw new PortError(`Invalid diff line selection: ${message}`);
}

function lineNumber(
	line: DiffLine,
	side: DiffLineSelection["side"],
): number | null {
	return side === "new" ? line.newLine : line.oldLine;
}

/** Returns selected diff lines in order; throws PortError("Invalid diff line selection: …"). */
export function selectDiffLines(
	selection: DiffLineSelection,
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
