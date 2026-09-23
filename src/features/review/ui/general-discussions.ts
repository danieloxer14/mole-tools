import type { HostDiscussion, HostNote } from "../../../ports/git-host";

const HIDDEN_SYSTEM_NOTE_PATTERNS: readonly RegExp[] = [
	/^added \d+ commits?\b/i,
	/^changed title from\b/i,
	/^changed the description\b/i,
	/^mentioned in merge request\b/i,
	/^mentioned in commit\b/i,
	/^marked this merge request as\b/i,
	/^assigned to\b/i,
	/^requested review from\b/i,
];

function isHiddenNote(note: HostNote): boolean {
	return (
		note.system &&
		HIDDEN_SYSTEM_NOTE_PATTERNS.some((pattern) =>
			pattern.test(note.body.trimStart()),
		)
	);
}

/**
 * General discussions for the chat column: unpositioned only, with the
 * GitLab system activity notes listed in issue #50 removed; discussions left
 * with no notes are dropped.
 */
export function generalDiscussions(
	discussions: readonly HostDiscussion[],
): HostDiscussion[] {
	const general: HostDiscussion[] = [];

	for (const discussion of discussions) {
		if (discussion.position !== null) {
			continue;
		}

		const notes = discussion.notes.filter((note) => !isHiddenNote(note));
		if (notes.length === 0) {
			continue;
		}

		general.push(
			notes.length === discussion.notes.length
				? discussion
				: { ...discussion, notes },
		);
	}

	return general;
}
