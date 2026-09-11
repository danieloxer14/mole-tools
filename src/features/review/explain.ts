import type { HostDiscussion } from "../../ports/git-host";
import type { DiffLine, ParsedFileDiff } from "../../shared/diff-parse";
import { deriveChatTitle } from "./state";

/** Lines kept on each side of the anchored line in the diff excerpt. */
export const EXPLAIN_CONTEXT_RADIUS = 10;
export const NO_EXCERPT = "No diff excerpt available for this comment.";

interface Anchor {
	path: string;
	side: "new" | "old";
	line: number | null;
}

/**
 * Same path/side/line choice as the review UI's discussion label: a discussion
 * anchors on the new side whenever it carries a new line, else on the old side.
 */
function resolveAnchor(position: HostDiscussion["position"]): Anchor | null {
	if (!position) return null;
	const side = position.newLine !== null ? "new" : "old";
	return {
		path: position.newPath ?? position.oldPath ?? "(unknown file)",
		side,
		line: side === "new" ? position.newLine : position.oldLine,
	};
}

/** "Explain: <excerpt>" | "Explain: <path>:<line>" | "Explain comment" (D3). */
export function explainChatTitle(discussion: HostDiscussion): string {
	const note = discussion.notes.find(
		(candidate) => !candidate.system && candidate.body.trim().length > 0,
	);
	if (note) return `Explain: ${deriveChatTitle(note.body)}`;
	const anchor = resolveAnchor(discussion.position);
	if (anchor) return `Explain: ${anchor.path}:${anchor.line ?? "unknown"}`;
	return "Explain comment";
}

function excerptMarker(kind: DiffLine["kind"]): string {
	if (kind === "add") return "+";
	if (kind === "del") return "-";
	return " ";
}

function renderExcerptLine(line: DiffLine, isAnchor: boolean): string {
	const oldLine = line.oldLine ?? "";
	const newLine = line.newLine ?? "";
	return `${isAnchor ? "> " : "  "}${oldLine}\t${newLine}\t${excerptMarker(line.kind)}${line.text}`;
}

/**
 * Lines within `radius` of the anchor on the anchored side, or null when
 * unpositioned/unmatched (D7). `diffs` is ordered by preference: the first set
 * that contains the file and yields at least one line wins.
 */
export function discussionDiffExcerpt(
	discussion: HostDiscussion,
	diffs: readonly (readonly ParsedFileDiff[])[],
	radius: number = EXPLAIN_CONTEXT_RADIUS,
): string | null {
	const position = discussion.position;
	const anchor = resolveAnchor(position);
	if (!position || !anchor || anchor.line === null) return null;
	const anchorLine = anchor.line;
	for (const set of diffs) {
		const file = set.find((candidate) =>
			anchor.side === "new"
				? candidate.newPath === position.newPath
				: candidate.oldPath === position.oldPath,
		);
		if (!file) continue;
		const rows: string[] = [];
		for (const hunk of file.hunks) {
			for (const line of hunk.lines) {
				const sideLine = anchor.side === "new" ? line.newLine : line.oldLine;
				if (sideLine === null || Math.abs(sideLine - anchorLine) > radius) {
					continue;
				}
				rows.push(renderExcerptLine(line, sideLine === anchorLine));
			}
		}
		if (rows.length > 0) return rows.join("\n");
	}
	return null;
}

/** prefix + "## Comment" block + "## Diff excerpt" block (D6). */
export function buildExplainMessage(input: {
	prefix: string;
	discussion: HostDiscussion;
	diffs: readonly (readonly ParsedFileDiff[])[];
}): string {
	const { prefix, discussion, diffs } = input;
	const anchor = resolveAnchor(discussion.position);
	const status = discussion.resolved ? "Resolved" : "Unresolved";
	const statusLine = anchor
		? `${status} discussion at ${anchor.path}:${anchor.side}:${anchor.line ?? "unknown"}`
		: `${status} general MR discussion (no diff position)`;
	const noteParagraphs = discussion.notes
		.filter((note) => !note.system)
		.map((note) => `${note.author} (${note.createdAt}):\n${note.body}`);
	const commentBlock = [
		`## Comment\n${statusLine}`,
		...(noteParagraphs.length > 0 ? noteParagraphs : ["(no comment text)"]),
	].join("\n\n");
	const excerptBlock = `## Diff excerpt\n${discussionDiffExcerpt(discussion, diffs) ?? NO_EXCERPT}`;
	return [prefix.trim(), commentBlock, excerptBlock].join("\n\n");
}
