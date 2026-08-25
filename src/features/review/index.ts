import { z } from "zod";
import type { Context } from "../../core/context";
import { PortError } from "../../core/errors";
import type { Feature } from "../../core/feature";
import type { HostDiscussion } from "../../ports/git-host";
import { parseFileDiffs } from "../../shared/diff-parse";
import { type MrRef, parseMrUrl } from "../../shared/mr-url";
import { openBrowser } from "./open-browser";
import type { ReviewFileRequest } from "./routes";
import { createReviewServer } from "./server";
import {
	type ReviewMergeRequest,
	type ReviewSetupResult,
	setupReview,
} from "./setup";
import type { ReviewState } from "./state";
import { ReviewStore } from "./store";

export interface ReviewFlowResult extends ReviewSetupResult {
	discussions: HostDiscussion[];
	getDiscussions?: () => Promise<HostDiscussion[]>;
	mr: ReviewMergeRequest;
	ref: MrRef;
}

interface ReviewGitHost {
	fetchMr?(ref: MrRef): Promise<ReviewMergeRequest>;
	listDiscussions?(ref: MrRef): Promise<HostDiscussion[]>;
	createDiscussion?: NonNullable<Context["gitHost"]>["createDiscussion"];
	fetchApprovalState?: NonNullable<Context["gitHost"]>["fetchApprovalState"];
	approveMr?: NonNullable<Context["gitHost"]>["approveMr"];
	unapproveMr?: NonNullable<Context["gitHost"]>["unapproveMr"];
}
export const reviewArgs = z.object({
	url: z.string().min(1).describe("Full GitLab merge request URL"),
	mode: z
		.enum(["code", "plan"])
		.optional()
		.describe("Review lens: code diff or change plan (defaults to code)"),
	noOpen: z.boolean().default(false).describe("Do not open a browser"),
	refresh: z
		.boolean()
		.default(false)
		.describe("Re-sync to the current MR head before opening"),
});

export type ReviewArgs = z.infer<typeof reviewArgs>;

export async function runReviewFlow(
	ctx: Context,
	args: ReviewArgs,
): Promise<ReviewFlowResult> {
	const ref = parseMrUrl(args.url);
	const host = ctx.gitHost as unknown as ReviewGitHost | null;
	if (!host?.fetchMr) {
		throw new PortError("Git host does not support fetching merge requests");
	}
	const mr = await host.fetchMr(ref);
	let discussions: HostDiscussion[] = [];
	if (host.listDiscussions) {
		try {
			discussions = await host.listDiscussions(ref);
		} catch {
			// Discussions are supplementary; keep review startup available offline.
		}
	}
	const result = await setupReview({
		vcs: ctx.vcs,
		ref,
		mr,
		mode: args.mode,
		refresh: args.refresh,
		config: ctx.config,
	});
	const getDiscussions = host.listDiscussions
		? () => host.listDiscussions?.(ref) ?? Promise.resolve([])
		: undefined;
	return {
		...result,
		discussions,
		getDiscussions,
		mr,
		ref,
	};
}

export const reviewFeature: Feature<typeof reviewArgs, ReviewState> = {
	name: "review",
	description: "Interactive review of a GitLab merge request in a local web UI",
	positionals: ["url"],
	args: reviewArgs,
	help: {
		usage:
			"mole-tools review <mr-url> [--mode code|plan] [--no-open] [--refresh]",
		examples: [
			"https://gitlab.com/acme/api/-/merge_requests/42",
			"https://gitlab.com/acme/api/-/merge_requests/42 --mode plan",
		],
		notes: [
			"Requires an authenticated `glab` and the configured review agent binary on PATH.",
			"Review state persists under ~/.config/mole-tools/reviews.",
		],
	},
	async run(ctx, args) {
		const result = await runReviewFlow(ctx, args);
		const host = ctx.gitHost as unknown as ReviewGitHost | null;
		const getFileContents = ctx.vcs.readFileAtRevision
			? async ({ path, revision }: ReviewFileRequest): Promise<string | null> =>
					(await ctx.vcs.readFileAtRevision?.(
						result.state.repoRoot,
						revision,
						path,
					)) ?? null
			: undefined;
		const server = createReviewServer({
			state: result.state,
			store: new ReviewStore(result.paths),
			diff: parseFileDiffs(result.diff),
			layerDiff: result.diff,
			expandedDiff: parseFileDiffs(result.fullDiff),
			discussions: result.discussions,
			gitHost:
				host?.fetchMr ||
				host?.createDiscussion ||
				host?.listDiscussions ||
				host?.fetchApprovalState ||
				host?.approveMr ||
				host?.unapproveMr
					? {
							fetchMr: host.fetchMr?.bind(host),
							createDiscussion: host.createDiscussion?.bind(host),
							listDiscussions: host.listDiscussions?.bind(host),
							fetchApprovalState: host.fetchApprovalState?.bind(host),
							approveMr: host.approveMr?.bind(host),
							unapproveMr: host.unapproveMr?.bind(host),
						}
					: undefined,
			ref: result.ref,
			getFileContents,
			worktreePath: result.state.worktreePath,
			reviewAgent: ctx.reviewAgent,
			vcs: ctx.vcs,
			issues: ctx.issues,
			config: ctx.config,
			mr: result.mr,
			paths: result.paths,
		});
		const address = server.start();
		try {
			await ctx.ui.info(`Review URL: ${address.url}`);
			if (!args.noOpen) {
				try {
					await openBrowser(address.url);
				} catch (error) {
					await ctx.ui.warn(
						`Unable to open browser: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			await ctx.ui.pause("Review server running. Press Enter to stop.");
		} finally {
			await server.stop();
		}
		return result.state;
	},
};
