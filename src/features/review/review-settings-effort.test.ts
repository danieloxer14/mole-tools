import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../adapters/config/schema";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import {
	createReviewRoutes,
	type ReviewRouteHandler,
	type ReviewRoutesOptions,
} from "./routes";
import { type ReviewState, ReviewStateSchema } from "./state";

const token = "review-settings-effort-test-token";

const initialReview = {
	agent: "omp",
	binary: "custom-review-agent",
	model: "old-model",
	effort: "low",
	layerTimeoutSeconds: 90,
	largeFileLineThreshold: 950,
	maxLayerPromptBytes: 50_000,
} as const;

function state(): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Review settings",
			sourceBranch: "feature",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "base", headSha: "head" },
			syncedAt: "2026-01-01T00:00:00.000Z",
		},
		worktreePath: "/tmp/review-worktree",
		repoRoot: "/tmp/review-repo",
		layerStatus: "pending",
		layerError: null,
		layers: [],
		viewedFiles: [],
		chats: [
			{
				id: "chat-a",
				title: "",
				sessionId: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		],
		activeChatId: "chat-a",
		drafts: [],
	});
}

const diff = [
	{
		oldPath: "src/app.ts",
		newPath: "src/app.ts",
		status: "modified" as const,
		binary: false,
		insertions: 1,
		deletions: 1,
		hunks: [],
	},
];

class LayerAgent implements ReviewAgent {
	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		const outputPath = turn.message.match(/absolute path: ([^\n]+)/)?.[1];
		if (!outputPath) throw new Error("missing output path");
		await Bun.write(
			outputPath,
			JSON.stringify({
				version: 1,
				layers: [
					{
						title: "Generated layer",
						tldr: "Generated for settings effort test.",
						files: ["src/app.ts"],
					},
				],
			}),
		);
		yield { kind: "turn_end" };
	}
}

type PersistConfig = NonNullable<ReviewRoutesOptions["persistConfig"]>;
type ReviewAgentFactory = NonNullable<ReviewRoutesOptions["createReviewAgent"]>;

function makeRoutes(
	dir: string,
	options: {
		persistConfig?: PersistConfig;
		createReviewAgent?: ReviewAgentFactory | null;
	} = {},
) {
	const persisted: Partial<Config>[] = [];
	const factoryCalls: Parameters<ReviewAgentFactory>[0][] = [];
	const agent = new LayerAgent();
	const layersDir = join(dir, "layers");
	const promptDir = join(dir, "generated-prompts");
	const routes = createReviewRoutes({
		token,
		state: state(),
		diff,
		promptSourceDir: dir,
		paths: {
			layersDir,
			promptDir,
			layerPath: (runId) => join(layersDir, `${runId}.json`),
			promptPath: (turnId) => join(promptDir, `${turnId}.md`),
		},
		config: { review: initialReview },
		persistConfig: async (partial) => {
			persisted.push(partial);
			await options.persistConfig?.(partial);
		},
		createReviewAgent:
			options.createReviewAgent === null
				? undefined
				: (override) => {
						factoryCalls.push(override);
						return agent;
					},
	});
	return { routes, persisted, factoryCalls };
}

function getSettings(): Request {
	return new Request(`http://127.0.0.1/api/settings?t=${token}`);
}

function postSettings(body: unknown): Request {
	return new Request(`http://127.0.0.1/api/settings/review?t=${token}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function readReviewSettings(
	routes: ReviewRouteHandler,
): Promise<Record<string, unknown>> {
	const response = await routes(getSettings());
	expect(response.status).toBe(200);
	const body = (await response.json()) as { review: Record<string, unknown> };
	return body.review;
}

describe("global review effort settings", () => {
	test("round-trips effort, preserves review config, and applies it to next review", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-settings-effort-"));
		try {
			const { routes, persisted, factoryCalls } = makeRoutes(dir);
			expect(await readReviewSettings(routes)).toEqual({
				agent: "omp",
				model: "old-model",
				effort: "low",
				agents: ["omp", "claude"],
			});

			const saved = await routes(
				postSettings({
					agent: "claude",
					model: "custom-sonnet",
					effort: "max",
				}),
			);
			expect(saved.status).toBe(200);
			expect(await saved.json()).toEqual({
				agent: "claude",
				model: "custom-sonnet",
				effort: "max",
			});
			expect(persisted).toEqual([
				{
					review: {
						agent: "claude",
						binary: "custom-review-agent",
						model: "custom-sonnet",
						effort: "max",
						layerTimeoutSeconds: 90,
						largeFileLineThreshold: 950,
						maxLayerPromptBytes: 50_000,
					},
				},
			]);
			expect(await readReviewSettings(routes)).toEqual({
				agent: "claude",
				model: "custom-sonnet",
				effort: "max",
				agents: ["omp", "claude"],
			});

			const nextReview = await routes(
				new Request(`http://127.0.0.1/api/layers/regenerate?t=${token}`, {
					method: "POST",
				}),
			);
			expect(nextReview.status).toBe(200);
			await nextReview.text();
			expect(factoryCalls).toEqual([
				{ agent: "claude", model: "custom-sonnet", effort: "max" },
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("omitting model or effort clears that persisted default", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-settings-clear-"));
		try {
			const { routes, persisted } = makeRoutes(dir);

			const clearEffort = await routes(
				postSettings({ agent: "omp", model: "new-model" }),
			);
			expect(clearEffort.status).toBe(200);
			expect(persisted[0]).toEqual({
				review: {
					agent: "omp",
					binary: "custom-review-agent",
					model: "new-model",
					layerTimeoutSeconds: 90,
					largeFileLineThreshold: 950,
					maxLayerPromptBytes: 50_000,
				},
			});
			expect(await readReviewSettings(routes)).toEqual({
				agent: "omp",
				model: "new-model",
				agents: ["omp", "claude"],
			});

			const clearModel = await routes(
				postSettings({ agent: "claude", effort: "high" }),
			);
			expect(clearModel.status).toBe(200);
			expect(persisted[1]).toEqual({
				review: {
					agent: "claude",
					binary: "custom-review-agent",
					effort: "high",
					layerTimeoutSeconds: 90,
					largeFileLineThreshold: 950,
					maxLayerPromptBytes: 50_000,
				},
			});
			expect(await readReviewSettings(routes)).toEqual({
				agent: "claude",
				effort: "high",
				agents: ["omp", "claude"],
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects malformed selections and reports missing agent factory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-settings-invalid-"));
		try {
			const { routes, persisted } = makeRoutes(dir);
			for (const body of [
				{ agent: "codex", model: "model" },
				{ agent: "claude", model: 42 },
				{ agent: "omp", effort: "ultra" },
				{ agent: "claude", effort: "off" },
			]) {
				const response = await routes(postSettings(body));
				expect(response.status).toBe(400);
			}
			expect(persisted).toHaveLength(0);

			const noFactory = makeRoutes(dir, { createReviewAgent: null });
			const unavailable = await noFactory.routes(
				postSettings({ agent: "omp", effort: "high" }),
			);
			expect(unavailable.status).toBe(501);
			expect(noFactory.persisted).toHaveLength(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("keeps live selection unchanged when persistence fails", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-settings-failure-"));
		try {
			const { routes, persisted } = makeRoutes(dir, {
				persistConfig: async () => {
					throw new Error("disk write failed");
				},
			});
			const previous = await readReviewSettings(routes);

			const response = await routes(
				postSettings({
					agent: "claude",
					model: "new-model",
					effort: "max",
				}),
			);
			expect(response.status).toBe(500);
			expect(persisted).toHaveLength(1);
			expect(await readReviewSettings(routes)).toEqual(previous);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
