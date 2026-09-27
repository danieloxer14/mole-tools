import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEffort } from "../../adapters/agent/effort";
import type { HostDiscussion } from "../../ports/git-host";
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
import { type ReviewStateMutation, ReviewStore } from "./store";

const token = "chat-effort-test-token";
const createdAt = "2026-09-26T00:00:00.000Z";

type ChatSeed = Partial<ReviewState["chats"][number]> &
	Pick<ReviewState["chats"][number], "id">;

type AgentOverride = {
	agent?: "omp" | "claude";
	model?: string;
	effort?: AgentEffort | null;
};

type AgentFactory = NonNullable<ReviewRoutesOptions["createReviewAgent"]>;

class ChatEffortAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];

	constructor(
		private readonly runError: Error | null = null,
		private readonly generatedComment = "Generated comment body",
	) {}

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		if (this.runError) throw this.runError;
		const outputPath = /^Output file: (.+)$/m.exec(turn.message)?.[1];
		if (outputPath) await Bun.write(outputPath, this.generatedComment);
		yield { kind: "text", delta: "Reply" };
		yield { kind: "turn_end" };
	}
}

class SwitchableReviewStore extends ReviewStore {
	failMutations = false;

	override async mutate(mutator: ReviewStateMutation): Promise<ReviewState> {
		if (this.failMutations) throw new Error("injected binding write failure");
		return super.mutate(mutator);
	}
}

function reviewState(
	dir: string,
	options: { chat?: ChatSeed; drafts?: ReviewState["drafts"] } = {},
): ReviewState {
	const chat = {
		id: "chat-a",
		title: "",
		sessionId: null,
		createdAt,
		agent: null,
		model: null,
		effort: null,
		...options.chat,
	};
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Chat effort",
			sourceBranch: "feature",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "base", headSha: "head" },
			syncedAt: createdAt,
		},
		worktreePath: dir,
		repoRoot: dir,
		layerStatus: "pending",
		layerError: null,
		layers: [],
		chats: [chat],
		activeChatId: chat.id,
		drafts: options.drafts ?? [],
	});
}

function storePaths(dir: string) {
	return {
		statePath: join(dir, "review.json"),
		chatPath: join(dir, "chat.ndjson"),
		chatsDir: join(dir, "chats"),
	};
}

function routePaths(dir: string) {
	return {
		layersDir: join(dir, "layers"),
		promptDir: join(dir, "prompt"),
		layerPath: (runId: string) => join(dir, "layers", `${runId}.json`),
		promptPath: (turnId: string) => join(dir, "prompt", `${turnId}.md`),
	};
}

async function makeStore(
	dir: string,
	options: { chat?: ChatSeed; drafts?: ReviewState["drafts"] } = {},
): Promise<ReviewStore> {
	const store = new ReviewStore(storePaths(dir));
	await store.write(reviewState(dir, options));
	return store;
}

function request(path: string, body?: unknown): Request {
	return new Request(`http://127.0.0.1${path}?t=${token}`, {
		...(body === undefined ? {} : { method: "POST" }),
		...(body === undefined
			? {}
			: {
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				}),
	});
}

function chatRequest(chatId: string, message: string): Request {
	return request("/api/chat", { chatId, message });
}

function reviewSettingsRequest(
	agent: "omp" | "claude",
	model: string,
): Request {
	return request("/api/settings/review", { agent, model });
}

function commentFromChatRequest(draftId: string, chatId: string): Request {
	return request(`/api/comments/${draftId}/from-chat`, { chatId });
}

async function writePrompt(
	dir: string,
	slot: string,
	metadata: { agent: "omp" | "claude"; model: string; effort: AgentEffort },
): Promise<void> {
	const promptDir = join(dir, slot, "default");
	await mkdir(promptDir, { recursive: true });
	await writeFile(
		join(promptDir, "001.md"),
		`---\nagent: ${metadata.agent}\nmodel: ${metadata.model}\neffort: ${metadata.effort}\n---\nPrompt body`,
		"utf8",
	);
}

function makeRoutes(
	dir: string,
	store: ReviewStore,
	createReviewAgent: AgentFactory,
	options: {
		reviewAgent?: "omp" | "claude";
		model?: string;
		effort?: AgentEffort;
	} = {},
) {
	return createReviewRoutes({
		token,
		store,
		paths: routePaths(dir),
		promptSourceDir: dir,
		config: {
			review: {
				agent: options.reviewAgent ?? "claude",
				model: options.model ?? "global-model",
				effort: options.effort ?? "low",
			},
		},
		createReviewAgent,
	});
}

async function updateGlobalSelection(
	routes: ReviewRouteHandler,
	agent: "omp" | "claude",
	model: string,
): Promise<void> {
	const response = await routes(reviewSettingsRequest(agent, model));
	expect(response.status).toBe(200);
}

const discussion: HostDiscussion = {
	id: "discussion-1",
	resolved: false,
	position: null,
	notes: [
		{
			id: "note-1",
			author: "reviewer",
			body: "Please consider this edge case.",
			createdAt,
			system: false,
		},
	],
};

const commentDraft: ReviewState["drafts"][number] = {
	id: "draft-a",
	body: "",
	selection: { path: "src/app.ts", side: "new", startLine: 1, endLine: 1 },
	filePath: "src/app.ts",
	status: "draft",
	error: null,
	postedDiscussionId: null,
	staleSince: null,
};

describe("chat agent selection persistence", () => {
	test("new chats persist full selection before first turn and keep it across changes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-chat-effort-new-"));
		try {
			await writePrompt(dir, "review-chat", {
				agent: "omp",
				model: "chat-model",
				effort: "high",
			});
			const store = await makeStore(dir);
			const agent = new ChatEffortAgent();
			const overrides: AgentOverride[] = [];
			const routes = makeRoutes(dir, store, (override) => {
				overrides.push(override ?? {});
				return agent;
			});

			const createResponse = await routes(request("/api/chats", {}));
			expect(createResponse.status).toBe(201);
			const created = (await createResponse.json()) as {
				activeChatId: string;
				chats: ReviewState["chats"];
			};
			const chatId = created.activeChatId;
			expect(created.chats.find((chat) => chat.id === chatId)).toMatchObject({
				agent: "omp",
				model: "chat-model",
				effort: "high",
			});
			expect(agent.turns).toHaveLength(0);

			await writePrompt(dir, "review-chat", {
				agent: "claude",
				model: "changed-prompt-model",
				effort: "low",
			});
			await updateGlobalSelection(routes, "claude", "changed-default-model");
			await (await routes(chatRequest(chatId, "First turn"))).text();

			await writePrompt(dir, "review-chat", {
				agent: "claude",
				model: "later-prompt-model",
				effort: "low",
			});
			await updateGlobalSelection(routes, "omp", "later-default-model");
			await (await routes(chatRequest(chatId, "Second turn"))).text();

			expect(overrides).toEqual([
				{ agent: "omp", model: "chat-model", effort: "high" },
				{ agent: "omp", model: "chat-model", effort: "high" },
			]);
			expect(
				(await store.read())?.chats.find((chat) => chat.id === chatId),
			).toMatchObject({
				agent: "omp",
				model: "chat-model",
				effort: "high",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("Explain chats persist the effective review-chat selection before their first turn", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-chat-effort-explain-"));
		try {
			await writePrompt(dir, "review-chat", {
				agent: "omp",
				model: "explain-model",
				effort: "xhigh",
			});
			const store = await makeStore(dir);
			const agent = new ChatEffortAgent();
			const overrides: AgentOverride[] = [];
			const routes = createReviewRoutes({
				token,
				store,
				paths: routePaths(dir),
				promptSourceDir: dir,
				discussions: [discussion],
				config: {
					review: {
						agent: "claude",
						model: "global-model",
						effort: "low",
					},
				},
				createReviewAgent: (override) => {
					overrides.push(override ?? {});
					return agent;
				},
			});

			const response = await routes(
				request("/api/comments/explain", { discussionId: "discussion-1" }),
			);
			expect(response.status).toBe(201);
			const body = (await response.json()) as {
				chatId: string;
				chats: ReviewState["chats"];
				message: string;
			};
			expect(body.chats.find((chat) => chat.id === body.chatId)).toMatchObject({
				agent: "omp",
				model: "explain-model",
				effort: "xhigh",
			});
			expect(agent.turns).toHaveLength(0);

			await writePrompt(dir, "review-chat", {
				agent: "claude",
				model: "changed-explain-model",
				effort: "low",
			});
			await updateGlobalSelection(routes, "claude", "changed-default-model");
			await (await routes(chatRequest(body.chatId, body.message))).text();

			expect(overrides).toEqual([
				{ agent: "omp", model: "explain-model", effort: "xhigh" },
			]);
			expect(
				(await store.read())?.chats.find((chat) => chat.id === body.chatId),
			).toMatchObject({
				agent: "omp",
				model: "explain-model",
				effort: "xhigh",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("legacy bound chat without effort stays null and sends no effort override", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-chat-effort-legacy-bound-"));
		try {
			const paths = storePaths(dir);
			const legacy = JSON.parse(
				JSON.stringify(
					reviewState(dir, {
						chat: { id: "chat-a", agent: "omp", model: "stored-model" },
					}),
				),
			) as Record<string, unknown> & {
				chats: Array<Record<string, unknown>>;
			};
			delete legacy.chats[0]?.effort;
			await Bun.write(paths.statePath, JSON.stringify(legacy));
			const store = new ReviewStore(paths);
			const agent = new ChatEffortAgent();
			const overrides: AgentOverride[] = [];
			const routes = makeRoutes(dir, store, (override) => {
				overrides.push(override ?? {});
				return agent;
			});

			await (
				await routes(chatRequest("chat-a", "Continue legacy chat"))
			).text();

			expect(overrides).toEqual([{ agent: "omp", model: "stored-model" }]);
			expect((await store.read())?.chats[0]).toMatchObject({
				agent: "omp",
				model: "stored-model",
				effort: null,
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("transcript-bearing unbound legacy chat binds global selection", async () => {
		const dir = await mkdtemp(
			join(tmpdir(), "mole-chat-effort-legacy-transcript-"),
		);
		try {
			await writePrompt(dir, "review-chat", {
				agent: "omp",
				model: "prompt-model",
				effort: "high",
			});
			const store = await makeStore(dir);
			await store.appendChat("chat-a", {
				role: "user",
				text: "Old transcript",
			});
			const agent = new ChatEffortAgent();
			const overrides: AgentOverride[] = [];
			const routes = makeRoutes(
				dir,
				store,
				(override) => {
					overrides.push(override ?? {});
					return agent;
				},
				{ reviewAgent: "claude", model: "global-model", effort: "low" },
			);
			await (
				await routes(chatRequest("chat-a", "Continue old transcript"))
			).text();

			expect(overrides).toEqual([
				{ agent: "claude", model: "global-model", effort: "low" },
			]);
			expect((await store.read())?.chats[0]).toMatchObject({
				agent: "claude",
				model: "global-model",
				effort: "low",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("empty unbound legacy chat binds current prompt selection", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-chat-effort-legacy-empty-"));
		try {
			await writePrompt(dir, "review-chat", {
				agent: "omp",
				model: "current-prompt-model",
				effort: "high",
			});
			const store = await makeStore(dir);
			const agent = new ChatEffortAgent();
			const overrides: AgentOverride[] = [];
			const routes = makeRoutes(
				dir,
				store,
				(override) => {
					overrides.push(override ?? {});
					return agent;
				},
				{ reviewAgent: "claude", model: "global-model", effort: "low" },
			);
			await (await routes(chatRequest("chat-a", "Start chat"))).text();

			expect(overrides).toEqual([
				{ agent: "omp", model: "current-prompt-model", effort: "high" },
			]);
			expect((await store.read())?.chats[0]).toMatchObject({
				agent: "omp",
				model: "current-prompt-model",
				effort: "high",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("comment-from-chat uses persisted chat selection instead of current defaults or prompt", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-chat-effort-comment-"));
		try {
			await writePrompt(dir, "review-comment-from-chat", {
				agent: "claude",
				model: "comment-prompt-model",
				effort: "low",
			});
			const store = await makeStore(dir, {
				chat: {
					id: "chat-a",
					agent: "omp",
					model: "persisted-chat-model",
					effort: "high",
				},
				drafts: [commentDraft],
			});
			await store.appendChat("chat-a", {
				role: "assistant",
				text: "Assistant reply",
			});
			const agent = new ChatEffortAgent();
			const overrides: AgentOverride[] = [];
			const routes = makeRoutes(
				dir,
				store,
				(override) => {
					overrides.push(override ?? {});
					return agent;
				},
				{ reviewAgent: "claude", model: "changed-global-model", effort: "low" },
			);

			const response = await routes(
				commentFromChatRequest("draft-a", "chat-a"),
			);
			const body = await response.text();

			expect(response.status).toBe(200);
			expect(body).toContain('"status":"ok"');
			expect(overrides).toEqual([
				{ agent: "omp", model: "persisted-chat-model", effort: "high" },
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("failed binding persistence blocks turn and permits a fresh retry", async () => {
		const dir = await mkdtemp(
			join(tmpdir(), "mole-chat-effort-binding-failure-"),
		);
		try {
			await writePrompt(dir, "review-chat", {
				agent: "omp",
				model: "retry-model",
				effort: "high",
			});
			const store = new SwitchableReviewStore(storePaths(dir));
			await store.write(reviewState(dir));
			store.failMutations = true;
			const agent = new ChatEffortAgent();
			const overrides: AgentOverride[] = [];
			const routes = makeRoutes(dir, store, (override) => {
				overrides.push(override ?? {});
				return agent;
			});

			const failed = await routes(chatRequest("chat-a", "Do not start yet"));
			expect(await failed.text()).toContain("injected binding write failure");
			expect(agent.turns).toHaveLength(0);
			expect(overrides).toEqual([]);
			expect((await store.read())?.chats[0]).toMatchObject({
				agent: null,
				model: null,
				effort: null,
			});

			store.failMutations = false;
			const retried = await routes(chatRequest("chat-a", "Retry binding"));
			await retried.text();
			expect(overrides).toEqual([
				{ agent: "omp", model: "retry-model", effort: "high" },
			]);
			expect(agent.turns).toHaveLength(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("retry after a persisted binding never rebinds to changed defaults or prompt", async () => {
		const dir = await mkdtemp(
			join(tmpdir(), "mole-chat-effort-binding-retry-"),
		);
		try {
			await writePrompt(dir, "review-chat", {
				agent: "omp",
				model: "persisted-model",
				effort: "high",
			});
			const store = await makeStore(dir);
			const failingAgent = new ChatEffortAgent(new Error("first turn failed"));
			const retryAgent = new ChatEffortAgent();
			const overrides: AgentOverride[] = [];
			let factoryCalls = 0;
			const routes = makeRoutes(dir, store, (override) => {
				overrides.push(override ?? {});
				factoryCalls++;
				return factoryCalls === 1 ? failingAgent : retryAgent;
			});

			const createdResponse = await routes(request("/api/chats", {}));
			const created = (await createdResponse.json()) as {
				activeChatId: string;
			};
			const chatId = created.activeChatId;
			expect(
				(await store.read())?.chats.find((chat) => chat.id === chatId),
			).toMatchObject({
				agent: "omp",
				model: "persisted-model",
				effort: "high",
			});

			const failedTurn = await routes(chatRequest(chatId, "First attempt"));
			expect(await failedTurn.text()).toContain("first turn failed");
			await writePrompt(dir, "review-chat", {
				agent: "claude",
				model: "changed-prompt-model",
				effort: "low",
			});
			await updateGlobalSelection(routes, "claude", "changed-global-model");
			await (await routes(chatRequest(chatId, "Retry"))).text();

			expect(overrides).toEqual([
				{ agent: "omp", model: "persisted-model", effort: "high" },
				{ agent: "omp", model: "persisted-model", effort: "high" },
			]);
			expect(
				(await store.read())?.chats.find((chat) => chat.id === chatId),
			).toMatchObject({
				agent: "omp",
				model: "persisted-model",
				effort: "high",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
