import { basename, join } from "node:path";
import { z } from "zod";
import type { Context } from "../../core/context";
import { AbortError, UserRejectedError } from "../../core/errors";
import type { Feature } from "../../core/feature";
import type { Issue } from "../../ports/issue-tracker";
import { filterDiff } from "../../shared/diff";
import { runCommitFlow } from "../commit";
import { generateMergeRequest } from "./generate";
import { selectReviewers } from "./reviewers";

const args = z.object({
	context: z
		.string()
		.trim()
		.min(1, "--context must not be blank")
		.optional()
		.describe("Extra guidance for the generated merge request")
		.meta({ examples: ["Emphasize the migration risk and rollout plan."] }),
});

export interface MergeRequestCandidate {
	title: string;
	body: string;
}

export interface MergeRequestResult extends MergeRequestCandidate {
	commits: string[];
	issue: Issue | null;
	reviewers: string[];
	assignee?: string;
	url?: string;
}

async function maybeFetchIssue(ctx: Context): Promise<Issue | null> {
	if (!ctx.issues) return null;
	const branch = await ctx.vcs.currentBranch();
	const match = branch.match(new RegExp(ctx.config.jira.branchPattern, "i"));
	if (!match) {
		await ctx.ui.info(`No Jira ticket found in branch "${branch}"`);
		return null;
	}
	const key = match[0].toUpperCase();
	await ctx.ui.info(`Fetching Jira issue ${key}...`, { spinner: true });
	const issue = await ctx.issues.fetchIssue(key);
	await ctx.ui.info(`Fetched ${issue.key}: ${issue.summary}`);
	return issue;
}

export interface MergeRequestFlowOptions {
	/** Optional user-supplied guidance for the merge request and commit generation. */
	context?: string;
}

export async function runMergeRequestFlow(
	ctx: Context,
	options: MergeRequestFlowOptions = {},
): Promise<MergeRequestResult> {
	// Host preflight is deliberately first: do not spend git/Jira/Ollama work
	// before discovering that glab cannot perform the final operation.
	if (!ctx.gitHost) throw new AbortError("GitLab host is not configured");
	await ctx.gitHost.preflight();

	const branch = await ctx.vcs.currentBranch();
	const defaultBranch = await ctx.vcs.defaultBranch();
	if (branch === defaultBranch)
		throw new AbortError(`Cannot open MR from ${defaultBranch}`);

	const existing = await ctx.gitHost.findOpenMr(branch);
	if (existing) {
		await ctx.ui.info(`Open merge request already exists: ${existing.url}`);
		return { title: "", body: "", commits: [], issue: null, reviewers: [] };
	}

	if (await ctx.vcs.hasStagedChanges()) {
		await runCommitFlow(ctx, { askToPush: false, context: options.context });
	}

	const upstream = await ctx.vcs.hasUpstream(branch);
	if (!upstream || (await ctx.vcs.isAheadOfUpstream(branch))) {
		await ctx.ui.info("Pushing branch...", { spinner: true });
		await ctx.vcs.push({ setUpstream: !upstream, branch });
	}

	const baseRef = `origin/${defaultBranch}`;
	const commits = await ctx.vcs.commitsAhead(baseRef);
	if (commits.length === 0) throw new AbortError("Nothing to merge");

	const issue = await maybeFetchIssue(ctx);
	await ctx.ui.info("Fetching merge request diff...", { spinner: true });
	const diff = filterDiff(
		await ctx.vcs.mergeBaseDiff(defaultBranch),
		ctx.config.diff.ignore,
	);
	await ctx.ui.info(
		`Diff collected (${diff.length} file${diff.length === 1 ? "" : "s"} changed).`,
	);
	const candidate = await generateMergeRequest(ctx, {
		issue,
		commits: commits.map((commit) => commit.subject),
		diff,
		context: options.context,
	});
	await ctx.ui.info(`Title: ${candidate.title}\n\n${candidate.body}`);

	const reviewers = await selectReviewers(ctx, defaultBranch);
	const configuredAutoReviewer = ctx.config.autoReviewer?.username;
	if (
		configuredAutoReviewer &&
		(await ctx.ui.confirm(`Add ${configuredAutoReviewer} as an auto-reviewer?`))
	) {
		const member = await ctx.gitHost.resolveHandle(configuredAutoReviewer);
		if (member && !reviewers.includes(member.handle))
			reviewers.push(member.handle);
	}

	const currentUser = await ctx.gitHost.currentUser();
	const assignee = currentUser?.handle;
	const draft = await ctx.ui.confirm("Create as draft?");
	await ctx.ui.info(
		`Final merge request:\nTitle: ${candidate.title}\n\n${candidate.body}\n\n` +
			`Assignee: ${assignee ?? "(none)"}\nReviewers: ${reviewers.length ? reviewers.join(", ") : "(none)"}\nDraft: ${draft ? "yes" : "no"}`,
	);
	if (!(await ctx.ui.confirm("Create merge request?")))
		throw new UserRejectedError();

	const created = await ctx.gitHost.createMr({
		sourceBranch: branch,
		title: candidate.title,
		description: candidate.body,
		draft,
		assignee,
		reviewers,
	});
	await ctx.ui.info(`Merge request created: ${created.url}`);

	const configuredRepos = ctx.config.dynamicEnvRepos ?? [];
	const repoName = basename(await ctx.vcs.repoRoot());
	if (
		configuredRepos.includes(repoName) &&
		(await ctx.ui.confirm("Create a dynamic environment?"))
	) {
		const script = join(
			await ctx.vcs.repoRoot(),
			ctx.config.dynamicEnvScript ?? "hack/local/dynamic-env.sh",
		);
		if (!(await Bun.file(script).exists())) {
			await ctx.ui.warn(`Dynamic-env script not found: ${script}`);
		} else {
			const proc = Bun.spawn([script], {
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			await proc.exited;
		}
	}
	return {
		...candidate,
		commits: commits.map((commit) => commit.subject),
		issue,
		reviewers,
		assignee,
		url: created.url,
	};
}

export const mergeRequest: Feature<typeof args, MergeRequestResult> = {
	name: "merge-request",
	description: "Generate and review a GitLab merge request",
	args,
	help: {
		usage: "mole-tools merge-request [--context <text>]",
		examples: [
			'mole-tools merge-request --context "Emphasize the migration risk and rollout plan."',
		],
		notes: [
			"Prepares an MR candidate from the current branch and commits.",
			"If staged changes exist, a commit is generated first using the same --context guidance.",
			"Use --context to supply invocation-scoped guidance for the LLM without changing configured prompts.",
		],
	},
	async run(ctx, args) {
		return runMergeRequestFlow(ctx, { context: args.context });
	},
};
