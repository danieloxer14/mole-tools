import { basename, join } from "node:path";
import { z } from "zod";
import type { Context } from "../../core/context";
import { AbortError, UserRejectedError } from "../../core/errors";
import type { Feature } from "../../core/feature";
import type { Issue } from "../../ports/issue-tracker";
import type { Choice } from "../../ports/ui";
import { filterDiff } from "../../shared/diff";
import { runCommitFlow } from "../commit";
import { generateMergeRequest } from "./generate";
import { selectReviewers } from "./reviewers";

const args = z.object({});

type CandidateChoice = "accept" | "edit" | "reject";
const CANDIDATE_CHOICES: Choice<CandidateChoice>[] = [
	{ label: "Accept", value: "accept" },
	{ label: "Edit", value: "edit" },
	{ label: "Reject", value: "reject" },
];

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

export async function runMergeRequestFlow(ctx: Context): Promise<MergeRequestResult> {
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
		await runCommitFlow(ctx, { askToPush: false });
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
	const candidate = await generateMergeRequest(ctx, {
		issue,
		commits: commits.map((commit) => commit.subject),
		diff,
	});
	await ctx.ui.info(`Title: ${candidate.title}\n\n${candidate.body}`);

	const choice = await ctx.ui.select("Merge request", CANDIDATE_CHOICES);
	if (choice === "reject") throw new UserRejectedError();
	const acceptedCandidate = choice === "edit"
		? {
			title: await ctx.ui.editText("Edit merge request title", candidate.title),
			body: await ctx.ui.editMultiline(
				"Edit merge request description",
				candidate.body,
			),
		}
		: candidate;
	const reviewers = await selectReviewers(ctx, defaultBranch);
	const configuredAutoReviewer = ctx.config.autoReviewer?.username;
	if (configuredAutoReviewer && await ctx.ui.confirm(`Add ${configuredAutoReviewer} as an auto-reviewer?`)) {
		const member = await ctx.gitHost.resolveHandle(configuredAutoReviewer);
		if (member && !reviewers.includes(member.handle)) reviewers.push(member.handle);
	}

	const currentUser = await ctx.gitHost.currentUser();
	const assignee = currentUser?.handle;
	const draft = await ctx.ui.confirm("Create as draft?");
	await ctx.ui.info(
		`Final merge request:\nTitle: ${acceptedCandidate.title}\n\n${acceptedCandidate.body}\n\n` +
			`Assignee: ${assignee ?? "(none)"}\nReviewers: ${reviewers.length ? reviewers.join(", ") : "(none)"}\nDraft: ${draft ? "yes" : "no"}`,
	);
	if (!await ctx.ui.confirm("Create merge request?")) throw new UserRejectedError();

	const created = await ctx.gitHost.createMr({
		sourceBranch: branch,
		title: acceptedCandidate.title,
		description: acceptedCandidate.body,
		draft,
		assignee,
		reviewers,
	});
	await ctx.ui.info(`Merge request created: ${created.url}`);

	const configuredRepos = ctx.config.dynamicEnvRepos ?? [];
	const repoName = basename(await ctx.vcs.repoRoot());
	if (configuredRepos.includes(repoName) && await ctx.ui.confirm("Create a dynamic environment?")) {
		const script = join(await ctx.vcs.repoRoot(), ctx.config.dynamicEnvScript ?? "hack/local/dynamic-env.sh");
		if (!await Bun.file(script).exists()) {
			await ctx.ui.warn(`Dynamic-env script not found: ${script}`);
		} else {
			const proc = Bun.spawn([script], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
			await proc.exited;
		}
	}
	return {
		...acceptedCandidate,
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
		usage: "mole-tools merge-request",
		examples: [""],
		notes: ["Prepares an MR candidate from the current branch and commits."],
	},
	async run(ctx) {
		return runMergeRequestFlow(ctx);
	},
};

