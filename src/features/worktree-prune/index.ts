import { z } from "zod";
import type { Config } from "../../adapters/config/schema";
import { updateConfig } from "../../adapters/config/loader";
import type { Context } from "../../core/context";
import type { Feature } from "../../core/feature";
import { discoverExtraWorktrees } from "./discovery";
import { summarizeWorktree } from "./summary";

// ---------------------------------------------------------------------------
// CLI args (just base-dir override for now; discovery/removal not wired yet)
// ---------------------------------------------------------------------------
export const worktreePruneArgs = z.object({
	baseDir: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------
export interface RemovalResult {
	path: string;
	repoRoot: string;
	status: "removed" | "failed" | "force-removed" | "declined";
	error?: unknown;
}

export interface WorktreePruneResult {
	baseDir: string;
	repoCount: number;
	extraWorktreeCount: number;
	removals: RemovalResult[];
}

/** Resolve base-dir: CLI flag → config.worktreePrune.baseDir → prompt */
export async function resolveBaseDir(
	ctx: Context,
	cliBaseDir: string | undefined,
	onPersisted?: (baseDir: string) => Promise<void>,
): Promise<string> {
	const persisted = onPersisted ?? ((baseDir: string) =>
		updateConfig({ worktreePrune: { baseDir } }).catch(() => {}));

	// 1. CLI flag takes highest priority (never persisted — explicit override)
	if (cliBaseDir?.trim()) return cliBaseDir.trim();

	// 2. Config value
	const cfg = ctx.config.worktreePrune?.baseDir;
	if (cfg?.trim()) return cfg.trim();

	// 3. Prompt the user and persist
	const prompted = await ctx.ui.editText(
		"Enter base directory to scan for worktrees:",
		"",
	);
	if (prompted.trim()) {
		await persisted(prompted.trim());
	}
	return prompted;
}

/** Entry-point run function */
export async function runWorktreePrune(
	ctx: Context,
	args: z.infer<typeof worktreePruneArgs>,
): Promise<WorktreePruneResult> {
	const baseDir = await resolveBaseDir(ctx, args.baseDir);

	const groups = await discoverExtraWorktrees(baseDir, ctx.vcs);
	const repoCount = groups.length;
	const extraWorktreeCount = groups.reduce(
		(sum, g) => sum + g.worktreePaths.length,
		0,
	);

	if (repoCount === 0) {
		await ctx.ui.info("Nothing to prune — no repos or extra worktrees found.");
		return { baseDir, repoCount, extraWorktreeCount: 0, removals: [] };
	}
	if (extraWorktreeCount === 0) {
		await ctx.ui.info(
			`Found ${repoCount} repo(s) but zero extra worktrees — nothing to prune.`,
		);
		return { baseDir, repoCount, extraWorktreeCount: 0, removals: [] };
	}

	const selected: { path: string; repoRoot: string }[] = [];
	for (const group of groups) {
		const choices = group.worktrees.map((worktree) => ({
			label: `${worktree.path} (${worktree.ref || "detached"})`,
			value: worktree.path,
		}));
		const paths = await ctx.ui.multiSelect(
			`Select extra worktrees to prune for ${group.repoRoot}`,
			choices,
		);
		for (const path of paths) selected.push({ path, repoRoot: group.repoRoot });
	}

	const removals: RemovalResult[] = [];
	for (const item of selected) {
		try {
			await ctx.vcs.removeWorktree(item.path, item.repoRoot);
			removals.push({ ...item, status: "removed" });
		} catch (error) {
			removals.push({ ...item, status: "failed", error });
		}
	}

	// Normal removal can fail for dirty or otherwise busy worktrees. Handle each
	// failure independently so one decision never affects another worktree.
	for (const removal of removals.filter((result) => result.status === "failed")) {
		let summary = "";
		try {
			const snapshot = await ctx.vcs.showWorktreeStatus(
				removal.repoRoot,
				removal.path,
			);
			summary = await summarizeWorktree(ctx, snapshot);
		} catch {
			// Status and summarisation are best effort; the confirmation remains useful.
		}
		if (summary) {
			await ctx.ui.info(`Potential loss for ${removal.path}: ${summary}`);
		}

		const force = await ctx.ui.confirm(
			`Normal removal failed for ${removal.path}. Force-delete this worktree?`,
		);
		if (!force) {
			removal.status = "declined";
			continue;
		}
		try {
			await ctx.vcs.forceRemoveWorktree(removal.path, removal.repoRoot);
			removal.status = "force-removed";
		} catch (error) {
			removal.error = error;
		}
	}

	const normalRemoved = removals.filter((r) => r.status === "removed").length;
	const forceRemoved = removals.filter((r) => r.status === "force-removed").length;
	const declined = removals.filter((r) => r.status === "declined").length;
	const unresolved = removals.filter((r) => r.status === "failed").length;
	await ctx.ui.info(
		[
			`Pruned ${normalRemoved + forceRemoved} of ${selected.length} selected worktree(s).`,
			`Normal removals: ${normalRemoved}`,
			`Force-removed: ${forceRemoved}`,
			`Declined/retained: ${declined}`,
			`Unresolved failures: ${unresolved}`,
		].join("\\n"),
	);
	return { baseDir, repoCount, extraWorktreeCount, removals };
}

// ---------------------------------------------------------------------------
// Feature registration (discoveries/removal wired in later tickets)
// ---------------------------------------------------------------------------
export const worktreePrune: Feature<typeof worktreePruneArgs, WorktreePruneResult> = {
	name: "worktree-prune",
	description: "Scan a base directory for extra Git worktrees and remove them",
	args: worktreePruneArgs,
	help: {
		usage: "mole-tools worktree-prune [--baseDir <path>]",
		examples: ["mole-tools worktree-prune --baseDir ~/repos"],
		notes: [
			"Scans the base directory for Git repositories and lists extra worktrees.",
			"Base-directory resolution order: --baseDir flag → config.worktreePrune.baseDir → prompt.",
		],
	},
	run: runWorktreePrune,
};
