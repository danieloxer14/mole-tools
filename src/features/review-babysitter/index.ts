import { z } from "zod";
import type { ReviewBabysitterConfig } from "../../adapters/config/schema";
import { ReviewBabysitterConfigSchema } from "../../adapters/config/schema";
import type { Context } from "../../core/context";
import type { Feature } from "../../core/feature";
import { logger } from "../../core/logger";
import type {
	GitHost,
	HostDiscussion,
	MrApprovalState,
	MrAutoApprovalState,
	WatchedMrRef,
} from "../../ports/git-host";
import type { Notifier } from "../../ports/notifier";
import type { ReviewAgent } from "../../ports/review-agent";
import type { FileDiff } from "../../ports/vcs";
import type { MrRef } from "../../shared/mr-url";
import { getReviewPaths } from "../review/paths";
import {
	prepareReviewRevision,
	type ReviewMergeRequest,
	resolveReviewRepo,
} from "../review/setup";
import {
	type AssessmentResult,
	type AssessRiskInput,
	assessRisk as assessRiskDefault,
} from "./assessment";
import {
	evaluateMergeGates,
	evaluatePolicy,
	type PolicyResult,
} from "./policy";
import {
	formatDiscoveryFailure,
	formatNoMatches,
	formatReport,
	formatReportLine,
	type ReportMr,
	type ReportResult,
} from "./report";

export const reviewBabysitterArgs = z.object({}).strict();

export interface BabysitterLoopResult {
	lines: string[];
	text: string;
	matched: number;
	discoveryError?: string;
}

export interface RunOneLoopOptions {
	config?: ReviewBabysitterConfig;
	gitHost?: GitHost;
	notifier?: Notifier;
	agent?: ReviewAgent;
	assessRisk?: (input: AssessRiskInput) => Promise<AssessmentResult>;
	loadDiff?: (
		ctx: Context,
		ref: MrRef,
		mr: MrAutoApprovalState["mr"],
	) => Promise<FileDiff[]>;
	authenticatedUser?: string;
}

function parseConfig(
	config: ReviewBabysitterConfig | undefined,
): ReviewBabysitterConfig {
	if (!config)
		throw new Error("review-babysitter requires reviewBabysitter config");
	return ReviewBabysitterConfigSchema.parse(config);
}

function mrUrl(ref: MrRef): string {
	return `https://${ref.host}/${ref.projectPath}/-/merge_requests/${ref.iid}`;
}

function reportMetadata(
	ref: MrRef,
	watched: WatchedMrRef,
	state?: MrAutoApprovalState,
): ReportMr {
	const mr = state?.mr;
	return {
		webUrl: mr?.webUrl?.trim() || mrUrl(ref),
		projectPath: mr?.projectPath || ref.projectPath,
		iid: mr?.iid || ref.iid,
		title: mr?.title || "Unknown merge request",
		assignees: watched.assignees,
	};
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return "unknown error";
	}
}

function approvalRequirementsSatisfied(approval: MrApprovalState): boolean {
	if (approval.approvalsLeft === 0) return true;
	return (
		approval.approvalsLeft === null &&
		approval.rules.length > 0 &&
		approval.rules.every((rule) => rule.approvalsLeft === 0)
	);
}

function policyInput(
	state: MrAutoApprovalState,
	discussions: readonly HostDiscussion[],
	approval: MrApprovalState,
	diffs: FileDiff[] | null,
	config: ReviewBabysitterConfig,
	authenticatedUser: string,
	skipAutoApprovalChecks = false,
) {
	return {
		state,
		discussions,
		approval,
		diffs,
		config,
		authenticatedUser,
		skipAutoApprovalChecks,
	};
}

function render(
	result: ReportResult,
	ref: MrRef,
	watched: WatchedMrRef,
	state?: MrAutoApprovalState,
): string {
	return formatReportLine(result, reportMetadata(ref, watched, state));
}

function isBeforeApproval(result: PolicyResult): boolean {
	return (
		result.kind === "queue_ai_review" ||
		result.kind === "wait_ai_review" ||
		result.kind === "skip_merge_dependency" ||
		result.kind === "block_discussion"
	);
}

function isBeforeDiff(result: PolicyResult): boolean {
	return (
		result.kind === "skip_self_approval" ||
		result.kind === "skip_already_approved"
	);
}

function assessmentReport(result: AssessmentResult): ReportResult {
	if (result.kind === "low") return { kind: "approved" };
	if (result.kind === "risk")
		return {
			kind: "assessment_risk",
			risk: result.risk,
			reason: result.reason,
		};
	return { kind: "assessment_inconclusive" };
}

/** Load complete MR-head diff through the review cache mechanism. */
export async function loadCompleteDiff(
	ctx: Context,
	ref: MrRef,
	mr: MrAutoApprovalState["mr"],
): Promise<FileDiff[]> {
	const paths = getReviewPaths(ref);
	const repoRoot = await resolveReviewRepo({ vcs: ctx.vcs, ref, paths });
	const revision = await prepareReviewRevision({ vcs: ctx.vcs, repoRoot, mr });
	return ctx.vcs.diffRange(repoRoot, revision.mergeBaseSha, mr.headSha);
}

async function sendReport(notifier: Notifier, text: string): Promise<boolean> {
	try {
		await notifier.sendText(text);
		return true;
	} catch (error) {
		logger.warn("review-babysitter notifier failed", {
			error: errorText(error),
		});
		return false;
	}
}

/** Run one complete serial discovery/check/report loop. */
export async function runOneLoop(
	ctx: Context,
	options: RunOneLoopOptions = {},
): Promise<BabysitterLoopResult> {
	const config = parseConfig(options.config ?? ctx.config.reviewBabysitter);
	const gitHost = options.gitHost ?? ctx.gitHost;
	if (!gitHost)
		throw new Error("review-babysitter requires authenticated GitLab");
	const notifier = options.notifier ?? ctx.createNotifier(config.webhookUrlEnv);
	await ctx.ui.info("Review babysitter — Discovering matching open MRs.", {
		spinner: true,
		terminal: true,
	});

	let watched: WatchedMrRef[];
	try {
		watched = await gitHost.listOpenedMrsForAssignees(config.assignees);
	} catch (error) {
		const line = formatDiscoveryFailure(error);
		await ctx.ui.error(
			"Review babysitter — GitLab discovery failed; retrying after interval.",
		);
		await sendReport(notifier, line);
		return {
			lines: [line],
			text: line,
			matched: 0,
			discoveryError: errorText(error),
		};
	}
	await ctx.ui.info(
		`Review babysitter — Found ${watched.length} matching open MR${watched.length === 1 ? "" : "s"}.`,
		{ terminal: true },
	);
	if (watched.length === 0) {
		const line = formatNoMatches();
		const reportSent = await sendReport(notifier, line);
		await ctx.ui.info(
			reportSent
				? "Review babysitter — No matching open MRs. Slack heartbeat sent."
				: "Review babysitter — No matching open MRs. Slack heartbeat failed.",
			{ terminal: true },
		);
		return { lines: [line], text: line, matched: 0 };
	}

	const lines: string[] = [];
	const assess = options.assessRisk ?? assessRiskDefault;
	let agent = options.agent;
	const loadDiff = options.loadDiff ?? loadCompleteDiff;
	for (const [index, watchedMr] of watched.entries()) {
		await ctx.ui.info(
			`Review babysitter — Checking merge request ${index + 1}/${watched.length}.`,
			{ spinner: true, terminal: true },
		);
		const ref = watchedMr.ref;
		let state: MrAutoApprovalState;
		try {
			state = await gitHost.fetchAutoApprovalState(ref);
		} catch (error) {
			lines.push(
				render({ kind: "error", error: errorText(error) }, ref, watchedMr),
			);
			await ctx.ui.error(
				"Review babysitter — Merge request check failed; continuing.",
			);
			await ctx.ui.info(
				`Review babysitter — Finished merge request ${index + 1}/${watched.length}.`,
				{ terminal: true },
			);
			continue;
		}
		try {
			const preflightResult = evaluateMergeGates(state);
			if (preflightResult && preflightResult.kind !== "skip_merge_dependency") {
				lines.push(render(preflightResult, ref, watchedMr, state));
				continue;
			}

			const approval = await gitHost.fetchApprovalState(ref);
			const authenticatedUser =
				options.authenticatedUser ??
				(typeof approval.currentUser === "string" ? approval.currentUser : "");
			const skipAutoApprovalChecks =
				approval.approved === true || approvalRequirementsSatisfied(approval);
			const discussions = await gitHost.listDiscussions(ref);
			let result = evaluatePolicy(
				policyInput(
					state,
					discussions,
					approval,
					null,
					config,
					authenticatedUser,
					skipAutoApprovalChecks,
				),
			);
			if (isBeforeApproval(result)) {
				if (result.kind === "queue_ai_review") {
					try {
						await gitHost.addMrLabel(ref, "ai-review");
						lines.push(render(result, ref, watchedMr, state));
					} catch (error) {
						lines.push(
							render(
								{ kind: "error", error: errorText(error) },
								ref,
								watchedMr,
								state,
							),
						);
					}
				} else lines.push(render(result, ref, watchedMr, state));
				continue;
			}
			if (isBeforeDiff(result)) {
				lines.push(render(result, ref, watchedMr, state));
				continue;
			}
			if (!authenticatedUser.trim()) {
				lines.push(
					render(
						{ kind: "error", error: "authenticated GitLab user unavailable" },
						ref,
						watchedMr,
						state,
					),
				);
				continue;
			}

			const diffs = await loadDiff(ctx, ref, state.mr);
			result = evaluatePolicy(
				policyInput(
					state,
					discussions,
					approval,
					diffs,
					config,
					authenticatedUser,
				),
			);
			if (result.kind !== "assess") {
				lines.push(render(result, ref, watchedMr, state));
				continue;
			}
			if (!agent) agent = ctx.createReviewBabysitterAgent(config.model);
			let assessment: AssessmentResult;
			try {
				assessment = await assess({
					vcs: ctx.vcs,
					agent,
					ref,
					mr: state.mr as ReviewMergeRequest,
					config,
				});
			} catch {
				assessment = { kind: "inconclusive" };
			}
			if (assessment.kind !== "low") {
				lines.push(render(assessmentReport(assessment), ref, watchedMr, state));
				continue;
			}
			try {
				const approvalResult = await gitHost.approveMr(ref);
				if (approvalResult.approved === true) {
					lines.push(
						render(
							{ kind: "approved", approvalsLeft: approvalResult.approvalsLeft },
							ref,
							watchedMr,
							state,
						),
					);
				} else {
					lines.push(
						render({ kind: "approval_rejected" }, ref, watchedMr, state),
					);
				}
			} catch {
				lines.push(
					render({ kind: "approval_rejected" }, ref, watchedMr, state),
				);
			}
		} catch (error) {
			lines.push(
				render(
					{ kind: "error", error: errorText(error) },
					ref,
					watchedMr,
					state,
				),
			);
		} finally {
			await ctx.ui.info(
				`Review babysitter — Finished merge request ${index + 1}/${watched.length}.`,
				{ terminal: true },
			);
		}
	}
	const text = formatReport(lines);
	const reportSent = await sendReport(notifier, text);
	await ctx.ui.info(
		reportSent
			? "Review babysitter — Slack report sent. Waiting for next scan."
			: "Review babysitter — Slack report failed; waiting for next scan.",
		{ terminal: true },
	);
	return { lines, text, matched: watched.length };
}

export interface SignalSource {
	on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
	off?(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
	removeListener?(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export type SchedulerSleep = (
	milliseconds: number,
	signal?: AbortSignal,
) => Promise<void>;

export interface SchedulerInput {
	runLoop: () => Promise<unknown>;
	intervalSeconds?: number;
	scheduleTimes?: string[];
	sleep?: SchedulerSleep;
	signals?: SignalSource;
	now?: () => Date;
}

const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Milliseconds until the next configured "HH:MM" local time strictly after `now`, wrapping to tomorrow. */
function msUntilNextScheduledTime(times: readonly string[], now: Date): number {
	const minutesOfDay = [...times]
		.map((time) => {
			const [hoursText, minutesText] = time.split(":");
			if (hoursText === undefined || minutesText === undefined)
				throw new Error(`Invalid schedule time "${time}"`);
			return Number(hoursText) * 60 + Number(minutesText);
		})
		.sort((a, b) => a - b);
	const nowMs = now.getTime();
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	for (const minutes of minutesOfDay) {
		const target = new Date(today);
		target.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
		if (target.getTime() > nowMs) return target.getTime() - nowMs;
	}
	const firstScheduledMinute = minutesOfDay[0];
	if (firstScheduledMinute === undefined)
		throw new Error("At least one schedule time is required");
	const tomorrow = new Date(today);
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(
		Math.floor(firstScheduledMinute / 60),
		firstScheduledMinute % 60,
		0,
		0,
	);
	return tomorrow.getTime() - nowMs;
}

function defaultSleep(
	milliseconds: number,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, milliseconds);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

function removeSignalListener(
	signals: SignalSource,
	event: "SIGINT" | "SIGTERM",
	listener: () => void,
): void {
	if (signals.off) signals.off(event, listener);
	else signals.removeListener?.(event, listener);
}

/**
 * Run loops serially. In interval mode, runs immediately, then waits
 * `intervalSeconds` after each completed scan. In scheduleTimes mode, waits
 * for the next configured "HH:MM" local time before the first and every
 * later scan; `intervalSeconds` is ignored while `scheduleTimes` is set.
 */
export async function runScheduler(input: SchedulerInput): Promise<void> {
	const scheduleTimes = input.scheduleTimes?.length
		? input.scheduleTimes
		: null;
	if (scheduleTimes) {
		for (const time of scheduleTimes)
			if (!SCHEDULE_TIME_PATTERN.test(time))
				throw new Error(
					`reviewBabysitter.scheduleTimes entries must be 24-hour "HH:MM" local times, got "${time}"`,
				);
	} else {
		const intervalSeconds = input.intervalSeconds;
		if (
			typeof intervalSeconds !== "number" ||
			!Number.isFinite(intervalSeconds) ||
			intervalSeconds < 60
		) {
			throw new Error(
				"reviewBabysitter.intervalSeconds must be at least 60 seconds",
			);
		}
	}
	const intervalMilliseconds =
		typeof input.intervalSeconds === "number"
			? input.intervalSeconds * 1000
			: 0;
	const sleep = input.sleep ?? defaultSleep;
	const signals = input.signals ?? process;
	const now = input.now ?? (() => new Date());
	let stopped = false;
	let wake: (() => void) | undefined;
	const onSignal = () => {
		stopped = true;
		wake?.();
	};
	signals.on("SIGINT", onSignal);
	signals.on("SIGTERM", onSignal);
	const wait = async (milliseconds: number): Promise<void> => {
		const controller = new AbortController();
		let waitResolve: (() => void) | undefined;
		const stoppedPromise = new Promise<void>((resolve) => {
			waitResolve = resolve;
		});
		wake = () => {
			controller.abort();
			waitResolve?.();
		};
		const sleeping = Promise.resolve()
			.then(() => sleep(milliseconds, controller.signal))
			.catch(() => undefined);
		await Promise.race([sleeping, stoppedPromise]);
		wake = undefined;
	};
	try {
		if (scheduleTimes)
			await wait(msUntilNextScheduledTime(scheduleTimes, now()));
		while (!stopped) {
			try {
				await input.runLoop();
			} catch (error) {
				logger.error("review-babysitter loop failed", {
					error: errorText(error),
				});
			}
			if (stopped) break;
			await wait(
				scheduleTimes
					? msUntilNextScheduledTime(scheduleTimes, now())
					: intervalMilliseconds,
			);
		}
	} finally {
		removeSignalListener(signals, "SIGINT", onSignal);
		removeSignalListener(signals, "SIGTERM", onSignal);
	}
}

export async function runReviewBabysitter(ctx: Context): Promise<void> {
	const config = parseConfig(ctx.config.reviewBabysitter);
	const gitHost = ctx.gitHost;
	if (!gitHost)
		throw new Error("review-babysitter requires authenticated GitLab");
	await ctx.ui.info("Review babysitter — Checking GitLab access.", {
		spinner: true,
		terminal: true,
	});
	await gitHost.preflight();
	await ctx.ui.info("Review babysitter — GitLab ready.", { terminal: true });
	const agent = ctx.createReviewBabysitterAgent(config.model);
	await ctx.ui.info("Review babysitter — Checking OMP access.", {
		spinner: true,
		terminal: true,
	});
	await agent.preflight();
	await ctx.ui.info("Review babysitter — OMP ready.", { terminal: true });
	if (!process.env[config.webhookUrlEnv]?.trim()) {
		throw new Error(
			`Missing Slack webhook environment variable: ${config.webhookUrlEnv}`,
		);
	}
	const notifier = ctx.createNotifier(config.webhookUrlEnv);
	await ctx.ui.info("Review babysitter — Slack webhook ready.", {
		terminal: true,
	});
	await runScheduler({
		intervalSeconds: config.intervalSeconds,
		scheduleTimes: config.scheduleTimes,
		runLoop: () => runOneLoop(ctx, { config, gitHost, notifier, agent }),
	});
}
export const reviewBabysitter: Feature<typeof reviewBabysitterArgs, void> = {
	name: "review-babysitter",
	description:
		"Periodically assess and safely approve configured GitLab merge requests",
	args: reviewBabysitterArgs,
	help: {
		usage: "mole-tools review-babysitter",
		examples: ["mole-tools review-babysitter"],
		notes: [
			"Requires reviewBabysitter config, authenticated glab, OMP, and its Slack webhook environment variable.",
			"Configuration: intervalSeconds defaults to 900 seconds and must be at least 60; configure assignees, aiReviewerUsername, promptFile, model, webhookUrlEnv, maxChangedLines (default 250), maxChangedFiles (default 10), and denyPathsByProject.",
			"Lifecycle: starts one scan immediately, processes merge requests serially, waits after each completed scan, and stops cleanly on SIGINT or SIGTERM without starting another scan.",
			'Scheduling: when reviewBabysitter.scheduleTimes lists 24-hour "HH:MM" local times, scans run only at those times instead of every intervalSeconds; the first scan waits for the next configured time, and intervalSeconds is ignored while scheduleTimes is set.',
			"Limits and deny-list: change and file limits are strict upper bounds where equality is allowed; every project needs an exact denyPathsByProject entry, [] explicitly denies no paths, and matching changed paths block approval.",
			"Existing auto-approval or satisfied approval requirements skip diff, deny-list, and AI gates; merge blockers and remaining required approvals are still reported.",
			"Non-goals: does not post review comments, add a requires-review label, remove labels, change assignees, rerun CI, merge requests, retry prompts or approvals, or replace interactive review.",
		],
	},
	run: async (ctx) => runReviewBabysitter(ctx),
};

export const run = runReviewBabysitter;
