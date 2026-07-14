import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Vcs, WorktreeInfo } from "../../ports/vcs";

/**
 * Scans a base directory for Git repositories.
 *
 * - Recursively finds `.git` directories
 * - Normalises each match back to the repository root
 * - Deduplicates overlapping paths (a subdirectory .git match inside a repo
 *   resolves to the same root)
 * - Returns sorted, unique repository roots
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface GroupedWorktrees {
	repoRoot: string;
	/** Extra worktrees, retaining their branch/ref for the selection UI. */
	worktrees: WorktreeInfo[];
	/** Compatibility projection used by the orchestration layer. */
	worktreePaths: string[];
}

export type RepoRootNormalizer = (candidate: string) => Promise<string | null>;

/** Resolve a filesystem match to Git's canonical repository root. */
const normalizeWithGit: RepoRootNormalizer = async (candidate) => {
	const process = Bun.spawn(
		["git", "-C", candidate, "rev-parse", "--show-toplevel"],
		{ stdout: "pipe", stderr: "ignore" },
	);
	if ((await process.exited) !== 0) return null;
	const root = (await new Response(process.stdout).text()).trim();
	return root ? resolve(root) : null;
};

/** Scan baseDir for Git repositories and return sorted unique roots. */
export async function discoverRepos(
	baseDir: string,
	normalize: RepoRootNormalizer = normalizeWithGit,
): Promise<string[]> {
	const result = new Set<string>();

	async function walk(current: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const fullPath = resolve(current, entry.name);
			if (entry.name === ".git") {
				const root = (await normalize(resolve(current))) ?? resolve(current);
				result.add(root);
			} else {
				await walk(fullPath);
			}
		}
	}

	try {
		await walk(resolve(baseDir));
	} catch {
		// A missing or unreadable base directory is equivalent to no repos.
		return [];
	}
	return [...result].sort();
}

/**
 * Group extra (non-primary) worktrees by repository root.
 *
 * For each discovered repo, queries the VCS for its worktree list via
 * `vcs.worktrees()`, filters out the primary worktree (where path == repoRoot),
 * and collects the remaining paths grouped under that root.
 */
export async function discoverExtraWorktrees(
	baseDir: string,
	vcs: Vcs,
): Promise<GroupedWorktrees[]> {
	const repos = await discoverRepos(baseDir);
	const results: GroupedWorktrees[] = [];

	for (const repoRoot of repos) {
		try {
			const allWorktrees = await vcs.worktrees(repoRoot);
			// Filter out the primary worktree (matches repo root itself)
			const extras = allWorktrees.filter(
				(wt) => resolve(wt.path) !== resolve(repoRoot),
			);
			if (extras.length > 0) {
				const worktrees = extras
					.map((wt) => ({ ...wt, path: resolve(wt.path) }))
					.sort((a, b) => a.path.localeCompare(b.path));
				results.push({
					repoRoot,
					worktrees,
					worktreePaths: worktrees.map((wt) => wt.path),
				});
			}
		} catch {
			// If a specific repo fails to query, skip it gracefully
		}
	}

	return results;
}
