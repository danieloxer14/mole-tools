import type { FileDiff } from "../ports/vcs";

type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
	kind: DiffLineKind;
	oldLine: number | null;
	newLine: number | null;
	text: string;
}

export interface DiffHunk {
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
}

type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface ParsedFileDiff {
	oldPath: string | null;
	newPath: string | null;
	status: FileStatus;
	binary: boolean;
	insertions: number;
	deletions: number;
	hunks: DiffHunk[];
}

function normalizePath(value: string): string | null {
	let path = value.trim();
	if (path === "/dev/null") return null;
	if (path.startsWith('"') && path.endsWith('"')) {
		path = path.slice(1, -1).replace(/\\([\\"])/g, "$1");
	}
	if (path.startsWith("a/") || path.startsWith("b/")) {
		path = path.slice(2);
	}
	return path || null;
}

function parseDiffHeader(line: string): [string | null, string | null] | null {
	const prefix = "diff --git ";
	if (!line.startsWith(prefix)) return null;
	const body = line.slice(prefix.length);
	if (!body.startsWith("a/")) return null;
	const separator = body.indexOf(" b/", 2);
	if (separator < 0) return null;
	return [
		normalizePath(body.slice(0, separator)),
		normalizePath(body.slice(separator + 1)),
	];
}

function parseHunkHeader(line: string): Omit<DiffHunk, "lines"> | null {
	const match = line.match(
		/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/,
	);
	if (!match) return null;
	return {
		header: line,
		oldStart: Number(match[1]),
		oldLines: Number(match[2] ?? 1),
		newStart: Number(match[3]),
		newLines: Number(match[4] ?? 1),
	};
}

function statusForPaths(
	oldPath: string | null,
	newPath: string | null,
	renamed: boolean,
): FileStatus {
	if (
		renamed ||
		(oldPath !== null && newPath !== null && oldPath !== newPath)
	) {
		return "renamed";
	}
	if (oldPath === null) return "added";
	if (newPath === null) return "deleted";
	return "modified";
}

export function parseFileDiff(file: FileDiff): ParsedFileDiff {
	if (file.statOnly || file.patch === null) {
		return {
			oldPath: file.path,
			newPath: file.path,
			status: "modified",
			binary: false,
			insertions: file.insertions,
			deletions: file.deletions,
			hunks: [],
		};
	}

	const lines = file.patch.replace(/\r\n?/g, "\n").split("\n");
	let oldPath: string | null = file.path;
	let newPath: string | null = file.path;
	let renamed = false;
	let binary = false;
	const hunks: DiffHunk[] = [];
	let currentHunk: DiffHunk | null = null;
	let oldCursor = 0;
	let newCursor = 0;

	for (const line of lines) {
		const headerPaths = parseDiffHeader(line);
		if (headerPaths) {
			[oldPath, newPath] = headerPaths;
			continue;
		}
		if (line.startsWith("rename from ")) {
			oldPath = normalizePath(line.slice("rename from ".length));
			renamed = true;
			continue;
		}
		if (line.startsWith("rename to ")) {
			newPath = normalizePath(line.slice("rename to ".length));
			renamed = true;
			continue;
		}
		if (/^Binary files? .* differ$/.test(line)) {
			binary = true;
			continue;
		}
		if (!currentHunk && line.startsWith("--- ")) {
			oldPath = normalizePath(line.slice(4).split("\t", 1)[0] ?? "");
			continue;
		}
		if (!currentHunk && line.startsWith("+++ ")) {
			newPath = normalizePath(line.slice(4).split("\t", 1)[0] ?? "");
			continue;
		}

		const hunkHeader = parseHunkHeader(line);
		if (hunkHeader) {
			currentHunk = { ...hunkHeader, lines: [] };
			hunks.push(currentHunk);
			oldCursor = hunkHeader.oldStart;
			newCursor = hunkHeader.newStart;
			continue;
		}
		if (!currentHunk) continue;
		if (line === "\\ No newline at end of file") {
			const previous = currentHunk.lines.at(-1);
			if (previous) previous.text += `\n${line}`;
			continue;
		}

		if (line.startsWith("+")) {
			currentHunk.lines.push({
				kind: "add",
				oldLine: null,
				newLine: newCursor,
				text: line.slice(1),
			});
			newCursor++;
			continue;
		}
		if (line.startsWith("-")) {
			currentHunk.lines.push({
				kind: "del",
				oldLine: oldCursor,
				newLine: null,
				text: line.slice(1),
			});
			oldCursor++;
			continue;
		}
		if (line.startsWith(" ")) {
			currentHunk.lines.push({
				kind: "context",
				oldLine: oldCursor,
				newLine: newCursor,
				text: line.slice(1),
			});
			oldCursor++;
			newCursor++;
		}
	}

	return {
		oldPath,
		newPath,
		status: statusForPaths(oldPath, newPath, renamed),
		binary,
		insertions: file.insertions,
		deletions: file.deletions,
		hunks: binary ? [] : hunks,
	};
}

export function parseFileDiffs(files: FileDiff[]): ParsedFileDiff[] {
	return files.map((file) => parseFileDiff(file));
}
