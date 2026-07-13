import { z } from "zod";
import { resolveLlmProvider } from "../../adapters/config/schema";
import { loadPrompt } from "../../adapters/prompts/loader";
import type { Context } from "../../core/context";
import { AbortError, UserRejectedError } from "../../core/errors";
import type { Feature } from "../../core/feature";
import type { Issue } from "../../ports/issue-tracker";
import type { Choice } from "../../ports/ui";
import { filterDiff } from "../../shared/diff";
import { checkFormat } from "../../shared/format";
import { buildCommitPrompt } from "./prompt";

const args = z.object({});

export interface CommitResult {
	committed: true;
	sha: string;
}

type CommitChoice = "accept" | "edit" | "reject";

const ACCEPT_EDIT_REJECT: Choice<CommitChoice>[] = [
	{ label: "Accept", value: "accept" },
	{ label: "Edit", value: "edit" },
	{ label: "Reject", value: "reject" },
];

const MAX_GENERATE_ATTEMPTS = 3;

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

async function generateValid(ctx: Context, prompt: string): Promise<string> {
	let violations: string[] = [];
	const llm = ctx.getLlmFor("commit");
	const { providerKey, model } = resolveLlmProvider(ctx.config, "commit");

	for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
		const message = await ctx.ui.stream(
			llm.generate({
				providerKey,
				model,
				system: "",
				prompt,
				task: "commit-message",
			}),
			"Generating commit message",
		);
		const check = checkFormat(message);
		if (check.ok) return message;
		violations = check.violations;
	}
	throw new AbortError(
		`Commit message failed format checks after ${MAX_GENERATE_ATTEMPTS} attempts:\n${violations.join("\n")}`,
	);
}

export interface CommitFlowOptions {
	/** When false, commit locally without offering the standalone push prompt. */
	askToPush?: boolean;
}

export async function runCommitFlow(
	ctx: Context,
	options: CommitFlowOptions = {},
): Promise<CommitResult> {
	if (!(await ctx.vcs.hasStagedChanges()))
		throw new AbortError("No staged changes");

	const issue = await maybeFetchIssue(ctx);
	await ctx.ui.info("Fetching staged diff...", { spinner: true });
	const diff = filterDiff(await ctx.vcs.stagedDiff(), ctx.config.diff.ignore);
	await ctx.ui.info(
		`Fetched diff (${diff.length} file${diff.length === 1 ? "" : "s"})`,
	);
	const systemPrompt = await loadPrompt("commit-system");
	const prompt = buildCommitPrompt(systemPrompt, issue, diff);
	const message = await generateValid(ctx, prompt);
	await ctx.ui.info(message);

	const choice = await ctx.ui.select("Commit message", ACCEPT_EDIT_REJECT);
	let final: string;
	if (choice === "edit") {
		final = await ctx.ui.editText("Edit commit message", message);
	} else if (choice === "reject") {
		throw new UserRejectedError();
	} else {
		final = message;
	}

	await ctx.ui.info("Creating commit...", { spinner: true });
	const { sha } = await ctx.vcs.commit(final);
	await ctx.ui.info(`Committed ${sha.slice(0, 7)}: ${final}`);

	if (options.askToPush !== false && (await ctx.ui.confirm("Push?"))) {
		const branch = await ctx.vcs.currentBranch();
		await ctx.ui.info("Pushing...", { spinner: true });
		await ctx.vcs.push({ setUpstream: false, branch });
	}

	return { committed: true, sha };
}

export const commit: Feature<typeof args, CommitResult> = {
	name: "commit",
	description: "Generate a commit message for staged changes",
	args,
	help: {
		usage: "mole-tools commit",
		examples: [""],
		notes: [
			"Works on currently staged git changes only.",
			"If your branch name contains a Jira ticket key (e.g. PROJ-123), it will fetch issue details and include them in the generation prompt.",
			"You can accept, edit, or reject the generated message. After accepting you are asked whether to push.",
		],
	},
	async run(ctx, _args) {
		return runCommitFlow(ctx, { askToPush: true });
	},
};
