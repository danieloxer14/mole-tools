import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { FakeReviewAgent } from "../../../test/fakes/FakeReviewAgent";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import type { FileDiff } from "../../ports/vcs";
import { getReviewPaths } from "../review/paths";
import type { ReviewMergeRequest } from "../review/setup";
import {
	assessRisk,
	REVIEW_BABYSITTER_VERDICT_INSTRUCTION,
} from "./assessment";

const ref = {
	host: "gitlab.example.com",
	projectPath: "group/api",
	iid: 42,
};

const diff: FileDiff[] = [
	{
		path: "src/api.ts",
		statOnly: false,
		patch: "@@ -1 +1 @@",
		insertions: 3,
		deletions: 1,
	},
	{
		path: "README.md",
		statOnly: false,
		patch: "@@ -1 +1 @@",
		insertions: 1,
		deletions: 0,
	},
];

function mergeRequest(): ReviewMergeRequest {
	return {
		iid: ref.iid,
		projectPath: ref.projectPath,
		title: "Improve API",
		description: "",
		webUrl: "https://gitlab.example.com/group/api/-/merge_requests/42",
		sourceBranch: "feature/api",
		targetBranch: "main",
		headSha: "abcdef1234567890",
		diffRefs: {
			baseSha: "base-sha",
			startSha: "base-sha",
			headSha: "abcdef1234567890",
		},
	};
}

async function fixture(
	events: AgentEvent[],
	vcsOptions: ConstructorParameters<typeof FakeVcs>[0] = {},
) {
	const root = await mkdtemp(join("/tmp", "mole-babysitter-assess-"));
	const promptFile = join(root, "prompt.md");
	await Bun.write(promptFile, "Assess risk.");
	const reviewPaths = getReviewPaths(ref, join(root, "config.json"));
	const vcs = new FakeVcs({
		...vcsOptions,
		remoteUrl: null,
		diffRange: diff,
	});
	const agent = new FakeReviewAgent({ events });
	const result = await assessRisk({
		vcs,
		agent,
		ref,
		mr: mergeRequest(),
		config: { promptFile, model: "risk-model" },
		paths: reviewPaths,
		cwd: root,
	});
	return { root, promptFile, reviewPaths, vcs, agent, result };
}

const lowEvents: AgentEvent[] = [
	{ kind: "session", sessionId: "assessment-1" },
	{ kind: "text", delta: "Review complete.\nVERDICT: LOW — No material risk." },
	{ kind: "turn_end" },
];

describe("assessRisk", () => {
	test("reuses cache, prepares complete diff, runs read-only, and cleans up", async () => {
		const result = await fixture(lowEvents);
		try {
			expect(result.result).toEqual({
				kind: "low",
				reason: "No material risk.",
			});
			expect(result.vcs.cloneCalls).toHaveLength(1);
			expect(result.vcs.fetchRefCalls).toEqual([
				{
					repoRoot: result.reviewPaths.repoPath,
					remote: "origin",
					ref: "abcdef1234567890",
				},
				{
					repoRoot: result.reviewPaths.repoPath,
					remote: "origin",
					ref: "base-sha",
				},
			]);
			expect(result.vcs.diffRangeCalls).toEqual([
				{
					repoRoot: result.reviewPaths.repoPath,
					from: "base-sha",
					to: "abcdef1234567890",
				},
			]);
			expect(result.vcs.addWorktreeCalls).toEqual([
				{
					repoRoot: result.reviewPaths.repoPath,
					path: join(
						result.reviewPaths.worktreesRoot,
						"gitlab.example.com",
						"group",
						"api",
						"babysitter-mr-42-abcdef123456",
					),
					sha: "abcdef1234567890",
				},
			]);
			expect(result.vcs.removeWorktreeCalls).toEqual([
				{
					path: result.vcs.addWorktreeCalls[0]?.path,
					repoRoot: result.reviewPaths.repoPath,
				},
			]);
			expect(result.vcs.removeWorktreeCalls[0]?.path).not.toBe(
				result.reviewPaths.worktreePath,
			);

			const turn = result.agent.turns[0];
			expect(turn).toBeDefined();
			expect("writeDir" in (turn as AgentTurn)).toBe(false);
			expect(turn?.cwd).toBe(result.vcs.addWorktreeCalls[0]?.path);
			expect(turn?.systemPromptFile).toBe(result.promptFile);
			expect(turn?.message).toContain(
				"MR URL: https://gitlab.example.com/group/api/-/merge_requests/42",
			);
			expect(turn?.message).toContain("Title: Improve API");
			expect(turn?.message).toContain("Project: group/api");
			expect(turn?.message).toContain("Head SHA: abcdef1234567890");
			expect(turn?.message).toContain("Base SHA: base-sha");
			expect(turn?.message).toContain("Total additions: 4");
			expect(turn?.message).toContain("Total deletions: 1");
			expect(turn?.message).toContain("Total changes: 5");
			expect(turn?.message).toContain("- src/api.ts");
			expect(turn?.message).toContain(REVIEW_BABYSITTER_VERDICT_INSTRUCTION);
		} finally {
			await rm(result.root, { recursive: true, force: true });
		}
	});

	test.each([
		["MEDIUM", { kind: "risk", risk: "MEDIUM", reason: "Needs review." }],
		["HIGH", { kind: "risk", risk: "HIGH", reason: "Unsafe change." }],
	] as const)("returns non-low for %s", async (risk, expected) => {
		const result = await fixture([
			{ kind: "text", delta: `VERDICT: ${risk} — ${expected.reason}` },
			{ kind: "turn_end" },
		]);
		try {
			expect(result.result).toEqual(expected);
		} finally {
			await rm(result.root, { recursive: true, force: true });
		}
	});

	test("parses only final non-empty full line and ignores later events", async () => {
		const result = await fixture([
			{ kind: "text", delta: "Reasoning\nVERDICT: LOW — Safe." },
			{ kind: "turn_end" },
			{ kind: "text", delta: "\nnot a verdict" },
		]);
		try {
			expect(result.result).toEqual({ kind: "low", reason: "Safe." });
		} finally {
			await rm(result.root, { recursive: true, force: true });
		}
	});

	test.each([
		"",
		"VERDICT: LOW —",
		"VERDICT LOW — Safe.",
		"VERDICT: low — Safe.",
		"VERDICT: LOW - Safe.",
		"VERDICT: LOW — Safe.\nA trailing line",
	])("returns inconclusive for malformed or missing verdict %p", async (text) => {
		const result = await fixture([
			{ kind: "text", delta: text },
			{ kind: "turn_end" },
		]);
		try {
			expect(result.result).toEqual({ kind: "inconclusive" });
		} finally {
			await rm(result.root, { recursive: true, force: true });
		}
	});

	test("returns inconclusive for agent, checkout, prompt, and cleanup failures", async () => {
		const agentFailure = await fixture(lowEvents, {
			fetchError: new Error("fetch failed"),
		});
		expect(agentFailure.result).toEqual({ kind: "inconclusive" });
		await rm(agentFailure.root, { recursive: true, force: true });

		const promptRoot = await mkdtemp(join("/tmp", "mole-babysitter-prompt-"));
		const promptPaths = getReviewPaths(ref, join(promptRoot, "config.json"));
		const promptVcs = new FakeVcs({ remoteUrl: null, diffRange: diff });
		const promptResult = await assessRisk({
			vcs: promptVcs,
			agent: new FakeReviewAgent({ events: lowEvents }),
			ref,
			mr: mergeRequest(),
			config: {
				promptFile: join(promptRoot, "missing.md"),
				model: "risk-model",
			},
			paths: promptPaths,
			cwd: promptRoot,
		});
		expect(promptResult).toEqual({ kind: "inconclusive" });
		expect(promptVcs.cloneCalls).toEqual([]);
		await rm(promptRoot, { recursive: true, force: true });

		const cleanup = await fixture(lowEvents, {
			removeWorktreeError: new Error("cleanup failed"),
		});
		expect(cleanup.result).toEqual({ kind: "inconclusive" });
		await rm(cleanup.root, { recursive: true, force: true });
	});

	test("returns inconclusive when agent emits no terminal output or times out", async () => {
		const noTerminal = await fixture([
			{ kind: "session", sessionId: "assessment-2" },
			{ kind: "text", delta: "VERDICT: LOW — Safe." },
		]);
		expect(noTerminal.result).toEqual({ kind: "inconclusive" });
		await rm(noTerminal.root, { recursive: true, force: true });

		const root = await mkdtemp(join("/tmp", "mole-babysitter-timeout-"));
		const promptFile = join(root, "prompt.md");
		await Bun.write(promptFile, "Assess risk.");
		const reviewPaths = getReviewPaths(ref, join(root, "config.json"));
		const hanging: ReviewAgent = {
			async preflight() {},
			async *run(turn: AgentTurn) {
				await new Promise<void>((resolve) => {
					if (turn.signal?.aborted) resolve();
					else
						turn.signal?.addEventListener("abort", () => resolve(), {
							once: true,
						});
				});
			},
		};
		const vcs = new FakeVcs({ remoteUrl: null, diffRange: diff });
		const timeoutResult = await assessRisk({
			vcs,
			agent: hanging,
			ref,
			mr: mergeRequest(),
			config: { promptFile, model: "risk-model" },
			paths: reviewPaths,
			cwd: root,
			timeoutMs: 5,
		});
		expect(timeoutResult).toEqual({ kind: "inconclusive" });
		expect(vcs.removeWorktreeCalls).toHaveLength(1);
		await rm(root, { recursive: true, force: true });
	});
});
