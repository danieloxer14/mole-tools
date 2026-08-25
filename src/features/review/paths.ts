import { dirname, join } from "node:path";
import { defaultConfigPath } from "../../adapters/config/loader";
import type { MrRef } from "../../shared/mr-url";

export interface ReviewPaths {
	root: string;
	reposRoot: string;
	repoPath: string;
	worktreesRoot: string;
	worktreePath: string;
	reviewsRoot: string;
	reviewDir: string;
	statePath: string;
	/** Legacy single-transcript path. Adoption source only. */
	chatPath: string;
	chatsDir: string;
	layersDir: string;
	promptDir: string;
	layerPath(runId: string): string;
	promptPath(turnId: string): string;
	chatTranscriptPath(chatId: string): string;
}

function projectSegments(projectPath: string): string[] {
	return projectPath.split("/").filter((segment) => segment.length > 0);
}

export function getReviewPaths(
	ref: MrRef,
	configPath: string = defaultConfigPath(),
): ReviewPaths {
	const root = dirname(configPath);
	const project = projectSegments(ref.projectPath);
	const reposRoot = join(root, "repos");
	const repoPath = join(reposRoot, ref.host, ...project);
	const worktreesRoot = join(root, "worktrees");
	const worktreePath = join(
		worktreesRoot,
		ref.host,
		...project,
		`mr-${ref.iid}`,
	);
	const reviewsRoot = join(root, "reviews");
	const reviewDir = join(reviewsRoot, ref.host, ...project, `mr-${ref.iid}`);
	const layersDir = join(reviewDir, "layers");
	const promptDir = join(reviewDir, "prompt");
	const chatsDir = join(reviewDir, "chats");

	return {
		root,
		reposRoot,
		repoPath,
		worktreesRoot,
		worktreePath,
		reviewsRoot,
		reviewDir,
		statePath: join(reviewDir, "review.json"),
		chatPath: join(reviewDir, "chat.ndjson"),
		chatsDir,
		layersDir,
		promptDir,
		layerPath: (runId: string) => join(layersDir, `${runId}.json`),
		promptPath: (turnId: string) => join(promptDir, `${turnId}.md`),
		chatTranscriptPath: (chatId: string) => join(chatsDir, `${chatId}.ndjson`),
	};
}

export const reviewPaths = getReviewPaths;
export const pathsForReview = getReviewPaths;
