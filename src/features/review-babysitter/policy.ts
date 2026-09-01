import type { ReviewBabysitterConfig } from "../../adapters/config/schema";
import type {
	HostDiscussion,
	MrApprovalState,
	MrAutoApprovalState,
} from "../../ports/git-host";
import type { FileDiff } from "../../ports/vcs";

/**
 * All data required to make one deterministic pre-assessment decision.
 *
 * This input is deliberately a value object. `evaluatePolicy` performs no
 * port calls and therefore cannot discover a missing safety check midway
 * through an approval flow.
 */
export interface PolicyInput {
	state: MrAutoApprovalState;
	discussions: readonly HostDiscussion[];
	approval: MrApprovalState;
	diffs: FileDiff[] | null;
	config: ReviewBabysitterConfig;
	authenticatedUser: string;
	/**
	 * Existing approval satisfies auto-approval requirements. Keep merge
	 * blockers, skip diff/deny-list/AI gates.
	 */
	skipAutoApprovalChecks?: boolean;
}

export type PolicyResult =
	| { kind: "skip_draft" }
	| { kind: "skip_conflict" }
	| { kind: "skip_discussions_not_resolved" }
	| { kind: "skip_merge_status" }
	| { kind: "skip_self_approval" }
	| { kind: "skip_already_approved"; approvalsLeft?: number | null }
	| { kind: "queue_ai_review" }
	| { kind: "wait_ai_review" }
	| { kind: "block_discussion" }
	| { kind: "block_diff_unreadable" }
	| {
			kind: "block_change_limit";
			changedLines: number;
			maxChangedLines: number;
	  }
	| {
			kind: "block_file_limit";
			changedFiles: number;
			maxChangedFiles: number;
	  }
	| { kind: "block_missing_denylist" }
	| { kind: "block_deny_path"; path: string; glob: string }
	| { kind: "assess" };

function sameIdentity(left: unknown, right: unknown): boolean {
	return (
		typeof left === "string" &&
		typeof right === "string" &&
		left.trim().toLowerCase() === right.trim().toLowerCase()
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSafePath(path: unknown): path is string {
	if (typeof path !== "string" || path.length === 0 || path.trim() !== path) {
		return false;
	}
	if (
		/^[A-Za-z]:\//.test(path) ||
		path.startsWith("/") ||
		path.includes("\\")
	) {
		return false;
	}
	if (/[^\u0020-\u007e\u0080-\u{10ffff}]/u.test(path)) return false;
	const segments = path.split("/");
	return segments.every(
		(segment) => segment.length > 0 && segment !== "." && segment !== "..",
	);
}

function hasBinaryOrUnknownRepresentation(
	file: Record<string, unknown>,
): boolean {
	if (file.statOnly !== false || typeof file.patch !== "string") return true;
	if ("binary" in file && file.binary !== false) return true;
	if ("isBinary" in file && file.isBinary !== false) return true;

	// FileDiff normally carries a textual patch. These markers are how git
	// represents a binary patch inside that otherwise textual field.
	return (
		/^GIT binary patch(?:\r?\n|$)/m.test(file.patch) ||
		/^Binary files?.* differ$/m.test(file.patch)
	);
}

function readableDiffs(diffs: FileDiff[] | null): diffs is FileDiff[] {
	if (!Array.isArray(diffs)) return false;

	for (const candidate of diffs) {
		if (!isRecord(candidate)) return false;
		if (!isSafePath(candidate.path)) return false;
		if (hasBinaryOrUnknownRepresentation(candidate)) return false;
		if (
			typeof candidate.insertions !== "number" ||
			typeof candidate.deletions !== "number" ||
			!Number.isFinite(candidate.insertions) ||
			!Number.isFinite(candidate.deletions) ||
			!Number.isInteger(candidate.insertions) ||
			!Number.isInteger(candidate.deletions) ||
			candidate.insertions < 0 ||
			candidate.deletions < 0
		) {
			return false;
		}
	}
	return true;
}

function hasUnresolvedNonSystemDiscussion(
	discussions: readonly HostDiscussion[],
): boolean {
	if (!Array.isArray(discussions)) return true;
	return discussions.some(
		(discussion) =>
			isRecord(discussion) &&
			discussion.individualNote !== true &&
			discussion.resolved === false &&
			Array.isArray(discussion.notes) &&
			discussion.notes.some((note) => isRecord(note) && note.system !== true),
	);
}

function hasConfiguredAiNote(
	discussions: readonly HostDiscussion[],
	aiReviewerUsername: string,
): boolean {
	if (!Array.isArray(discussions)) return false;
	return discussions.some(
		(discussion) =>
			isRecord(discussion) &&
			Array.isArray(discussion.notes) &&
			discussion.notes.some(
				(note) =>
					isRecord(note) &&
					note.system !== true &&
					sameIdentity(note.author, aiReviewerUsername),
			),
	);
}

function hasAiReviewLabel(labels: readonly string[]): boolean {
	if (!Array.isArray(labels)) return true;
	return labels.some(
		(label) =>
			typeof label !== "string" || label.trim().toLowerCase() === "ai-review",
	);
}

function hasCurrentUserApproval(
	approval: MrApprovalState,
	authenticatedUser: string,
): boolean {
	if (!isRecord(approval)) return true;
	if (approval.approved === true) return true;
	return (
		Array.isArray(approval.approvedBy) &&
		approval.approvedBy.some((identity) =>
			sameIdentity(identity, authenticatedUser),
		)
	);
}

export function evaluateMergeGates(
	state: MrAutoApprovalState,
): PolicyResult | null {
	if (state.draft) return { kind: "skip_draft" };
	if (state.hasConflicts) return { kind: "skip_conflict" };
	if (state.detailedMergeStatus === "discussions_not_resolved") {
		return { kind: "skip_discussions_not_resolved" };
	}
	if (
		state.detailedMergeStatus !== "mergeable" &&
		state.detailedMergeStatus !== "not_approved"
	) {
		return { kind: "skip_merge_status" };
	}
	if (state.headPipelineStatus === "failed") {
		return { kind: "skip_ci_failed" };
	}
	if (
		state.headPipelineStatus !== "success" &&
		state.headPipelineStatus !== "not_configured"
	) {
		return { kind: "skip_ci_not_ready" };
	}
	return null;
}

/**
 * Apply deterministic policy gates in the exact report precedence order.
 *
 * No result from this function approves an MR or mutates a label. `assess` is
 * the sole result that permits the caller to invoke the risk assessor.
 */
export function evaluatePolicy(input: PolicyInput): PolicyResult {
	const { state, config } = input;

	const mergeGate = evaluateMergeGates(state);
	if (mergeGate) return mergeGate;

	// 6–7: the ai-review label and configured AI note only gate new
	// auto-approval. Existing approval may have satisfied that requirement.
	if (!input.skipAutoApprovalChecks) {
		if (hasAiReviewLabel(state.labels)) {
			return { kind: "wait_ai_review" };
		}
		if (!hasConfiguredAiNote(input.discussions, config.aiReviewerUsername)) {
			return { kind: "queue_ai_review" };
		}
	}

	// 8: only unresolved discussions containing a human/non-system note block.
	if (hasUnresolvedNonSystemDiscussion(input.discussions)) {
		return { kind: "block_discussion" };
	}
	if (input.skipAutoApprovalChecks) {
		return {
			kind: "skip_already_approved",
			approvalsLeft: input.approval.approvalsLeft,
		};
	}

	// 9–10: approval must be performed by somebody other than the author and
	// must not already exist for the authenticated approver.
	if (sameIdentity(state.mr.author, input.authenticatedUser)) {
		return { kind: "skip_self_approval" };
	}
	if (hasCurrentUserApproval(input.approval, input.authenticatedUser)) {
		return { kind: "skip_already_approved" };
	}

	// 11: validate every file before reading any stat or deny-list data. This
	// intentionally does not use filterDiff: that helper applies review-UI
	// ignore semantics and can turn a complete diff into stat-only data.
	if (!readableDiffs(input.diffs)) {
		return { kind: "block_diff_unreadable" };
	}

	let changedLines = 0;
	for (const file of input.diffs) {
		changedLines += file.insertions + file.deletions;
		if (!Number.isFinite(changedLines)) {
			return { kind: "block_diff_unreadable" };
		}
	}

	// 12–13: limits are strict upper bounds; equality is allowed.
	if (changedLines > config.maxChangedLines) {
		return {
			kind: "block_change_limit",
			changedLines,
			maxChangedLines: config.maxChangedLines,
		};
	}
	const changedFiles = input.diffs.length;
	if (changedFiles > config.maxChangedFiles) {
		return {
			kind: "block_file_limit",
			changedFiles,
			maxChangedFiles: config.maxChangedFiles,
		};
	}

	// 14: own-property check prevents inherited object properties from
	// accidentally becoming project deny-list entries.
	const denyLists = config.denyPathsByProject;
	const projectPath = state.mr.projectPath;
	if (
		!isRecord(denyLists) ||
		!Object.hasOwn(denyLists, projectPath) ||
		!Array.isArray(denyLists[projectPath])
	) {
		return { kind: "block_missing_denylist" };
	}

	// 15: preserve config order and file order for deterministic report data.
	const denyGlobs = denyLists[projectPath];
	for (const file of input.diffs) {
		for (const pattern of denyGlobs) {
			if (typeof pattern !== "string" || pattern.length === 0) {
				return { kind: "block_missing_denylist" };
			}
			try {
				if (new Bun.Glob(pattern).match(file.path)) {
					return { kind: "block_deny_path", path: file.path, glob: pattern };
				}
			} catch {
				// Config validation normally catches empty values, but an invalid
				// glob must never turn into an approval. Report it as denied data.
				return { kind: "block_deny_path", path: file.path, glob: pattern };
			}
		}
	}

	return { kind: "assess" };
}
