import { join } from "node:path";
import type { MrRef } from "../../shared/mr-url";
import { getReviewPaths, type ReviewPaths } from "../review/paths";

export interface ReviewBabysitterPaths {
	repoPath: string;
	worktreePath: string;
}

type ReviewPathBase = Pick<ReviewPaths, "repoPath" | "worktreesRoot">;
type PathsInput = ReviewPathBase | string | undefined;

function projectSegments(projectPath: string): string[] {
	return projectPath.split("/").filter((segment) => segment.length > 0);
}

function reviewPathBase(
	ref: MrRef,
	pathsOrConfigPath: PathsInput,
): ReviewPathBase {
	if (typeof pathsOrConfigPath === "string") {
		const paths = getReviewPaths(ref, pathsOrConfigPath);
		return paths;
	}
	return pathsOrConfigPath ?? getReviewPaths(ref);
}

/**
 * Return transient worktree path for one MR head. This path is deliberately
 * separate from the interactive `mr-<iid>` worktree used by review.
 */
export function getBabysitterWorktreePath(
	ref: MrRef,
	headSha: string,
	pathsOrConfigPath?: PathsInput,
): string {
	const paths = reviewPathBase(ref, pathsOrConfigPath);
	return join(
		paths.worktreesRoot,
		ref.host,
		...projectSegments(ref.projectPath),
		`babysitter-mr-${ref.iid}-${headSha.slice(0, 12)}`,
	);
}

/** Return cached repository path and transient babysitter worktree path. */
export function getReviewBabysitterPaths(
	ref: MrRef,
	headSha: string,
	pathsOrConfigPath?: PathsInput,
): ReviewBabysitterPaths {
	const paths = reviewPathBase(ref, pathsOrConfigPath);
	return {
		repoPath: paths.repoPath,
		worktreePath: getBabysitterWorktreePath(ref, headSha, paths),
	};
}
