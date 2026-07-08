import { z } from "zod";
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
	const match = branch.match(new RegExp(ctx.config.jira.branchPattern));
	if (!match) return null;
	return ctx.issues.fetchIssue(match[0]);
}

async function generateValid(ctx: Context, prompt: string): Promise<string> {
	let violations: string[] = [];
	for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
		const message = await ctx.ui.stream(
			ctx.llm.generate({
				model: ctx.config.ollama.commitModel,
				system: "",
				prompt,
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

export const commit: Feature<typeof args, CommitResult> = {
	name: "commit",
	description: "Generate a commit message for staged changes",
	args,
	async run(ctx, _args) {
		if (!(await ctx.vcs.hasStagedChanges()))
			throw new AbortError("No staged changes");

		const issue = await maybeFetchIssue(ctx);
		const diff = filterDiff(await ctx.vcs.stagedDiff(), ctx.config.diff.ignore);
		const prompt = buildCommitPrompt(
			ctx.config.commitSystemPrompt,
			issue,
			diff,
		);
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

		const { sha } = await ctx.vcs.commit(final);
		await ctx.ui.info(`Committed ${sha.slice(0, 7)}: ${final}`);

		if (await ctx.ui.confirm("Push?")) {
			const branch = await ctx.vcs.currentBranch();
			await ctx.vcs.push({ setUpstream: false, branch });
		}

		return { committed: true, sha };
	},
};
