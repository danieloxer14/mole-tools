import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ReviewBabysitterConfig } from "../../adapters/config/schema";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import type { FileDiff, Vcs } from "../../ports/vcs";
import type { MrRef } from "../../shared/mr-url";
import { getReviewPaths, type ReviewPaths } from "../review/paths";
import {
	prepareReviewRevision,
	type ReviewMergeRequest,
	resolveReviewRepo,
} from "../review/setup";
import { getReviewBabysitterPaths, type ReviewBabysitterPaths } from "./paths";

export type AssessmentResult =
	| { kind: "low"; reason: string }
	| { kind: "risk"; risk: "MEDIUM" | "HIGH"; reason: string }
	| { kind: "inconclusive" };

export interface AssessRiskInput {
	vcs: Vcs;
	agent: ReviewAgent;
	ref: MrRef;
	mr: ReviewMergeRequest;
	config: Pick<ReviewBabysitterConfig, "promptFile" | "model">;
	/** Optional review paths make isolated lifecycle tests independent of HOME. */
	paths?: ReviewPaths;
	/** Optional repository cwd for reuse by resolveReviewRepo. */
	cwd?: string;
	/** Test seam; production default is the required 120-second timeout. */
	timeoutMs?: number;
}

export const REVIEW_BABYSITTER_TIMEOUT_MS = 120_000;
export const REVIEW_BABYSITTER_VERDICT_INSTRUCTION =
	"Finish with exactly one final non-empty line: VERDICT: LOW — <one-sentence reason>\nReplace LOW only with MEDIUM or HIGH when applicable. Any other final line is invalid.";

function promptPath(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function completeDiff(diff: FileDiff[]): boolean {
	return diff.every(
		(file) =>
			typeof file.path === "string" &&
			file.path.trim().length > 0 &&
			!file.statOnly &&
			Number.isFinite(file.insertions) &&
			file.insertions >= 0 &&
			Number.isFinite(file.deletions) &&
			file.deletions >= 0,
	);
}

function diffStats(diff: FileDiff[]): {
	insertions: number;
	deletions: number;
	total: number;
} {
	const insertions = diff.reduce((sum, file) => sum + file.insertions, 0);
	const deletions = diff.reduce((sum, file) => sum + file.deletions, 0);
	return { insertions, deletions, total: insertions + deletions };
}

function assessmentMessage(
	ref: MrRef,
	mr: ReviewMergeRequest,
	baseSha: string,
	diff: FileDiff[],
): string {
	const stats = diffStats(diff);
	return [
		"Assess merge request risk from the detached read-only worktree.",
		`MR URL: ${mr.webUrl}`,
		`Project: ${ref.projectPath}`,
		`MR IID: ${mr.iid}`,
		`Title: ${mr.title}`,
		`Head SHA: ${mr.headSha}`,
		`Base SHA: ${baseSha}`,
		`Total additions: ${stats.insertions}`,
		`Total deletions: ${stats.deletions}`,
		`Total changes: ${stats.total}`,
		`Changed paths (${diff.length}):`,
		...(diff.length > 0 ? diff.map((file) => `- ${file.path}`) : ["- (none)"]),
		"",
		REVIEW_BABYSITTER_VERDICT_INSTRUCTION,
	].join("\n");
}

function parseVerdict(text: string): AssessmentResult {
	const lines = text.split(/\r?\n/);
	let finalLine: string | undefined;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (line !== undefined && line.trim().length > 0) {
			finalLine = line;
			break;
		}
	}
	if (finalLine === undefined) return { kind: "inconclusive" };

	const match = finalLine.match(/^VERDICT: (LOW|MEDIUM|HIGH) — (.+)$/);
	if (!match || match[2]?.trim().length === 0) {
		return { kind: "inconclusive" };
	}
	const reason = match[2].trim();
	if (match[1] === "LOW") return { kind: "low", reason };
	return { kind: "risk", risk: match[1], reason };
}

async function runAgent(
	agent: ReviewAgent,
	turn: AgentTurn,
	timeoutMs: number,
): Promise<AssessmentResult> {
	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let iterator: AsyncIterator<AgentEvent> | undefined;
	let terminal = false;
	let agentFailed = false;
	let text = "";

	try {
		const iterable = agent.run({ ...turn, signal: controller.signal });
		iterator = iterable[Symbol.asyncIterator]();
		const consume = async (): Promise<"complete"> => {
			while (true) {
				const next = await iterator?.next();
				if (!next || next.done) return "complete";
				if (terminal) continue;
				if (next.value.kind === "text") text += next.value.delta;
				if (next.value.kind === "error" || next.value.kind === "diagnostic") {
					agentFailed = true;
				}
				if (next.value.kind === "turn_end") terminal = true;
			}
		};
		let timedOut = false;
		const timeout = new Promise<"timeout">((resolve) => {
			timeoutId = setTimeout(() => {
				timedOut = true;
				controller.abort();
				resolve("timeout");
			}, timeoutMs);
		});
		const result = await Promise.race([consume(), timeout]);
		if (result === "timeout" || timedOut) {
			try {
				void Promise.resolve(iterator.return?.()).catch(() => undefined);
			} catch {
				// Iterator cleanup cannot turn a timeout into a low-risk result.
			}
			return { kind: "inconclusive" };
		}
	} catch {
		return { kind: "inconclusive" };
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}

	if (!terminal || agentFailed) return { kind: "inconclusive" };
	return parseVerdict(text);
}

/** Assess one MR in a transient detached worktree without GitLab side effects. */
export async function assessRisk(
	input: AssessRiskInput,
): Promise<AssessmentResult> {
	const systemPromptFile = promptPath(input.config.promptFile);
	try {
		await Bun.file(systemPromptFile).text();
	} catch {
		return { kind: "inconclusive" };
	}

	const reviewPaths = input.paths ?? getReviewPaths(input.ref);
	const babysitterPaths: ReviewBabysitterPaths = getReviewBabysitterPaths(
		input.ref,
		input.mr.headSha,
		reviewPaths,
	);
	let result: AssessmentResult = { kind: "inconclusive" };
	let cleanupRequired = false;
	let repoRoot: string | undefined;

	try {
		repoRoot = await resolveReviewRepo({
			vcs: input.vcs,
			ref: input.ref,
			cwd: input.cwd,
			paths: reviewPaths,
		});
		const revision = await prepareReviewRevision({
			vcs: input.vcs,
			repoRoot,
			mr: input.mr,
		});
		const diff = await input.vcs.diffRange(
			repoRoot,
			revision.mergeBaseSha,
			input.mr.headSha,
		);
		if (!completeDiff(diff)) return result;

		await mkdir(dirname(babysitterPaths.worktreePath), { recursive: true });
		cleanupRequired = true;
		await input.vcs.addWorktree({
			repoRoot,
			path: babysitterPaths.worktreePath,
			sha: input.mr.headSha,
		});

		result = await runAgent(
			input.agent,
			{
				cwd: babysitterPaths.worktreePath,
				systemPromptFile,
				message: assessmentMessage(
					input.ref,
					input.mr,
					revision.diffRefs.baseSha,
					diff,
				),
			},
			input.timeoutMs ?? REVIEW_BABYSITTER_TIMEOUT_MS,
		);
	} catch {
		result = { kind: "inconclusive" };
	} finally {
		if (cleanupRequired && repoRoot) {
			try {
				await input.vcs.removeWorktree(babysitterPaths.worktreePath, repoRoot);
			} catch {
				result = { kind: "inconclusive" };
			}
		}
	}
	return result;
}
