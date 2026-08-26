import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import type { IssueTracker } from "../../ports/issue-tracker";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import type { FileDiff } from "../../ports/vcs";
import {
	buildLayerInput,
	generateLayers,
	type LayerGenerationOptions,
} from "./layers";
import { getReviewPaths } from "./paths";
import { type ReviewState, ReviewStateSchema } from "./state";
import { ReviewStore } from "./store";

const ref = {
	host: "gitlab.example.com",
	projectPath: "group/project",
	iid: 42,
};

function state(
	worktreePath: string,
	mode: ReviewState["mode"] = "code",
): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode,
		mr: {
			host: ref.host,
			projectPath: ref.projectPath,
			iid: ref.iid,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Add review layers",
			sourceBranch: "feature/REV-42-layers",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "start", headSha: "head" },
			syncedAt: "2026-01-01T00:00:00.000Z",
		},
		worktreePath,
		repoRoot: "/repo",
		layerStatus: "pending",
		layerError: null,
		layers: [],
		viewedFiles: [],
		drafts: [],
	});
}

const diff: FileDiff[] = [
	{
		path: "src/app.ts",
		statOnly: false,
		patch: "diff --git a/src/app.ts b/src/app.ts\n+new",
		insertions: 1,
		deletions: 0,
	},
];

const layerDoc = {
	version: 1 as const,
	layers: [
		{
			title: "Application layer",
			tldr: "Routes the review request.",
			files: ["src/app.ts"],
			bdd: ["Given a request, When it arrives, Then route it."],
		},
	],
};
const MISSING = Symbol("missing output");

class WritingAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];
	readonly prompts: string[] = [];
	private index = 0;

	constructor(private readonly outputs: (string | object | typeof MISSING)[]) {}

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		if (turn.systemPromptFile) {
			this.prompts.push(await Bun.file(turn.systemPromptFile).text());
		}
		const output =
			this.outputs[Math.min(this.index++, this.outputs.length - 1)];
		const match = turn.message.match(/absolute path: ([^\n]+)/);
		if (output !== MISSING && match?.[1]) {
			await Bun.write(
				match[1],
				typeof output === "string" ? output : JSON.stringify(output),
			);
		}
		yield { kind: "session", sessionId: `layer-${this.index}` };
		yield { kind: "turn_end" };
	}
}
class HangingAgent implements ReviewAgent {
	signal: AbortSignal | null = null;

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.signal = turn.signal ?? null;
		await new Promise<void>((resolve) => {
			if (!turn.signal || turn.signal.aborted) {
				resolve();
				return;
			}
			turn.signal.addEventListener("abort", () => resolve(), {
				once: true,
			});
		});
	}
}

async function generationOptions(
	dir: string,
	agent: ReviewAgent,
	store: ReviewStore,
): Promise<LayerGenerationOptions> {
	const paths = getReviewPaths(ref, join(dir, "config.json"));
	return {
		agent,
		state: state(join(dir, "worktree")),
		store,
		paths,
		diff,
		vcs: new FakeVcs({
			log: [
				{
					sha: "commit",
					subject: "add layers",
					author: "dev",
					date: "2026-01-01",
				},
			],
		}),
		getDiscussions: async () => [],
		promptText: "Write a layer document.",
	};
}

describe("review layer generation", () => {
	test("constructs input from commits, stats, diff, discussions, and Jira", async () => {
		const vcs = new FakeVcs({
			log: [
				{
					sha: "commit-1",
					subject: "add review",
					author: "dev",
					date: "2026-01-01",
				},
			],
		});
		const issue: IssueTracker = {
			fetchIssue: async (key) => ({
				key,
				summary: "Review layers",
				description: "Add generation",
			}),
		};
		const input = await buildLayerInput({
			state: state("/worktree"),
			outputPath: "/reviews/layers/run.json",
			vcs,
			diff,
			discussions: [],
			issues: issue,
			config: { jira: { enabled: true, branchPattern: "REV-[0-9]+" } },
		});

		expect(input.commits[0]?.sha).toBe("commit-1");
		expect(vcs.logCalls).toEqual([
			{ base: "base", head: "head", cwd: "/worktree" },
		]);
		expect(input.files).toEqual([
			{ path: "src/app.ts", insertions: 1, deletions: 0, statOnly: false },
		]);
		expect(input.unifiedDiff).toContain("diff --git");
		expect(input.jira?.key).toBe("REV-42");
	});

	test("matches configured Jira pattern independently against title", async () => {
		const baseState = state("/worktree");
		const reviewState: ReviewState = {
			...baseState,
			mr: {
				...baseState.mr,
				sourceBranch: "feature/no-ticket",
				title: "REV-99",
			},
		};
		const issue: IssueTracker = {
			fetchIssue: async (key) => ({
				key,
				summary: "Matched title",
				description: "",
			}),
		};
		const input = await buildLayerInput({
			state: reviewState,
			diff,
			issues: issue,
			config: { jira: { enabled: true, branchPattern: "^REV-[0-9]+$" } },
		});

		expect(input.jira?.key).toBe("REV-99");
	});

	test("validates, filters unknown files, and persists the cached guide", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-layers-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const store = new ReviewStore(paths);
			const agent = new WritingAgent([
				{
					version: 1,
					layers: [
						{ ...layerDoc.layers[0], files: ["src/app.ts", "missing.ts"] },
						{ ...layerDoc.layers[0], title: "Dropped", files: ["missing.ts"] },
					],
				},
			]);
			const result = await generateLayers(
				await generationOptions(dir, agent, store),
			);

			expect(result.state.layerStatus).toBe("ready");
			expect(result.state.layers).toHaveLength(1);
			expect(result.state.layers[0]?.title).toBe("Application layer");
			expect(result.state.layers[0]?.tldr).toBe("Routes the review request.");
			expect(result.state.layers[0]?.files).toEqual(["src/app.ts"]);
			expect(result.state.layers[0]?.bdd).toEqual(layerDoc.layers[0]?.bdd);
			expect((await store.read())?.layers).toEqual(result.state.layers);
			expect(agent.turns).toHaveLength(1);
			expect(agent.turns[0]?.message).toContain("bash");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	test("selects mode-specific layer prompts", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-layers-prompts-"));
		try {
			const promptDir = join(dir, "prompts");
			await mkdir(promptDir, { recursive: true });
			await Bun.write(
				join(promptDir, "review-layers-code.md"),
				"CODE LAYERS PROMPT",
			);
			await Bun.write(
				join(promptDir, "review-layers-plan.md"),
				"PLAN LAYERS PROMPT",
			);

			const planAgent = new WritingAgent([layerDoc]);
			const planOptions = await generationOptions(
				dir,
				planAgent,
				new ReviewStore(getReviewPaths(ref, join(dir, "plan", "config.json"))),
			);
			planOptions.state = state(join(dir, "plan-worktree"), "plan");
			planOptions.promptText = undefined;
			planOptions.promptSourceDir = promptDir;
			await generateLayers(planOptions);
			expect(planAgent.prompts[0]).toContain("PLAN LAYERS PROMPT");
			expect(planAgent.prompts[0]).not.toContain("CODE LAYERS PROMPT");

			const codeAgent = new WritingAgent([layerDoc]);
			const codeOptions = await generationOptions(
				dir,
				codeAgent,
				new ReviewStore(getReviewPaths(ref, join(dir, "code", "config.json"))),
			);
			codeOptions.state = state(join(dir, "code-worktree"), "code");
			codeOptions.promptText = undefined;
			codeOptions.promptSourceDir = promptDir;
			await generateLayers(codeOptions);
			expect(codeAgent.prompts[0]).toContain("CODE LAYERS PROMPT");
			expect(codeAgent.prompts[0]).not.toContain("PLAN LAYERS PROMPT");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("retries malformed output exactly once", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-layers-retry-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const store = new ReviewStore(paths);
			const agent = new WritingAgent(["not json", layerDoc]);
			const result = await generateLayers(
				await generationOptions(dir, agent, store),
			);

			expect(result.state.layerStatus).toBe("ready");
			expect(result.attempts).toBe(2);
			expect(agent.turns).toHaveLength(2);
			expect(agent.turns[1]?.message).toContain(
				"Previous output validation failed",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("retries missing output once and leaves retryable failed state", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-layers-failed-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const store = new ReviewStore(paths);
			const agent = new WritingAgent([MISSING, MISSING]);
			const result = await generateLayers(
				await generationOptions(dir, agent, store),
			);

			expect(result.state.layerStatus).toBe("failed");
			expect(result.state.layerError).toContain("did not write output file");
			expect(result.attempts).toBe(2);
			expect(agent.turns).toHaveLength(2);
			expect((await store.read())?.layerStatus).toBe("failed");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("aborts timed out agents and persists retryable failure", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-layers-timeout-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const store = new ReviewStore(paths);
			const agent = new HangingAgent();
			const result = await generateLayers({
				...(await generationOptions(dir, agent, store)),
				config: { review: { layerTimeoutSeconds: 0.01 } },
			});

			expect(agent.signal?.aborted).toBe(true);
			expect(result.state.layerStatus).toBe("failed");
			expect(result.state.layerError).toContain("timed out");
			expect(result.attempts).toBe(1);
			expect((await store.read())?.layerStatus).toBe("failed");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
