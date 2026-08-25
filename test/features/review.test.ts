import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatCommandHelp } from "../../src/features/help/format";
import { reviewFeature } from "../../src/features/review";
import { getReviewPaths } from "../../src/features/review/paths";
import { createReviewRoutes } from "../../src/features/review/routes";
import {
	type ReviewMergeRequest,
	setupReview,
} from "../../src/features/review/setup";
import {
	ensureChats,
	type ReviewState,
	ReviewStateSchema,
} from "../../src/features/review/state";
import { ReviewStore } from "../../src/features/review/store";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../src/ports/review-agent";
import type { MrRef } from "../../src/shared/mr-url";
import { FakeVcs } from "../fakes/FakeVcs";

const ref: MrRef = {
	host: "gitlab.example.com",
	projectPath: "group/api",
	iid: 42,
};

const mr: ReviewMergeRequest = {
	iid: 42,
	projectPath: ref.projectPath,
	title: "Improve API",
	webUrl: "https://gitlab.example.com/group/api/-/merge_requests/42",
	sourceBranch: "feature/api",
	targetBranch: "main",
	headSha: "head-sha",
	diffRefs: { baseSha: "base-sha", startSha: "start-sha", headSha: "head-sha" },
};

function layerState(worktreePath: string): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: ref.host,
			projectPath: ref.projectPath,
			iid: ref.iid,
			webUrl: mr.webUrl,
			title: mr.title,
			sourceBranch: mr.sourceBranch,
			targetBranch: mr.targetBranch,
		},
		revision: {
			headSha: mr.headSha,
			mergeBaseSha: "base-sha",
			diffRefs: mr.diffRefs,
			syncedAt: "2026-01-01T00:00:00.000Z",
		},
		worktreePath,
		repoRoot: "/workspace/repo",
		layerStatus: "pending",
		layerError: null,
		layers: [],
		viewedFiles: [],
		chatSessionId: null,
		drafts: [],
	});
}

function request(path: string, init?: RequestInit): Request {
	return new Request(`http://127.0.0.1${path}`, init);
}

class RouteLayerAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];
	private readonly completion = Promise.withResolvers<void>();
	readonly completed = this.completion.promise;

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		const outputPath = turn.message.match(/absolute path: ([^\n]+)/)?.[1];
		if (!outputPath) throw new Error("missing output path");
		await Bun.write(
			outputPath,
			JSON.stringify({
				version: 1,
				layers: [
					{
						title: "API layer",
						tldr: "Routes API requests.",
						files: ["src/app.ts"],
					},
				],
			}),
		);
		this.completion.resolve();
		yield { kind: "session", sessionId: `route-layer-${this.turns.length}` };
		yield { kind: "turn_end" };
	}
}
class TimeoutLayerAgent implements ReviewAgent {
	readonly signals: AbortSignal[] = [];

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		if (!turn.signal) throw new Error("missing abort signal");
		this.signals.push(turn.signal);
		await new Promise<void>((resolve) => {
			if (turn.signal?.aborted) {
				resolve();
				return;
			}
			turn.signal?.addEventListener("abort", () => resolve(), {
				once: true,
			});
		});
	}
}

describe("review feature", () => {
	test("setup uses GitLab diffRefs base SHA and filters ignored files", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-setup-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const vcs = new FakeVcs({
				repoRoot: "/workspace/repo",
				remoteUrl: "git@gitlab.example.com:group/api.git",
				mergeBase: "merge-base",
				diffRange: [
					{
						path: "src/app.ts",
						statOnly: false,
						patch: "patch",
						insertions: 2,
						deletions: 1,
					},
					{
						path: "generated/out.ts",
						statOnly: false,
						patch: "patch",
						insertions: 1,
						deletions: 0,
					},
				],
			});
			const result = await setupReview({
				vcs,
				ref,
				mr,
				cwd: "/workspace/repo",
				paths,
				config: { diff: { ignore: ["generated/**"] } },
			});

			expect(vcs.cloneCalls).toHaveLength(0);
			expect(vcs.fetchRefCalls).toEqual([
				{ repoRoot: "/workspace/repo", remote: "origin", ref: "head-sha" },
				{ repoRoot: "/workspace/repo", remote: "origin", ref: "base-sha" },
			]);
			expect(vcs.mergeBaseCalls).toEqual([]);
			expect(vcs.addWorktreeCalls).toEqual([
				{
					repoRoot: "/workspace/repo",
					path: paths.worktreePath,
					sha: "head-sha",
				},
			]);
			expect(vcs.diffRangeCalls).toEqual([
				{ repoRoot: "/workspace/repo", from: "base-sha", to: "head-sha" },
			]);
			expect(result.state.revision.mergeBaseSha).toBe("base-sha");
			expect(result.diff[1]).toMatchObject({
				path: "generated/out.ts",
				statOnly: true,
				patch: null,
			});
			expect(await Bun.file(paths.statePath).exists()).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("setup falls back to local merge-base when diffRefs are absent", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-setup-fallback-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const vcs = new FakeVcs({
				repoRoot: "/workspace/repo",
				remoteUrl: "git@gitlab.example.com:group/api.git",
				mergeBase: "merge-base",
				diffRange: [],
			});
			const result = await setupReview({
				vcs,
				ref,
				mr: { ...mr, diffRefs: undefined },
				cwd: "/workspace/repo",
				paths,
			});

			expect(vcs.fetchRefCalls).toEqual([
				{ repoRoot: "/workspace/repo", remote: "origin", ref: "head-sha" },
			]);
			expect(vcs.mergeBaseCalls).toEqual([
				{ repoRoot: "/workspace/repo", a: "main", b: "head-sha" },
			]);
			expect(vcs.diffRangeCalls).toEqual([
				{ repoRoot: "/workspace/repo", from: "merge-base", to: "head-sha" },
			]);
			expect(result.state.revision.mergeBaseSha).toBe("merge-base");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("reopens an existing review at its stored revision until explicit refresh", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-reopen-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const previous = ReviewStateSchema.parse({
				...layerState(paths.worktreePath),
				layers: [
					{
						id: "layer-1",
						title: "API",
						tldr: "API layer",
						files: ["src/app.ts"],
						bdd: [],
						done: true,
						stale: false,
					},
				],
			});
			const store = new ReviewStore(paths);
			await store.write(previous);
			const vcs = new FakeVcs({
				repoRoot: previous.repoRoot,
				diffRange: [
					{
						path: "src/app.ts",
						statOnly: false,
						patch: "stored revision patch",
						insertions: 1,
						deletions: 0,
					},
				],
			});
			const result = await setupReview({
				vcs,
				ref,
				mr: {
					...mr,
					headSha: "head-2",
					diffRefs: {
						baseSha: "base-2",
						startSha: "base-2",
						headSha: "head-2",
					},
				},
				paths,
				store,
			});

			expect(result.state).toEqual(ensureChats(previous));
			expect(vcs.fetchRefCalls).toEqual([]);
			expect(vcs.mergeBaseCalls).toEqual([]);
			expect(vcs.addWorktreeCalls).toEqual([]);
			expect(vcs.diffRangeCalls).toEqual([
				{
					repoRoot: previous.repoRoot,
					from: previous.revision.mergeBaseSha,
					to: previous.revision.headSha,
				},
			]);
			expect(await store.read()).toEqual(ensureChats(previous));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("setup clones into the cache when cwd remote does not match", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-clone-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const vcs = new FakeVcs({
				repoRoot: "/workspace/other",
				diffRange: [],
			});
			await setupReview({ vcs, ref, mr, cwd: "/workspace/other", paths });
			expect(vcs.cloneCalls).toEqual([
				{
					remoteUrl: "https://gitlab.example.com/group/api.git",
					destination: paths.repoPath,
				},
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("refresh discards a failed layer run so the guide can run against the new head", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-refresh-failed-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const store = new ReviewStore(paths);
			await store.write(
				ReviewStateSchema.parse({
					...layerState(paths.worktreePath),
					layerStatus: "failed",
					layerError: "Error: Unknown tool in --tools: list.",
				}),
			);
			const vcs = new FakeVcs({ repoRoot: "/workspace/repo", diffRange: [] });
			const result = await setupReview({
				vcs,
				ref,
				mr: { ...mr, headSha: "head-2" },
				paths,
				store,
				refresh: true,
			});

			expect(vcs.fetchRefCalls).toEqual([
				{ repoRoot: "/workspace/repo", remote: "origin", ref: "head-2" },
				{ repoRoot: "/workspace/repo", remote: "origin", ref: "base-sha" },
			]);
			expect(vcs.mergeBaseCalls).toEqual([]);
			expect(vcs.diffRangeCalls).toEqual([
				{ repoRoot: "/workspace/repo", from: "base-sha", to: "head-2" },
			]);
			expect(result.state.revision.mergeBaseSha).toBe("base-sha");
			expect(result.state.layerStatus).toBe("pending");
			expect(result.state.layerError).toBeNull();
			expect(result.state.revision.headSha).toBe("head-2");
			expect((await store.read())?.layerStatus).toBe("pending");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("starts pending layers, streams regeneration, and reopens cached layers", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-route-layers-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const store = new ReviewStore(paths);
			await store.write(layerState(join(dir, "worktree")));
			const agent = new RouteLayerAgent();
			const parsedDiff = [
				{
					oldPath: "src/app.ts",
					newPath: "src/app.ts",
					status: "modified" as const,
					binary: false,
					insertions: 1,
					deletions: 0,
					hunks: [],
				},
			];
			const routes = createReviewRoutes({
				token: "route-layer-token",
				store,
				paths,
				diff: parsedDiff,
				layerDiff: [
					{
						path: "src/app.ts",
						statOnly: false,
						patch: "diff --git a/src/app.ts b/src/app.ts",
						insertions: 1,
						deletions: 0,
					},
				],
				layerAgent: agent,
			});

			const first = await routes(request("/api/state?t=route-layer-token"));
			expect(first.status).toBe(200);
			expect((await first.json()).diff).toEqual(parsedDiff);
			const stream = await routes(
				request("/api/layers/regenerate?t=route-layer-token", {
					method: "POST",
				}),
			);
			const body = await stream.text();
			expect(body).toContain('event: status\ndata: {"status":"running"}');
			expect(body).toContain('event: done\ndata: {"status":"ready"');
			expect(body.endsWith("\n\n")).toBe(true);
			expect(agent.turns).toHaveLength(1);

			const cached = await routes(request("/api/state?t=route-layer-token"));
			expect((await cached.json()).layerStatus).toBe("ready");

			const retryStream = await routes(
				request("/api/layers/retry?t=route-layer-token", {
					method: "POST",
				}),
			);
			expect((await retryStream.text()).endsWith("\n\n")).toBe(true);
			expect(agent.turns).toHaveLength(2);

			const reopenedAgent = new RouteLayerAgent();
			const reopened = createReviewRoutes({
				token: "route-layer-token",
				store: new ReviewStore(paths),
				paths,
				layerAgent: reopenedAgent,
			});
			const reopenedState = await reopened(
				request("/api/state?t=route-layer-token"),
			);
			expect((await reopenedState.json()).layerStatus).toBe("ready");
			expect(reopenedAgent.turns).toHaveLength(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("times out layer regeneration, persists failure, and closes SSE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-route-timeout-"));
		try {
			const paths = getReviewPaths(ref, join(dir, "config.json"));
			const store = new ReviewStore(paths);
			await store.write(layerState(join(dir, "worktree")));
			const agent = new TimeoutLayerAgent();
			const routes = createReviewRoutes({
				token: "route-timeout-token",
				store,
				paths,
				layerAgent: agent,
				config: { review: { layerTimeoutSeconds: 0.01 } },
			});

			const response = await routes(
				request("/api/layers/regenerate?t=route-timeout-token", {
					method: "POST",
				}),
			);
			const body = await response.text();

			expect(agent.signals[0]?.aborted).toBe(true);
			expect(body).toContain(
				'event: error\ndata: {"message":"Layer agent timed out after 0.01 seconds"}',
			);
			expect(body).toContain(
				'event: done\ndata: {"status":"failed","layers":[]}',
			);
			expect((await store.read())?.layerStatus).toBe("failed");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("help shows review URL as positional and review flags", () => {
		const result = formatCommandHelp([reviewFeature], "review");
		if (!result.ok) throw new Error("review help missing");
		expect(result.text).toContain(
			"mole-tools review <mr-url> [--mode code|plan] [--no-open] [--refresh]",
		);
		expect(result.text).not.toContain("--url");
		expect(result.text).toContain("--mode <mode>");
		expect(result.text).toContain(
			"mole-tools review https://gitlab.com/acme/api/-/merge_requests/42",
		);
		expect(result.text).toContain(
			"mole-tools review https://gitlab.com/acme/api/-/merge_requests/42 --mode plan",
		);
		expect(result.text).not.toContain("mole-tools review mole-tools review");
	});
});
