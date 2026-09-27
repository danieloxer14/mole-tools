import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgentAdapter } from "../../adapters/agent/claude";
import type { AgentExec } from "../../adapters/agent/exec";
import { OmpAgentAdapter } from "../../adapters/agent/omp";
import { ConfigSchema } from "../../adapters/config/schema";
import { resolveReviewAgentConfig } from "../../core/context";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import { effectiveAgentSelection } from "./agent-selection";
import { createReviewRoutes } from "./routes";
import { type ReviewState, ReviewStateSchema } from "./state";
import { ReviewStore } from "./store";

const token = "review-effort-test-token";

function state(): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Review routes",
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
						tldr: "Generated for effort selection test.",
						files: ["src/app.ts"],
					},
				],
			}),
		);
		yield { kind: "turn_end" };
	}
}

class ChatAgent implements ReviewAgent {
	async preflight(): Promise<void> {}

	async *run(_turn: AgentTurn): AsyncIterable<AgentEvent> {
		yield { kind: "session", sessionId: "bound-session" };
		yield { kind: "text", delta: "Bound reply" };
		yield { kind: "turn_end" };
	}
}

async function runLayerSelection(
	prompt: string,
	review: { agent: "omp" | "claude"; model?: string; effort?: "auto" | "high" },
	modelCatalog?: Array<{ selector: string; thinking: string[] }>,
): Promise<
	Array<{ agent?: "omp" | "claude"; model?: string; effort?: string | null }>
> {
	const dir = await mkdtemp(join(tmpdir(), "mole-review-effort-layer-"));
	try {
		const activePromptDir = join(dir, "review-layers-code", "default");
		await mkdir(activePromptDir, { recursive: true });
		await writeFile(join(activePromptDir, "001.md"), prompt, "utf8");
		const factoryCalls: Array<{
			agent?: "omp" | "claude";
			model?: string;
			effort?: string | null;
		}> = [];
		const modelCatalogRunner = modelCatalog
			? {
					ompModelCatalogProcessRunner: async () => ({
						stdout: new TextEncoder().encode(
							JSON.stringify({ models: modelCatalog }),
						),
						stderr: new Uint8Array(),
						exitCode: 0,
					}),
				}
			: {};
		const agent = new LayerAgent();
		const routes = createReviewRoutes({
			token,
			state: state(),
			paths: {
				layersDir: join(dir, "layers"),
				promptDir: join(dir, "generated-prompts"),
				layerPath: (runId) => join(dir, "layers", `${runId}.json`),
				promptPath: (turnId) => join(dir, "generated-prompts", `${turnId}.md`),
			},
			diff,
			promptSourceDir: dir,
			config: { review },
			...modelCatalogRunner,
			createReviewAgent: (override) => {
				factoryCalls.push(override ?? {});
				return agent;
			},
		});
		const response = await routes(
			new Request(`http://127.0.0.1/api/layers/regenerate?t=${token}`, {
				method: "POST",
			}),
		);
		expect(response.status).toBe(200);
		await response.text();
		return factoryCalls;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function capturedExec(
	calls: Array<{ binary: string; args: string[] }>,
	output: string,
): AgentExec {
	return async function* (binary, args) {
		calls.push({ binary, args: [...args] });
		yield output;
	};
}

async function consume(agent: ReviewAgent, turn: AgentTurn): Promise<void> {
	for await (const _event of agent.run(turn)) {
		// Exhaust stream so injected executor captures actual invocation.
	}
}

describe("review effort selection", () => {
	test("default prompt agent inherits global model and effort separately", () => {
		expect(
			effectiveAgentSelection(
				{ agent: null, model: null },
				{ agent: "omp", model: "global-model", effort: "auto" },
			),
		).toEqual({ agent: "omp", model: "global-model", effort: "auto" });

		expect(
			effectiveAgentSelection(
				{ agent: null, model: "prompt-model" },
				{ agent: "omp", model: "global-model", effort: "auto" },
			),
		).toEqual({ agent: "omp", model: "prompt-model", effort: "auto" });
	});

	test("explicit agent with null fields does not inherit another agent defaults", () => {
		const config = ConfigSchema.parse({
			providers: {
				ollama: {
					provider: "ollama",
					baseUrl: "http://localhost:11434",
				},
			},
			models: {
				commit: { provider: "ollama", name: "qwen3.6" },
				mergeRequest: { provider: "ollama", name: "qwen3.6" },
			},
			jira: { enabled: false },
			diff: { ignore: [] },
			review: {
				agent: "omp",
				binary: "custom-omp",
				model: "global-model",
				effort: "auto",
			},
		});

		expect(resolveReviewAgentConfig(config)).toEqual({
			agent: "omp",
			binary: "custom-omp",
			model: "global-model",
			effort: "auto",
		});
		expect(
			resolveReviewAgentConfig(config, {
				agent: "claude",
				model: undefined,
				effort: null,
			}),
		).toEqual({ agent: "claude", binary: "claude", model: undefined });

		expect(
			effectiveAgentSelection(
				{ agent: "claude", model: null, effort: null },
				{ agent: "omp", model: "global-model", effort: "auto" },
			),
		).toEqual({ agent: "claude", model: null, effort: null });
	});

	test("next review layer factory receives global or active prompt selection", async () => {
		expect(
			await runLayerSelection("Default layer prompt", {
				agent: "omp",
				model: "global-model",
				effort: "auto",
			}),
		).toEqual([{ agent: "omp", model: "global-model", effort: "auto" }]);

		expect(
			await runLayerSelection(
				"---\nagent: claude\n---\nExplicit Claude prompt",
				{
					agent: "omp",
					model: "global-model",
					effort: "auto",
				},
			),
		).toEqual([{ agent: "claude", model: undefined }]);
	});
	test("active prompt metadata overrides selected fields individually", async () => {
		expect(
			await runLayerSelection(
				"---\nmodel: prompt-model\neffort: high\n---\nCustom effort prompt",
				{
					agent: "omp",
					model: "global-model",
					effort: "auto",
				},
			),
		).toEqual([{ agent: "omp", model: "prompt-model", effort: "high" }]);
	});
	test("does not send inherited effort unsupported by an overridden prompt model", async () => {
		expect(
			await runLayerSelection(
				"---\nmodel: prompt-model\n---\nDefault-agent prompt",
				{ agent: "omp", model: "global-model", effort: "high" },
				[{ selector: "prompt-model", thinking: ["low"] }],
			),
		).toEqual([{ agent: "omp", model: "prompt-model" }]);
	});

	test("new chats persist and use selected effort binding", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-effort-chat-"));
		try {
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write({ ...state(), layerStatus: "ready" });
			const factoryCalls: Array<{
				agent?: "omp" | "claude";
				model?: string;
				effort?: string | null;
			}> = [];
			const routes = createReviewRoutes({
				token,
				store,
				paths: {
					layersDir: join(dir, "layers"),
					promptDir: join(dir, "generated-prompts"),
					layerPath: (runId) => join(dir, "layers", `${runId}.json`),
					promptPath: (turnId) =>
						join(dir, "generated-prompts", `${turnId}.md`),
				},
				promptSourceDir: dir,
				config: {
					review: { agent: "omp", model: "global-model", effort: "auto" },
				},
				createReviewAgent: (override) => {
					factoryCalls.push(override ?? {});
					return new ChatAgent();
				},
			});

			const created = await routes(
				new Request(`http://127.0.0.1/api/chats?t=${token}`, {
					method: "POST",
				}),
			);
			expect(created.status).toBe(201);
			const createdBody = (await created.json()) as {
				chats: Array<{
					id: string;
					agent: "omp" | "claude" | null;
					model: string | null;
					effort: string | null;
				}>;
				activeChatId: string;
			};
			const chat = createdBody.chats.find(
				(candidate) => candidate.id === createdBody.activeChatId,
			);
			expect(chat).toMatchObject({
				agent: "omp",
				model: "global-model",
				effort: "auto",
			});

			const reply = await routes(
				new Request(`http://127.0.0.1/api/chat?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						chatId: createdBody.activeChatId,
						message: "Use bound settings",
					}),
				}),
			);
			expect(reply.status).toBe(200);
			await reply.text();
			expect(factoryCalls).toEqual([
				{ agent: "omp", model: "global-model", effort: "auto" },
			]);
			expect(
				(await store.read())?.chats.find(
					(candidate) => candidate.id === createdBody.activeChatId,
				),
			).toMatchObject({
				agent: "omp",
				model: "global-model",
				effort: "auto",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("OMP adds thinking only when selected and preserves scoped write tools", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-effort-omp-"));
		try {
			const promptPath = join(dir, "system.md");
			const writeDir = join(dir, "review-output");
			await writeFile(promptPath, "Review instructions.", "utf8");
			const calls: Array<{ binary: string; args: string[] }> = [];
			const turn: AgentTurn = {
				sessionId: "session-1",
				cwd: dir,
				systemPromptFile: promptPath,
				message: "Review changed files",
				writeDir,
			};

			await consume(
				new OmpAgentAdapter({
					binary: "omp-test",
					model: "review-model",
					effort: "high",
					exec: capturedExec(calls, '{"type":"agent_end","isTerminal":true}'),
				}),
				turn,
			);
			await consume(
				new OmpAgentAdapter({
					binary: "omp-test",
					exec: capturedExec(calls, '{"type":"agent_end","isTerminal":true}'),
				}),
				turn,
			);

			expect(calls).toEqual([
				{
					binary: "omp-test",
					args: [
						"-p",
						"--mode",
						"json",
						"--cwd",
						dir,
						"--append-system-prompt",
						promptPath,
						"--tools",
						"read,grep,glob,bash,write",
						"--model",
						"review-model",
						"--thinking",
						"high",
						"-r",
						"session-1",
						"--add-dir",
						writeDir,
						"--",
						"Review changed files",
					],
				},
				{
					binary: "omp-test",
					args: [
						"-p",
						"--mode",
						"json",
						"--cwd",
						dir,
						"--append-system-prompt",
						promptPath,
						"--tools",
						"read,grep,glob,bash,write",
						"-r",
						"session-1",
						"--add-dir",
						writeDir,
						"--",
						"Review changed files",
					],
				},
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("Claude adds effort only when selected and preserves scoped write tools", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-effort-claude-"));
		try {
			const promptPath = join(dir, "system.md");
			const writeDir = join(dir, "review-output");
			await writeFile(promptPath, "Review instructions.", "utf8");
			const calls: Array<{ binary: string; args: string[] }> = [];
			const turn: AgentTurn = {
				sessionId: "session-1",
				cwd: dir,
				systemPromptFile: promptPath,
				message: "Review changed files",
				writeDir,
			};

			await consume(
				new ClaudeAgentAdapter({
					binary: "claude-test",
					model: "claude-model",
					effort: "xhigh",
					exec: capturedExec(
						calls,
						'{"type":"system","subtype":"init","session_id":"session-1"}',
					),
				}),
				turn,
			);
			await consume(
				new ClaudeAgentAdapter({
					binary: "claude-test",
					exec: capturedExec(
						calls,
						'{"type":"system","subtype":"init","session_id":"session-1"}',
					),
				}),
				turn,
			);

			expect(calls).toEqual([
				{
					binary: "claude-test",
					args: [
						"-p",
						"--output-format",
						"stream-json",
						"--include-partial-messages",
						"--verbose",
						"--resume",
						"session-1",
						"--model",
						"claude-model",
						"--effort",
						"xhigh",
						"--append-system-prompt",
						"Review instructions.",
						"--allowedTools",
						"Read",
						"Grep",
						"Glob",
						"Bash",
						`Write(${writeDir}/**)`,
						"--permission-mode",
						"acceptEdits",
						"--add-dir",
						writeDir,
						"--add-dir",
						dir,
						"--",
						"Review changed files",
					],
				},
				{
					binary: "claude-test",
					args: [
						"-p",
						"--output-format",
						"stream-json",
						"--include-partial-messages",
						"--verbose",
						"--resume",
						"session-1",
						"--append-system-prompt",
						"Review instructions.",
						"--allowedTools",
						"Read",
						"Grep",
						"Glob",
						"Bash",
						`Write(${writeDir}/**)`,
						"--permission-mode",
						"acceptEdits",
						"--add-dir",
						writeDir,
						"--add-dir",
						dir,
						"--",
						"Review changed files",
					],
				},
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
