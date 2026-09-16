import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import type { Config } from "../../adapters/config/schema";
import { DEFAULT_PROMPTS } from "../../adapters/prompts/defaults";
import type { HostDiscussion } from "../../ports/git-host";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import { type ParsedFileDiff, parseFileDiffs } from "../../shared/diff-parse";
import { createReviewRoutes, resolveReviewFilePath } from "./routes";
import { sseResponse } from "./sse";
import { type ReviewState, ReviewStateSchema } from "./state";
import { ReviewStore } from "./store";

const token = "route-test-token";

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

function request(path: string, init?: RequestInit): Request {
	return new Request(`http://127.0.0.1${path}`, init);
}

const diff: ParsedFileDiff[] = [
	{
		oldPath: "src/app.ts",
		newPath: "src/app.ts",
		status: "modified",
		binary: false,
		insertions: 1,
		deletions: 1,
		hunks: [],
	},
];

const discussion: HostDiscussion = {
	id: "discussion-1",
	resolved: false,
	position: null,
	notes: [
		{
			id: "note-1",
			author: "reviewer",
			body: "Please consider this edge case.",
			createdAt: "2026-01-01T00:00:00.000Z",
			system: false,
		},
	],
};

const commentSelection = {
	path: "src/app.ts",
	side: "new" as const,
	startLine: 2,
	endLine: 2,
};

const commentDiff: ParsedFileDiff[] = [
	{
		oldPath: "src/app.ts",
		newPath: "src/app.ts",
		status: "modified",
		binary: false,
		insertions: 1,
		deletions: 0,
		hunks: [
			{
				header: "@@ -1 +1,2 @@",
				oldStart: 1,
				oldLines: 1,
				newStart: 1,
				newLines: 2,
				lines: [
					{
						kind: "context",
						oldLine: 1,
						newLine: 1,
						text: "const a = 1;",
					},
					{
						kind: "add",
						oldLine: null,
						newLine: 2,
						text: "const b = 2;",
					},
				],
			},
		],
	},
];

function chatPaths(dir: string) {
	return {
		layersDir: join(dir, "layers"),
		promptDir: join(dir, "prompt"),
		layerPath: (runId: string) => join(dir, "layers", `${runId}.json`),
		promptPath: (turnId: string) => join(dir, "prompt", `${turnId}.md`),
		chatsDir: join(dir, "chats"),
	};
}

function chatRequest(body: unknown, path = `/api/chat?t=${token}`): Request {
	const payload =
		typeof body === "object" && body !== null && !Array.isArray(body)
			? { chatId: "chat-a", ...(body as Record<string, unknown>) }
			: body;
	return request(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
}
function promptRequest(path: string, body: unknown): Request {
	return request(`${path}?t=${token}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}
function reviewSettingsRequest(body: unknown): Request {
	return request(`/api/settings/review?t=${token}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

class StreamChatAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		yield { kind: "session", sessionId: "chat-session" };
		yield { kind: "text", delta: "Hello" };
		yield { kind: "tool", name: "grep", phase: "start" };
		yield { kind: "text", delta: " world" };
		yield { kind: "tool", name: "grep", phase: "end" };
		yield { kind: "error", message: "tool warning" };
		yield { kind: "turn_end" };
	}
}

class CancelChatAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];
	readonly started = Promise.withResolvers<void>();
	private runCount = 0;

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		const run = this.runCount++;
		yield { kind: "session", sessionId: "chat-session" };
		yield { kind: "text", delta: "partial" };
		if (run === 0) {
			this.started.resolve();
			await new Promise<void>((resolve) => {
				if (turn.signal?.aborted) {
					resolve();
					return;
				}
				turn.signal?.addEventListener("abort", () => resolve(), {
					once: true,
				});
			});
			return;
		}
		yield { kind: "text", delta: " complete" };
		yield { kind: "turn_end" };
	}
}

class ParallelChatAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];
	readonly startedA = Promise.withResolvers<void>();
	readonly startedB = Promise.withResolvers<void>();
	readonly releaseA = Promise.withResolvers<void>();
	readonly releaseB = Promise.withResolvers<void>();

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		const isB = turn.message.includes("parallel-B");
		const started = isB ? this.startedB : this.startedA;
		const release = isB ? this.releaseB : this.releaseA;
		started.resolve();
		yield {
			kind: "session",
			sessionId: isB ? "session-b" : "session-a",
		};
		yield { kind: "text", delta: "partial" };
		if (turn.signal?.aborted) return;
		const aborted = new Promise<void>((resolve) => {
			turn.signal?.addEventListener("abort", () => resolve(), { once: true });
		});
		await Promise.race([release.promise, aborted]);
		if (turn.signal?.aborted) return;
		yield { kind: "text", delta: " complete" };
		yield { kind: "turn_end" };
	}
}

class BlockingLayerAgent implements ReviewAgent {
	readonly started = Promise.withResolvers<void>();
	readonly release = Promise.withResolvers<void>();

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.started.resolve();
		await this.release.promise;
		const outputPath = turn.message.match(/absolute path: ([^\n]+)/)?.[1];
		if (!outputPath) throw new Error("missing output path");
		await Bun.write(
			outputPath,
			JSON.stringify({
				version: 1,
				layers: [
					{
						title: "Old revision layer",
						tldr: "Must not replace synced state.",
						files: ["src/app.ts"],
					},
				],
			}),
		);
		yield { kind: "session", sessionId: "old-layer-session" };
		yield { kind: "turn_end" };
	}
}
class RecordingLayerAgent implements ReviewAgent {
	readonly prompts: string[] = [];

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.prompts.push(await Bun.file(turn.systemPromptFile).text());
		const outputPath = turn.message.match(/absolute path: ([^\n]+)/)?.[1];
		if (!outputPath) throw new Error("missing output path");
		await Bun.write(
			outputPath,
			JSON.stringify({
				version: 1,
				layers: [
					{
						title: "Generated layer",
						tldr: "Generated for route wiring.",
						files: ["src/app.ts"],
					},
				],
			}),
		);
		yield { kind: "session", sessionId: "layer-session" };
		yield { kind: "turn_end" };
	}
}

describe("review routes", () => {
	test("rejects every API path without the per-run token", async () => {
		const routes = createReviewRoutes({ token, state: state() });
		for (const path of ["/api", "/api/state"]) {
			const response = await routes(request(path));
			expect(response.status).toBe(401);
			expect(await response.text()).toBe("");
		}
		const authorized = await routes(
			request("/api/state", { headers: { "X-Mole-Token": token } }),
		);
		expect(authorized.status).toBe(200);
	});

	test("uses review.largeFileLineThreshold when no route override is provided", async () => {
		const routes = createReviewRoutes({
			token,
			state: state(),
			config: { review: { largeFileLineThreshold: 42 } },
		});

		const response = await routes(request(`/api/state?t=${token}`));
		expect(response.status).toBe(200);
		expect((await response.json()).largeFileLineThreshold).toBe(42);
	});

	test("gets approval state through the review host", async () => {
		const approval = {
			approved: true,
			currentUser: "alice",
			approvalsLeft: 0,
			approvedBy: ["alice"],
			rules: [],
		};
		let receivedRef: unknown;
		const routes = createReviewRoutes({
			token,
			state: state(),
			gitHost: {
				fetchApprovalState: async (ref) => {
					receivedRef = ref;
					return approval;
				},
			},
		});

		const response = await routes(request(`/api/approval?t=${token}`));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(approval);
		expect(receivedRef).toEqual({
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
		});
	});

	test("approves and unapproves through POST approval actions", async () => {
		const calls: string[] = [];
		const approved = {
			approved: true,
			currentUser: "alice",
			approvalsLeft: 0,
			approvedBy: ["alice"],
			rules: [],
		};
		const unapproved = {
			approved: false,
			currentUser: "alice",
			approvalsLeft: 1,
			approvedBy: [],
			rules: [],
		};
		const routes = createReviewRoutes({
			token,
			state: state(),
			gitHost: {
				approveMr: async () => {
					calls.push("approve");
					return approved;
				},
				unapproveMr: async () => {
					calls.push("unapprove");
					return unapproved;
				},
			},
		});

		const approveResponse = await routes(
			request(`/api/approval?t=${token}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "approve" }),
			}),
		);
		expect(approveResponse.status).toBe(200);
		expect(await approveResponse.json()).toEqual(approved);

		const unapproveResponse = await routes(
			request(`/api/approval?t=${token}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "unapprove" }),
			}),
		);
		expect(unapproveResponse.status).toBe(200);
		expect(await unapproveResponse.json()).toEqual(unapproved);
		expect(calls).toEqual(["approve", "unapprove"]);
	});

	test("rejects unknown approval actions", async () => {
		const routes = createReviewRoutes({ token, state: state() });
		const response = await routes(
			request(`/api/approval?t=${token}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "skip" }),
			}),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: 'Action must be "approve" or "unapprove"',
		});
	});

	test("streams normalized chat events and persists the completed turn", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-route-"));
		try {
			const paths = chatPaths(dir);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			const agent = new StreamChatAgent();
			const routes = createReviewRoutes({
				token,
				store,
				paths,
				promptText: "Test chat prompt.",
				reviewAgent: agent,
			});

			const response = await routes(
				chatRequest({
					message: "Explain this change",
					tags: [],
					openFile: "src/app.ts",
				}),
			);
			const body = await response.text();

			expect(response.status).toBe(200);
			expect(body).toContain('event: text\ndata: {"text":"Hello"}');
			expect(body).toContain(
				'event: tool\ndata: {"name":"grep","phase":"start"}',
			);
			expect(body).toContain('event: error\ndata: {"message":"tool warning"}');
			expect(body.endsWith("event: done\ndata: null\n\n")).toBe(true);
			expect((await store.read())?.chats[0]?.sessionId).toBe("chat-session");
			expect(await store.readChat("chat-a")).toEqual([
				expect.objectContaining({ role: "user", text: "Explain this change" }),
				expect.objectContaining({
					role: "assistant",
					text: "Hello world",
					sessionId: "chat-session",
				}),
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("cancels an active chat and allows the persisted session to continue", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-cancel-"));
		try {
			const paths = chatPaths(dir);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			const agent = new CancelChatAgent();
			const routes = createReviewRoutes({
				token,
				store,
				paths,
				promptText: "Test chat prompt.",
				reviewAgent: agent,
			});

			const first = await routes(
				chatRequest({ message: "Stop after partial output" }),
			);
			await agent.started.promise;
			const cancel = await routes(
				request(`/api/chat/cancel?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ chatId: "chat-a" }),
				}),
			);
			expect(cancel.status).toBe(204);
			expect((await first.text()).endsWith("event: done\ndata: null\n\n")).toBe(
				true,
			);

			const second = await routes(
				chatRequest({ message: "Continue the review" }),
			);
			const secondBody = await second.text();
			expect(secondBody).toContain('event: text\ndata: {"text":" complete"}');
			expect(agent.turns[1]?.sessionId).toBe("chat-session");
			expect(
				(await store.readChat("chat-a")).map((entry) => entry.role),
			).toEqual(["user", "assistant", "user", "assistant"]);
			expect((await store.readChat("chat-a"))[1]?.text).toBe("partial");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("returns a terminal structured error without writing invalid turns", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-invalid-"));
		try {
			const paths = chatPaths(dir);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			const agent = new StreamChatAgent();
			const routes = createReviewRoutes({
				token,
				store,
				paths,
				promptText: "Test chat prompt.",
				reviewAgent: agent,
			});

			const response = await routes(
				chatRequest({ message: "   ", tags: [], openFile: null }),
			);
			const body = await response.text();

			expect(body).toContain(
				'event: error\ndata: {"message":"Chat message must not be empty"}',
			);
			expect(body.endsWith("event: done\ndata: null\n\n")).toBe(true);
			expect(await store.readChat("chat-a")).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("creates, selects, and isolates chat history", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-endpoints-"));
		try {
			const paths = chatPaths(dir);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			await store.appendChat("chat-a", {
				role: "user",
				text: "Existing chat entry",
			});
			const routes = createReviewRoutes({ token, store, paths });

			const created = await routes(
				request(`/api/chats?t=${token}`, { method: "POST" }),
			);
			expect(created.status).toBe(201);
			const createdBody = (await created.json()) as {
				chats: Array<{ id: string }>;
				activeChatId: string;
			};
			expect(createdBody.chats).toHaveLength(2);
			const newChatId = createdBody.chats[1]?.id;
			if (!newChatId) throw new Error("new chat id missing");
			expect(createdBody.activeChatId).toBe(newChatId);

			const stateAfterCreate = await routes(request(`/api/state?t=${token}`));
			const stateBody = (await stateAfterCreate.json()) as ReviewState;
			expect(stateBody.activeChatId).toBe(newChatId);
			expect(stateBody.chats.some((chat) => chat.id === newChatId)).toBe(true);

			const selected = await routes(
				request(`/api/chats/active?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ chatId: "chat-a" }),
				}),
			);
			expect(selected.status).toBe(204);
			const stateAfterSelect = await routes(request(`/api/state?t=${token}`));
			expect((await stateAfterSelect.json()).activeChatId).toBe("chat-a");

			const history = await routes(
				request(`/api/chat?chatId=chat-a&t=${token}`),
			);
			expect(history.status).toBe(200);
			expect(await history.json()).toEqual([
				expect.objectContaining({ text: "Existing chat entry" }),
			]);
			const emptyHistory = await routes(
				request(`/api/chat?chatId=${newChatId}&t=${token}`),
			);
			expect(await emptyHistory.json()).toEqual([]);

			const missingHistory = await routes(request(`/api/chat?t=${token}`));
			expect(missingHistory.status).toBe(400);
			const malformedHistory = await routes(
				request(`/api/chat?chatId=../../review&t=${token}`),
			);
			expect(malformedHistory.status).toBe(400);
			const unknownHistory = await routes(
				request(`/api/chat?chatId=missing&t=${token}`),
			);
			expect(unknownHistory.status).toBe(404);

			const unknownSelection = await routes(
				request(`/api/chats/active?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ chatId: "missing" }),
				}),
			);
			expect(unknownSelection.status).toBe(404);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("streams parallel turns and rejects a duplicate chat turn", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-parallel-"));
		try {
			const paths = chatPaths(dir);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			const agent = new ParallelChatAgent();
			const routes = createReviewRoutes({
				token,
				store,
				paths,
				promptText: "Test chat prompt.",
				reviewAgent: agent,
			});
			const created = await routes(
				request(`/api/chats?t=${token}`, { method: "POST" }),
			);
			const createdBody = (await created.json()) as {
				activeChatId: string;
			};
			const newChatId = createdBody.activeChatId;

			const first = routes(
				chatRequest({ chatId: "chat-a", message: "parallel-A" }),
			);
			await agent.startedA.promise;
			const duplicate = await routes(
				chatRequest({ chatId: "chat-a", message: "duplicate" }),
			);
			expect(await duplicate.text()).toContain("already in progress");

			const second = routes(
				chatRequest({ chatId: newChatId, message: "parallel-B" }),
			);
			await agent.startedB.promise;
			const busy = await routes(request(`/api/state?t=${token}`));
			expect((await busy.json()).busyChatIds).toEqual(
				expect.arrayContaining(["chat-a", newChatId]),
			);

			agent.releaseA.resolve();
			agent.releaseB.resolve();
			const [firstBody, secondBody] = await Promise.all([
				(await first).text(),
				(await second).text(),
			]);
			expect(firstBody.endsWith("event: done\ndata: null\n\n")).toBe(true);
			expect(secondBody.endsWith("event: done\ndata: null\n\n")).toBe(true);
			expect(agent.turns).toHaveLength(2);
			expect((await store.readChat("chat-a")).at(-1)).toMatchObject({
				role: "assistant",
				text: "partial complete",
			});
			expect((await store.readChat(newChatId)).at(-1)).toMatchObject({
				role: "assistant",
				text: "partial complete",
			});
			const idle = await routes(request(`/api/state?t=${token}`));
			expect((await idle.json()).busyChatIds).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("cancels one chat without stopping another", async () => {
		const dir = await mkdtemp(
			join(tmpdir(), "mole-review-chat-cancel-scoped-"),
		);
		try {
			const paths = chatPaths(dir);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			const agent = new ParallelChatAgent();
			const routes = createReviewRoutes({
				token,
				store,
				paths,
				promptText: "Test chat prompt.",
				reviewAgent: agent,
			});
			const created = await routes(
				request(`/api/chats?t=${token}`, { method: "POST" }),
			);
			const createdBody = (await created.json()) as { activeChatId: string };
			const chatB = createdBody.activeChatId;

			const first = routes(
				chatRequest({ chatId: "chat-a", message: "parallel-A" }),
			);
			const second = routes(
				chatRequest({ chatId: chatB, message: "parallel-B" }),
			);
			await Promise.all([agent.startedA.promise, agent.startedB.promise]);

			const malformed = await routes(
				request(`/api/chat/cancel?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ chatId: "../../review" }),
				}),
			);
			expect(malformed.status).toBe(400);
			const unknown = await routes(
				request(`/api/chat/cancel?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ chatId: "missing" }),
				}),
			);
			expect(unknown.status).toBe(204);

			const cancelled = await routes(
				request(`/api/chat/cancel?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ chatId: "chat-a" }),
				}),
			);
			expect(cancelled.status).toBe(204);
			expect(
				(await first)
					.text()
					.then((body) => body.endsWith("event: done\ndata: null\n\n")),
			).resolves.toBe(true);
			const stillBusy = await routes(request(`/api/state?t=${token}`));
			expect((await stillBusy.json()).busyChatIds).toEqual([chatB]);

			agent.releaseB.resolve();
			const secondBody = await (await second).text();
			expect(secondBody.endsWith("event: done\ndata: null\n\n")).toBe(true);
			expect((await store.readChat(chatB)).at(-1)).toMatchObject({
				role: "assistant",
				text: "partial complete",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("sets chat title once from its first message", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-title-"));
		try {
			const paths = chatPaths(dir);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			const routes = createReviewRoutes({
				token,
				store,
				paths,
				promptText: "Test chat prompt.",
				reviewAgent: new StreamChatAgent(),
			});

			await (
				await routes(chatRequest({ message: "  First\n chat title  " }))
			).text();
			expect((await store.read())?.chats[0]?.title).toBe("First chat title");
			await (
				await routes(
					chatRequest({ message: "Later message must not replace title" }),
				)
			).text();
			expect((await store.read())?.chats[0]?.title).toBe("First chat title");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects traversal chat ids before touching transcript paths", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-traversal-"));
		const reviewDir = join(dir, "review");
		try {
			await mkdir(reviewDir, { recursive: true });
			const store = new ReviewStore({
				statePath: join(reviewDir, "review.json"),
				chatPath: join(reviewDir, "chat.ndjson"),
				chatsDir: join(reviewDir, "chats"),
			});
			await store.write(state());
			const routes = createReviewRoutes({
				token,
				store,
				paths: chatPaths(reviewDir),
				promptText: "Test chat prompt.",
				reviewAgent: new StreamChatAgent(),
			});

			const post = await routes(
				chatRequest({
					chatId: "../../review",
					message: "must be rejected",
				}),
			);
			expect(await post.text()).toContain("Chat id is invalid");
			const get = await routes(
				request(`/api/chat?chatId=../../review&t=${token}`),
			);
			expect(get.status).toBe(400);
			expect(await Bun.file(join(dir, "review.ndjson")).exists()).toBe(false);
			expect(await Bun.file(join(dir, "review")).exists()).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("removes the clear-chat endpoint", async () => {
		const routes = createReviewRoutes({ token, state: state() });
		const unknown = await routes(
			request(`/api/not-a-route?t=${token}`, { method: "POST" }),
		);
		const retiredPath = ["/api/chat", "clear"].join("/");
		const clear = await routes(
			request(`${retiredPath}?t=${token}`, { method: "POST" }),
		);
		expect(clear.status).toBe(unknown.status);
	});

	test("streams a successful comment send and replaces the draft", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-send-route-"));
		try {
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(
				ReviewStateSchema.parse({
					...state(),
					drafts: [
						{
							id: "draft-send",
							body: "Please fix this.",
							selection: commentSelection,
							filePath: commentSelection.path,
							status: "draft",
							error: null,
							postedDiscussionId: null,
							staleSince: null,
						},
					],
				}),
			);
			let refreshes = 0;
			const routes = createReviewRoutes({
				token,
				store,
				diff: commentDiff,
				gitHost: {
					createDiscussion: async () => discussion,
					listDiscussions: async () => {
						refreshes++;
						return [discussion];
					},
				},
			});

			const response = await routes(
				request(`/api/comments/draft-send/send?t=${token}`, {
					method: "POST",
				}),
			);
			const body = await response.text();
			const lastFrame = body.trimEnd().split("\n\n").at(-1);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			expect(body).toContain('event: done\ndata: {"discussion":');
			expect(lastFrame?.startsWith("event: done\n")).toBe(true);
			expect(refreshes).toBe(1);
			expect((await store.read())?.drafts[0]).toMatchObject({
				status: "posted",
				postedDiscussionId: "discussion-1",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("streams failed comment sends and retains the draft", async () => {
		const dir = await mkdtemp(
			join(tmpdir(), "mole-review-send-failure-route-"),
		);
		try {
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(
				ReviewStateSchema.parse({
					...state(),
					drafts: [
						{
							id: "draft-failure",
							body: "Please fix this.",
							selection: commentSelection,
							filePath: commentSelection.path,
							status: "draft",
							error: null,
							postedDiscussionId: null,
							staleSince: null,
						},
					],
				}),
			);
			const routes = createReviewRoutes({
				token,
				store,
				diff: commentDiff,
				gitHost: {
					createDiscussion: async () => {
						throw new Error("glab unauthenticated");
					},
				},
			});

			const response = await routes(
				request(`/api/comments/draft-failure/send?t=${token}`, {
					method: "POST",
				}),
			);
			const body = await response.text();
			const lastFrame = body.trimEnd().split("\n\n").at(-1);

			expect(response.status).toBe(502);
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			expect(body).toContain(
				'event: error\ndata: {"message":"glab unauthenticated"}',
			);
			expect(lastFrame?.startsWith("event: done\n")).toBe(true);
			expect((await store.read())?.drafts[0]).toMatchObject({
				body: "Please fix this.",
				status: "failed",
				error: "glab unauthenticated",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("persists viewed progress through ReviewStore", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-routes-"));
		try {
			const paths = {
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			};
			const store = new ReviewStore(paths);
			await store.write(state());
			const routes = createReviewRoutes({ token, store, diff });
			const response = await routes(
				request(`/api/progress?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ viewedFile: "src/app.ts" }),
				}),
			);
			expect(response.status).toBe(200);
			expect((await response.json()).viewedFiles).toEqual(["src/app.ts"]);
			expect((await new ReviewStore(paths).read())?.viewedFiles).toEqual([
				"src/app.ts",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("persists object-form viewed-file toggles through ReviewStore", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-routes-"));
		try {
			const paths = {
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			};
			const store = new ReviewStore(paths);
			await store.write(state());
			const routes = createReviewRoutes({ token, store, diff });
			const mark = await routes(
				request(`/api/progress?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						viewedFile: { path: "src/app.ts", viewed: true },
					}),
				}),
			);
			expect(mark.status).toBe(200);
			expect((await mark.json()).viewedFiles).toEqual(["src/app.ts"]);
			const unmark = await routes(
				request(`/api/progress?t=${token}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						viewedFile: { path: "src/app.ts", viewed: false },
					}),
				}),
			);
			expect(unmark.status).toBe(200);
			expect((await unmark.json()).viewedFiles).toEqual([]);
			expect((await new ReviewStore(paths).read())?.viewedFiles).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("recovers a persisted layer run after server restart", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-routes-"));
		try {
			const paths = {
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			};
			const interrupted = { ...state(), layerStatus: "running" as const };
			const store = new ReviewStore(paths);
			await store.write(interrupted);

			const routes = createReviewRoutes({ token, store, diff });
			const response = await routes(request(`/api/state?t=${token}`));

			expect((await response.json()).layerStatus).toBe("pending");
			expect((await new ReviewStore(paths).read())?.layerStatus).toBe(
				"pending",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("fetches and caches available host discussions without failing state", async () => {
		let calls = 0;
		const routes = createReviewRoutes({
			token,
			state: state(),
			discussions: [discussion],
			getDiscussions: async () => {
				calls++;
				return [discussion];
			},
		});
		const response = await routes(request(`/api/state?t=${token}`));
		expect(response.status).toBe(200);
		expect((await response.json()).discussions).toEqual([discussion]);
		expect(calls).toBe(1);
	});

	test("rejects traversal outside the worktree", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-traversal-"));
		try {
			const root = join(dir, "worktree");
			const outside = join(dir, "secret.txt");
			await mkdir(root, { recursive: true });
			await Bun.write(join(root, "safe.txt"), "safe");
			await writeFile(outside, "secret", "utf8");
			const routes = createReviewRoutes({
				token,
				state: ReviewStateSchema.parse({ ...state(), worktreePath: root }),
				worktreePath: root,
			});
			const response = await routes(
				request(
					`/api/file?path=${encodeURIComponent("../secret.txt")}&t=${token}`,
				),
			);
			expect(response.status).toBe(400);
			expect((await response.json()).error).toContain("escapes worktree");
			await expect(
				resolveReviewFilePath(root, "../secret.txt"),
			).rejects.toThrow("escapes worktree");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("returns a file only after token and path validation", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-file-"));
		try {
			const root = join(dir, "worktree");
			await mkdir(root, { recursive: true });
			await Bun.write(join(root, "safe.txt"), "safe content");
			const routes = createReviewRoutes({
				token,
				state: ReviewStateSchema.parse({ ...state(), worktreePath: root }),
				worktreePath: root,
			});
			const response = await routes(
				request(`/api/file?path=safe.txt&t=${token}`),
			);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("safe content");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("keeps ignored files collapsed until their full diff is requested", async () => {
		const fullFile: ParsedFileDiff = {
			oldPath: "generated/out.ts",
			newPath: "generated/out.ts",
			status: "modified",
			binary: false,
			insertions: 1,
			deletions: 1,
			hunks: [
				{
					header: "@@ -1 +1 @@",
					oldStart: 1,
					oldLines: 1,
					newStart: 1,
					newLines: 1,
					lines: [
						{ kind: "del", oldLine: 1, newLine: null, text: "old" },
						{ kind: "add", oldLine: null, newLine: 1, text: "new" },
					],
				},
			],
		};
		const filtered = { ...fullFile, hunks: [] };
		const routes = createReviewRoutes({
			token,
			state: state(),
			diff: [filtered],
			expandedDiff: [fullFile],
		});
		const initial = await routes(request(`/api/state?t=${token}`));
		expect((await initial.json()).diff[0].hunks).toEqual([]);
		const expanded = await routes(
			request(`/api/diff?path=generated%2Fout.ts&t=${token}`),
		);
		expect((await expanded.json()).hunks).toEqual(fullFile.hunks);
	});

	test("only expands paths present in the initial parsed diff", async () => {
		const unknown: ParsedFileDiff = {
			...diff[0],
			oldPath: "hidden.ts",
			newPath: "hidden.ts",
			hunks: [
				{
					header: "@@ -1 +1 @@",
					oldStart: 1,
					oldLines: 1,
					newStart: 1,
					newLines: 1,
					lines: [],
				},
			],
		};
		const routes = createReviewRoutes({
			token,
			state: state(),
			diff,
			expandedDiff: [unknown],
		});
		const response = await routes(
			request(`/api/diff?path=hidden.ts&t=${token}`),
		);
		expect(response.status).toBe(404);
	});

	test("rejects old-side symlink escapes before reading the revision", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-old-symlink-"));
		try {
			const root = join(dir, "worktree");
			const outside = join(dir, "outside.txt");
			await mkdir(root, { recursive: true });
			await writeFile(outside, "outside", "utf8");
			await symlink(outside, join(root, "link.txt"));
			let called = false;
			const routes = createReviewRoutes({
				token,
				state: ReviewStateSchema.parse({ ...state(), worktreePath: root }),
				worktreePath: root,
				getFileContents: async () => {
					called = true;
					return "must not read";
				},
			});
			const response = await routes(
				request(`/api/file?path=link.txt&side=old&t=${token}`),
			);
			expect(response.status).toBe(400);
			expect((await response.json()).error).toContain("escapes worktree");
			expect(called).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("serves deleted-file context from the old revision", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-old-file-"));
		try {
			await mkdir(dir, { recursive: true });
			let requestDetails: unknown;
			const routes = createReviewRoutes({
				token,
				state: ReviewStateSchema.parse({ ...state(), worktreePath: dir }),
				worktreePath: dir,
				getFileContents: async (request) => {
					requestDetails = request;
					return "old revision line";
				},
			});
			const response = await routes(
				request(`/api/file?path=deleted.txt&side=old&t=${token}`),
			);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("old revision line");
			expect(requestDetails).toEqual({
				path: "deleted.txt",
				side: "old",
				revision: "base",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("emits terminal done after an SSE source throws", async () => {
		async function* source() {
			yield { event: "text", data: { text: "partial" } };
			throw new Error("agent stream failed");
		}
		const response = sseResponse(source());
		const body = await response.text();
		expect(body).toContain('event: text\ndata: {"text":"partial"}');
		expect(body).toContain(
			'event: error\ndata: {"message":"agent stream failed"}',
		);
		expect(body.endsWith("event: done\ndata: null\n\n")).toBe(true);
	});

	test("emits terminal done after an SSE source completes", async () => {
		async function* source() {
			yield { event: "text", data: { text: "complete" } };
		}
		const body = await sseResponse(source()).text();
		expect(body.endsWith("event: done\ndata: null\n\n")).toBe(true);
	});

	test("keeps a silent SSE stream alive with heartbeat comments", async () => {
		// The source blocks on a gate the test controls, so the only frames that
		// can arrive before it opens are heartbeats.
		const gate = Promise.withResolvers<void>();
		async function* source() {
			await gate.promise;
			yield { event: "status", data: { status: "running" } };
		}
		const body = sseResponse(source(), 1).body;
		if (!body) throw new Error("missing stream body");
		const reader = body.getReader();
		const decoder = new TextDecoder();
		expect(decoder.decode((await reader.read()).value)).toBe(": ping\n\n");
		expect(decoder.decode((await reader.read()).value)).toBe(": ping\n\n");
		gate.resolve();
		let rest = "";
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			rest += decoder.decode(chunk.value);
		}
		expect(rest).toContain('event: status\ndata: {"status":"running"}');
		expect(rest.endsWith("event: done\ndata: null\n\n")).toBe(true);
	});

	test("refresh reports head drift and commit count without changing state", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-refresh-route-"));
		try {
			const paths = {
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			};
			const previous = state();
			const store = new ReviewStore(paths);
			await store.write(previous);
			const vcs = new FakeVcs({
				repoRoot: previous.repoRoot,
				log: [
					{
						sha: "commit-1",
						subject: "one",
						author: "author",
						date: "2026-01-01T00:00:00.000Z",
					},
					{
						sha: "commit-2",
						subject: "two",
						author: "author",
						date: "2026-01-02T00:00:00.000Z",
					},
				],
			});
			const routes = createReviewRoutes({
				token,
				store,
				vcs,
				ref: {
					host: previous.mr.host,
					projectPath: previous.mr.projectPath,
					iid: previous.mr.iid,
				},
				fetchMr: async () => ({
					iid: previous.mr.iid,
					projectPath: previous.mr.projectPath,
					title: previous.mr.title,
					webUrl: previous.mr.webUrl,
					sourceBranch: previous.mr.sourceBranch,
					targetBranch: previous.mr.targetBranch,
					headSha: "head-2",
					diffRefs: {
						baseSha: "base-2",
						startSha: "start-2",
						headSha: "head-2",
					},
				}),
			});

			const response = await routes(request(`/api/refresh?t=${token}`));
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				stale: true,
				headSha: "head-2",
				newCommitCount: 2,
				currentHeadSha: "head",
				newCommits: 2,
			});
			expect(await store.read()).toEqual(previous);
			expect(vcs.fetchRefCalls).toEqual([
				{ repoRoot: previous.repoRoot, remote: "origin", ref: "head-2" },
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("sync repoints worktree and preserves chat while marking stale anchors", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-sync-route-"));
		try {
			const paths = {
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			};
			const previous = ReviewStateSchema.parse({
				...state(),
				chats: [
					{
						id: "chat-a",
						title: "",
						sessionId: "chat-session",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
				activeChatId: "chat-a",
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
				drafts: [
					{
						id: "draft-1",
						body: "Please fix this.",
						selection: commentSelection,
						filePath: commentSelection.path,
						status: "draft",
						error: null,
						postedDiscussionId: null,
						staleSince: null,
					},
				],
			});
			const store = new ReviewStore(paths);
			await store.write(previous);
			await store.appendChat("chat-a", {
				role: "user",
				text: "Keep this transcript",
				sessionId: previous.chats[0]?.sessionId,
			});
			const vcs = new FakeVcs({
				repoRoot: previous.repoRoot,
				worktrees: [{ path: previous.worktreePath, ref: "head" }],
				mergeBase: "base-2",
				diffRange: [
					{
						path: "src/app.ts",
						statOnly: false,
						patch: "@@ -1 +1 @@\\n-old\\n+new\\n",
						insertions: 1,
						deletions: 1,
					},
				],
			});
			const routes = createReviewRoutes({
				token,
				store,
				vcs,
				ref: {
					host: previous.mr.host,
					projectPath: previous.mr.projectPath,
					iid: previous.mr.iid,
				},
				fetchMr: async () => ({
					iid: previous.mr.iid,
					projectPath: previous.mr.projectPath,
					title: "Updated review",
					webUrl: previous.mr.webUrl,
					sourceBranch: previous.mr.sourceBranch,
					targetBranch: previous.mr.targetBranch,
					headSha: "head-2",
					diffRefs: {
						baseSha: "base-2",
						startSha: "base-2",
						headSha: "head-2",
					},
				}),
				diff: commentDiff,
			});

			const response = await routes(
				request(`/api/sync?t=${token}`, { method: "POST" }),
			);
			expect(response.status).toBe(200);
			const api = await response.json();
			expect(api.revision).toMatchObject({
				headSha: "head-2",
				mergeBaseSha: "base-2",
			});
			expect(api.layers[0]).toMatchObject({ id: "layer-1", stale: true });
			expect(api.drafts[0].staleSince).toEqual(expect.any(String));
			expect((await store.read())?.chats[0]?.sessionId).toBe("chat-session");
			expect((await store.read())?.drafts[0]?.staleSince).toEqual(
				expect.any(String),
			);
			expect(await store.readChat("chat-a")).toEqual([
				expect.objectContaining({ text: "Keep this transcript" }),
			]);
			expect(vcs.forceWorktreeCalls).toEqual([
				{ path: previous.worktreePath, repoRoot: previous.repoRoot },
			]);
			expect(vcs.addWorktreeCalls).toEqual([
				{
					path: previous.worktreePath,
					repoRoot: previous.repoRoot,
					sha: "head-2",
				},
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("filters viewed files against the previously served diff", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-sync-viewed-route-"));
		try {
			const paths = {
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			};
			const previous = ReviewStateSchema.parse({
				...state(),
				viewedFiles: ["src/kept.ts", "src/changed.ts"],
			});
			const store = new ReviewStore(paths);
			await store.write(previous);

			const previousDiff = [
				{
					path: "src/kept.ts",
					statOnly: false,
					patch: "@@ -1 +1 @@\n-old\n+new\n",
					insertions: 1,
					deletions: 1,
				},
				{
					path: "src/changed.ts",
					statOnly: false,
					patch: "@@ -1 +1 @@\n-old\n+new\n",
					insertions: 1,
					deletions: 1,
				},
			];
			const nextDiff = [
				{
					path: "src/kept.ts",
					statOnly: false,
					patch: "@@ -40 +40 @@\n-old\n+new\n",
					insertions: 1,
					deletions: 1,
				},
				{
					path: "src/changed.ts",
					statOnly: false,
					patch: "@@ -1 +1 @@\n-old\n+updated\n",
					insertions: 1,
					deletions: 1,
				},
			];
			const vcs = new FakeVcs({
				repoRoot: previous.repoRoot,
				worktrees: [{ path: previous.worktreePath, ref: "head" }],
				mergeBase: "base-2",
				diffRange: nextDiff,
			});
			const routes = createReviewRoutes({
				token,
				store,
				vcs,
				ref: {
					host: previous.mr.host,
					projectPath: previous.mr.projectPath,
					iid: previous.mr.iid,
				},
				fetchMr: async () => ({
					iid: previous.mr.iid,
					projectPath: previous.mr.projectPath,
					title: "Updated review",
					webUrl: previous.mr.webUrl,
					sourceBranch: previous.mr.sourceBranch,
					targetBranch: previous.mr.targetBranch,
					headSha: "head-2",
					diffRefs: {
						baseSha: "base-2",
						startSha: "base-2",
						headSha: "head-2",
					},
				}),
				diff: parseFileDiffs(previousDiff),
				layerDiff: previousDiff,
			});

			const response = await routes(
				request(`/api/sync?t=${token}`, { method: "POST" }),
			);
			expect(response.status).toBe(200);
			expect((await response.json()).viewedFiles).toEqual(["src/kept.ts"]);
			expect((await store.read())?.viewedFiles).toEqual(["src/kept.ts"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("does not let an old layer run replace stale markers after sync", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-sync-layer-race-"));
		try {
			const paths = {
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			};
			const previous = ReviewStateSchema.parse({
				...state(),
				layerStatus: "ready",
				layers: [
					{
						id: "layer-1",
						title: "Old layer",
						tldr: "Old revision",
						files: ["src/app.ts"],
						bdd: [],
						done: false,
						stale: false,
					},
				],
			});
			const store = new ReviewStore(paths);
			await store.write(previous);
			const vcs = new FakeVcs({
				repoRoot: previous.repoRoot,
				worktrees: [{ path: previous.worktreePath, ref: "head" }],
				mergeBase: "base-2",
				diffRange: [
					{
						path: "src/app.ts",
						statOnly: false,
						patch: "@@ -1 +1 @@\\n-old\\n+new\\n",
						insertions: 1,
						deletions: 1,
					},
				],
			});
			const agent = new BlockingLayerAgent();
			const routes = createReviewRoutes({
				token,
				store,
				vcs,
				paths: chatPaths(dir),
				diff: commentDiff,
				layerAgent: agent,
				ref: {
					host: previous.mr.host,
					projectPath: previous.mr.projectPath,
					iid: previous.mr.iid,
				},
				fetchMr: async () => ({
					iid: previous.mr.iid,
					projectPath: previous.mr.projectPath,
					title: "Updated review",
					webUrl: previous.mr.webUrl,
					sourceBranch: previous.mr.sourceBranch,
					targetBranch: previous.mr.targetBranch,
					headSha: "head-2",
					diffRefs: {
						baseSha: "base-2",
						startSha: "base-2",
						headSha: "head-2",
					},
				}),
			});

			const layerResponse = await routes(
				request(`/api/layers/regenerate?t=${token}`, { method: "POST" }),
			);
			const layerBody = layerResponse.text();
			await agent.started.promise;

			const syncResponse = await routes(
				request(`/api/sync?t=${token}`, { method: "POST" }),
			);
			expect(syncResponse.status).toBe(200);
			const synced = await syncResponse.json();
			expect(synced.revision.headSha).toBe("head-2");
			expect(synced.layers[0]).toMatchObject({ stale: true });

			agent.release.resolve();
			await layerBody;

			const final = await store.read();
			expect(final?.revision.headSha).toBe("head-2");
			expect(final?.layerStatus).toBe("pending");
			expect(final?.layers[0]).toMatchObject({
				id: "layer-1",
				stale: true,
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("comment explain", () => {
	const positioned: HostDiscussion = {
		id: "discussion-explain",
		resolved: false,
		position: {
			newPath: "src/app.ts",
			oldPath: "src/app.ts",
			newLine: 2,
			oldLine: null,
		},
		notes: [
			{
				id: "note-1",
				author: "reviewer",
				body: "Please rename this helper",
				createdAt: "2026-01-01T00:00:00.000Z",
				system: false,
			},
		],
	};

	const file: ParsedFileDiff = {
		oldPath: "src/app.ts",
		newPath: "src/app.ts",
		status: "modified",
		binary: false,
		insertions: 1,
		deletions: 0,
		hunks: [
			{
				header: "@@ -1 +1,2 @@",
				oldStart: 1,
				oldLines: 1,
				newStart: 1,
				newLines: 2,
				lines: [
					{
						kind: "context",
						oldLine: 1,
						newLine: 1,
						text: "const a = 1;",
					},
					{
						kind: "add",
						oldLine: null,
						newLine: 2,
						text: "const helper = 2;",
					},
				],
			},
		],
	};

	function explainRequest(body: unknown): Request {
		return request(`/api/comments/explain?t=${token}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	async function setup(dir: string) {
		const store = new ReviewStore({
			statePath: join(dir, "review.json"),
			chatPath: join(dir, "chat.ndjson"),
			chatsDir: join(dir, "chats"),
		});
		await store.write(state());
		const agent = new StreamChatAgent();
		const routes = createReviewRoutes({
			token,
			store,
			paths: chatPaths(dir),
			promptText: "Test chat prompt.",
			explainPromptText: "Explain prefix.",
			reviewAgent: agent,
			discussions: [positioned],
			expandedDiff: [file],
		});
		return { store, agent, routes };
	}
	test("uses the active Explain prompt preset", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-explain-preset-"));
		try {
			const presetDir = join(dir, "review-explain-comment", "terse");
			await mkdir(presetDir, { recursive: true });
			await writeFile(
				join(presetDir, "001.md"),
				"Activated explain prefix",
				"utf8",
			);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			const routes = createReviewRoutes({
				token,
				store,
				paths: chatPaths(dir),
				config: {
					prompts: { "review-explain-comment": "terse" },
				},
				promptSourceDir: dir,
				discussions: [positioned],
				expandedDiff: [file],
			});

			const response = await routes(
				explainRequest({ discussionId: "discussion-explain" }),
			);
			expect(response.status).toBe(201);
			const body = (await response.json()) as { message: string };
			expect(body.message.startsWith("Activated explain prefix")).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("creates an active chat titled after the comment and returns the first message", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-explain-"));
		try {
			const { store, routes } = await setup(dir);

			const response = await routes(
				explainRequest({ discussionId: "discussion-explain" }),
			);
			expect(response.status).toBe(201);
			const body = (await response.json()) as {
				chatId: string;
				chats: ReviewState["chats"];
				activeChatId: string;
				message: string;
			};

			expect(body.chatId).toBe(body.activeChatId);
			const chats = (await store.read())?.chats ?? [];
			expect(chats).toHaveLength(2);
			expect(chats[1]).toMatchObject({
				id: body.chatId,
				title: "Explain: Please rename this helper",
			});
			expect(body.chats).toEqual(chats);
			expect(body.message.startsWith("Explain prefix.")).toBe(true);
			expect(body.message).toContain("Please rename this helper");
			expect(
				body.message.split("\n").some((line) => line.startsWith("> ")),
			).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("runs the returned message as an ordinary first chat turn without retitling", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-explain-turn-"));
		try {
			const { store, agent, routes } = await setup(dir);
			const { chatId, message } = (await (
				await routes(explainRequest({ discussionId: "discussion-explain" }))
			).json()) as { chatId: string; message: string };

			await (await routes(chatRequest({ chatId, message }))).text();

			expect(agent.turns[0]?.message).toContain("Explain prefix.");
			expect(agent.turns[0]?.message).toContain("Please rename this helper");
			expect(
				(await store.read())?.chats.find((chat) => chat.id === chatId)?.title,
			).toBe("Explain: Please rename this helper");
			expect(await store.readChat(chatId)).toEqual([
				expect.objectContaining({ role: "user", text: message }),
				expect.objectContaining({ role: "assistant", text: "Hello world" }),
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects unknown discussions without creating a chat", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-explain-unknown-"));
		try {
			const { store, routes } = await setup(dir);

			const response = await routes(explainRequest({ discussionId: "nope" }));

			expect(response.status).toBe(404);
			expect((await store.read())?.chats).toHaveLength(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects a missing discussion id", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-explain-invalid-"));
		try {
			const { store, routes } = await setup(dir);

			expect((await routes(explainRequest({}))).status).toBe(400);
			expect((await routes(explainRequest({ discussionId: 7 }))).status).toBe(
				400,
			);
			expect((await store.read())?.chats).toHaveLength(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("review settings wiring", () => {
	test("uses configured layer preset for regeneration", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-layer-preset-"));
		try {
			const promptPath = join(dir, "review-layers-code", "terse", "001.md");
			await mkdir(join(dir, "review-layers-code", "terse"), {
				recursive: true,
			});
			await writeFile(promptPath, "TERSE LAYER PROMPT", "utf8");
			const agent = new RecordingLayerAgent();
			const routes = createReviewRoutes({
				token,
				state: state(),
				paths: chatPaths(dir),
				diff,
				layerAgent: agent,
				promptSourceDir: dir,
				config: {
					jira: { enabled: false },
					review: { agent: "omp" },
					prompts: { "review-layers-code": "terse" },
				},
			});

			const response = await routes(
				request(`/api/layers/regenerate?t=${token}`, { method: "POST" }),
			);
			expect(response.status).toBe(200);
			await response.text();

			expect(agent.prompts).toHaveLength(1);
			expect(agent.prompts[0]).toContain("TERSE LAYER PROMPT");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("uses configured chat preset at turn start", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-preset-"));
		try {
			const promptDir = join(dir, "review-chat", "terse");
			await mkdir(promptDir, { recursive: true });
			await writeFile(join(promptDir, "001.md"), "TERSE CHAT PROMPT", "utf8");
			const paths = chatPaths(dir);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			const agent = new StreamChatAgent();
			const routes = createReviewRoutes({
				token,
				store,
				paths,
				promptSourceDir: dir,
				reviewAgent: agent,
				config: {
					prompts: { "review-chat": "terse" },
				},
			});

			const response = await routes(
				chatRequest({ message: "Explain this change" }),
			);
			expect(response.status).toBe(200);
			await response.text();

			const turn = agent.turns.at(0);
			if (!turn) throw new Error("Chat agent did not receive a turn");
			expect(await Bun.file(turn.systemPromptFile).text()).toContain(
				"TERSE CHAT PROMPT",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("prompt settings read API", () => {
	test("settings snapshot lists all prompt slots and review settings", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-settings-"));
		try {
			await mkdir(join(dir, "review-chat", "terse"), { recursive: true });
			await writeFile(
				join(dir, "review-chat", "terse", "001.md"),
				"TERSE REVIEW CHAT",
				"utf8",
			);
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
				config: {
					review: { agent: "claude", model: "claude-sonnet" },
					prompts: { "review-chat": "terse" },
				},
			});

			const response = await routes(request(`/api/settings?t=${token}`));
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.slots).toHaveLength(7);
			expect(body.slots.map((slot: { slot: string }) => slot.slot)).toEqual([
				"commit-system",
				"mr-code",
				"mr-plan",
				"review-layers-code",
				"review-layers-plan",
				"review-chat",
				"review-explain-comment",
			]);
			expect(body.slots).toContainEqual({
				slot: "review-chat",
				activePreset: "terse",
				presets: [
					{ name: "default", latest: 1 },
					{ name: "terse", latest: 1 },
				],
			});
			expect(body.review).toEqual({
				agent: "claude",
				model: "claude-sonnet",
				agents: ["omp", "claude"],
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("defaults review settings to Claude without a configured model", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-settings-default-"));
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
			});

			const response = await routes(request(`/api/settings?t=${token}`));
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.review).toEqual({
				agent: "claude",
				model: undefined,
				agents: ["omp", "claude"],
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("reads and seeds the active default prompt", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-prompt-default-"));
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
			});

			const response = await routes(
				request(`/api/prompts/review-chat?t=${token}`),
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				text: DEFAULT_PROMPTS["review-chat"],
				preset: "default",
				version: 1,
				versions: [1],
			});
			expect(
				await Bun.file(join(dir, "review-chat", "default", "001.md")).text(),
			).toBe(DEFAULT_PROMPTS["review-chat"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("reads an explicit preset revision and lists its versions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-prompt-revision-"));
		try {
			const presetDir = join(dir, "review-chat", "terse");
			await mkdir(presetDir, { recursive: true });
			await writeFile(join(presetDir, "001.md"), "first", "utf8");
			await writeFile(join(presetDir, "002.md"), "second", "utf8");
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
			});

			const response = await routes(
				request(`/api/prompts/review-chat?preset=terse&rev=1&t=${token}`),
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				text: "first",
				preset: "terse",
				version: 1,
				versions: [1, 2],
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects unknown slots, invalid presets, and missing revisions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-prompt-errors-"));
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
			});

			const unknownSlot = await routes(
				request(`/api/prompts/not-a-slot?t=${token}`),
			);
			expect(unknownSlot.status).toBe(404);

			const invalidPreset = await routes(
				request(`/api/prompts/review-chat?preset=not%20valid&t=${token}`),
			);
			expect(invalidPreset.status).toBe(400);
			expect(await invalidPreset.json()).toEqual({
				error: expect.any(String),
			});

			const missingRevision = await routes(
				request(`/api/prompts/review-chat?rev=99&t=${token}`),
			);
			expect(missingRevision.status).toBe(400);
			expect(await missingRevision.json()).toEqual({
				error: expect.any(String),
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("requires the review token for both read APIs", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-prompt-token-"));
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
			});

			const settings = await routes(request("/api/settings"));
			expect(settings.status).toBe(401);
			const prompt = await routes(request("/api/prompts/review-chat"));
			expect(prompt.status).toBe(401);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
describe("prompt settings version write API", () => {
	test("saves, skips duplicate text, rolls back, and resets versions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-prompt-write-"));
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
			});
			const changedText = "Edited commit prompt\n";

			const saveResponse = await routes(
				promptRequest("/api/prompts/commit-system", {
					preset: "default",
					text: changedText,
				}),
			);
			expect(saveResponse.status).toBe(200);
			expect(await saveResponse.json()).toEqual({
				version: 2,
				saved: true,
			});
			expect(
				await Bun.file(join(dir, "commit-system", "default", "002.md")).text(),
			).toBe(changedText);

			const duplicateResponse = await routes(
				promptRequest("/api/prompts/commit-system", {
					preset: "default",
					text: `  ${changedText.trim()}  `,
				}),
			);
			expect(duplicateResponse.status).toBe(200);
			expect(await duplicateResponse.json()).toEqual({
				version: 2,
				saved: false,
			});
			expect(
				await Bun.file(
					join(dir, "commit-system", "default", "003.md"),
				).exists(),
			).toBe(false);

			const rollbackResponse = await routes(
				promptRequest("/api/prompts/commit-system/rollback", {
					preset: "default",
					rev: 1,
				}),
			);
			expect(rollbackResponse.status).toBe(200);
			expect(await rollbackResponse.json()).toEqual({ version: 3 });
			expect(
				await Bun.file(join(dir, "commit-system", "default", "003.md")).text(),
			).toBe(DEFAULT_PROMPTS["commit-system"]);

			const resetResponse = await routes(
				promptRequest("/api/prompts/commit-system/reset", {
					preset: "default",
				}),
			);
			expect(resetResponse.status).toBe(200);
			expect(await resetResponse.json()).toEqual({ version: 4 });
			expect(
				await Bun.file(join(dir, "commit-system", "default", "004.md")).text(),
			).toBe(DEFAULT_PROMPTS["commit-system"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("uses active preset when save omits preset", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-prompt-active-"));
		try {
			const presetDir = join(dir, "commit-system", "terse");
			await mkdir(presetDir, { recursive: true });
			await writeFile(join(presetDir, "001.md"), "Terse prompt\n", "utf8");
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
				config: { prompts: { "commit-system": "terse" } },
			});

			const response = await routes(
				promptRequest("/api/prompts/commit-system", {
					text: "Updated terse prompt\n",
				}),
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ version: 2, saved: true });
			expect(await Bun.file(join(presetDir, "002.md")).text()).toBe(
				"Updated terse prompt\n",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects unknown slots and invalid write bodies", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-prompt-errors-"));
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
			});

			const unknownSlot = await routes(
				promptRequest("/api/prompts/not-a-slot", {
					preset: "default",
					text: "x",
				}),
			);
			expect(unknownSlot.status).toBe(404);

			const missingPreset = await routes(
				promptRequest("/api/prompts/commit-system/rollback", { rev: 1 }),
			);
			expect(missingPreset.status).toBe(400);
			expect(await missingPreset.json()).toEqual({
				error: expect.any(String),
			});

			const nonNumericRevision = await routes(
				promptRequest("/api/prompts/commit-system/rollback", {
					preset: "default",
					rev: "1",
				}),
			);
			expect(nonNumericRevision.status).toBe(400);
			expect(await nonNumericRevision.json()).toEqual({
				error: expect.any(String),
			});

			const unknownPreset = await routes(
				promptRequest("/api/prompts/commit-system/rollback", {
					preset: "missing",
					rev: 1,
				}),
			);
			expect(unknownPreset.status).toBe(400);
			expect(await unknownPreset.json()).toEqual({
				error: expect.any(String),
			});

			const resetWithoutPreset = await routes(
				promptRequest("/api/prompts/commit-system/reset", {}),
			);
			expect(resetWithoutPreset.status).toBe(400);
			expect(await resetWithoutPreset.json()).toEqual({
				error: expect.any(String),
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("prompt settings preset API", () => {
	test("creates presets from the active latest prompt and rejects duplicates", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-preset-create-"));
		try {
			const persisted: Partial<Config>[] = [];
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
				persistConfig: async (partial) => {
					persisted.push(partial);
				},
			});
			const latestText = "Latest commit prompt\n";
			await routes(
				promptRequest("/api/prompts/commit-system", {
					preset: "default",
					text: latestText,
				}),
			);

			const createResponse = await routes(
				promptRequest("/api/prompts/commit-system/presets", {
					name: "terse",
				}),
			);
			expect(createResponse.status).toBe(200);
			const created = (await createResponse.json()) as {
				presets: string[];
			};
			expect(created.presets).toEqual(
				expect.arrayContaining(["default", "terse"]),
			);

			const activeResponse = await routes(
				request(`/api/prompts/commit-system?t=${token}`),
			);
			expect(activeResponse.status).toBe(200);
			const active = (await activeResponse.json()) as { text: string };
			expect(
				await Bun.file(join(dir, "commit-system", "terse", "001.md")).text(),
			).toBe(active.text);

			const duplicateResponse = await routes(
				promptRequest("/api/prompts/commit-system/presets", {
					name: "terse",
				}),
			);
			expect(duplicateResponse.status).toBe(409);
			expect(await duplicateResponse.json()).toEqual({
				presets: created.presets,
			});

			const invalidResponse = await routes(
				promptRequest("/api/prompts/commit-system/presets", {
					name: "Bad Name",
				}),
			);
			expect(invalidResponse.status).toBe(400);
			expect(await invalidResponse.json()).toEqual({
				error: expect.any(String),
			});
			expect(persisted).toHaveLength(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("activates existing presets and persists the active map", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-preset-active-"));
		try {
			const persisted: Partial<Config>[] = [];
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
				persistConfig: async (partial) => {
					persisted.push(partial);
				},
			});

			const createResponse = await routes(
				promptRequest("/api/prompts/commit-system/presets", {
					name: "terse",
				}),
			);
			expect(createResponse.status).toBe(200);

			const activateResponse = await routes(
				promptRequest("/api/prompts/commit-system/active", {
					preset: "terse",
				}),
			);
			expect(activateResponse.status).toBe(200);
			expect(await activateResponse.json()).toEqual({
				activePreset: "terse",
			});
			expect(persisted).toEqual([{ prompts: { "commit-system": "terse" } }]);

			const missingResponse = await routes(
				promptRequest("/api/prompts/commit-system/active", {
					preset: "nope",
				}),
			);
			expect(missingResponse.status).toBe(400);
			expect(await missingResponse.json()).toEqual({
				error: "Prompt preset 'nope' not found for commit-system",
			});

			const invalidResponse = await routes(
				promptRequest("/api/prompts/commit-system/active", {
					preset: "Bad Name",
				}),
			);
			expect(invalidResponse.status).toBe(400);
			expect(await invalidResponse.json()).toEqual({
				error: "Prompt preset 'Bad Name' not found for commit-system",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	test("maps persistConfig failures to 500 responses", async () => {
		const dir = await mkdtemp(
			join(tmpdir(), "mole-review-preset-persist-error-"),
		);
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
				persistConfig: async () => {
					throw new Error("persist failed");
				},
			});

			const createResponse = await routes(
				promptRequest("/api/prompts/commit-system/presets", {
					name: "terse",
				}),
			);
			expect(createResponse.status).toBe(200);

			const activateResponse = await routes(
				promptRequest("/api/prompts/commit-system/active", {
					preset: "terse",
				}),
			);
			expect(activateResponse.status).toBe(500);
			expect(await activateResponse.json()).toEqual({
				error: "persist failed",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("uses newly activated preset text for layer regeneration", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-preset-layer-"));
		try {
			const presetDir = join(dir, "review-layers-code", "terse");
			await mkdir(presetDir, { recursive: true });
			await writeFile(
				join(presetDir, "001.md"),
				"ACTIVATED LAYER PROMPT",
				"utf8",
			);
			const agent = new RecordingLayerAgent();
			const routes = createReviewRoutes({
				token,
				state: state(),
				paths: chatPaths(dir),
				diff,
				layerAgent: agent,
				promptSourceDir: dir,
				config: {
					jira: { enabled: false },
					review: { agent: "omp" },
				},
			});

			const activateResponse = await routes(
				promptRequest("/api/prompts/review-layers-code/active", {
					preset: "terse",
				}),
			);
			expect(activateResponse.status).toBe(200);

			const regenerateResponse = await routes(
				request(`/api/layers/regenerate?t=${token}`, { method: "POST" }),
			);
			expect(regenerateResponse.status).toBe(200);
			await regenerateResponse.text();

			expect(agent.prompts).toHaveLength(1);
			expect(agent.prompts[0]).toContain("ACTIVATED LAYER PROMPT");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
describe("review agent settings API", () => {
	test("updates, persists, and swaps the agent for the next chat turn", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-agent-swap-"));
		try {
			const paths = chatPaths(dir);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: paths.chatsDir,
			});
			await store.write(state());

			const original = new StreamChatAgent();
			const swapped = new StreamChatAgent();
			const factoryCalls: Array<{
				agent?: "omp" | "claude";
				model?: string;
			}> = [];
			const persisted: unknown[] = [];
			const routes = createReviewRoutes({
				token,
				store,
				paths,
				reviewAgent: original,
				layerAgent: original,
				config: { review: { agent: "omp" } },
				createReviewAgent: (override) => {
					factoryCalls.push(override ?? {});
					return swapped;
				},
				persistConfig: async (partial) => {
					persisted.push(partial);
				},
			});

			const response = await routes(
				reviewSettingsRequest({ agent: "claude", model: "claude-model" }),
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				agent: "claude",
				model: "claude-model",
			});
			expect(factoryCalls).toEqual([
				{ agent: "claude", model: "claude-model" },
			]);
			expect(persisted).toEqual([
				{ review: { agent: "claude", model: "claude-model" } },
			]);

			const chatResponse = await routes(
				chatRequest({ message: "Use swapped agent" }),
			);
			expect(chatResponse.status).toBe(200);
			await chatResponse.text();
			expect(original.turns).toHaveLength(0);
			expect(swapped.turns).toHaveLength(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("omits a blank model from response, persistence, and factory override", async () => {
		const persisted: unknown[] = [];
		const factoryCalls: Array<{
			agent?: "omp" | "claude";
			model?: string;
		}> = [];
		const routes = createReviewRoutes({
			token,
			state: state(),
			config: { review: { agent: "omp", model: "old-model" } },
			createReviewAgent: (override) => {
				factoryCalls.push(override ?? {});
				return new StreamChatAgent();
			},
			persistConfig: async (partial) => {
				persisted.push(partial);
			},
		});

		const response = await routes(
			reviewSettingsRequest({ agent: "claude", model: "   " }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ agent: "claude" });
		expect(factoryCalls).toEqual([{ agent: "claude" }]);
		expect(persisted).toEqual([{ review: { agent: "claude" } }]);
	});

	test("rejects an invalid review agent", async () => {
		const factoryCalls: unknown[] = [];
		const routes = createReviewRoutes({
			token,
			state: state(),
			createReviewAgent: (override) => {
				factoryCalls.push(override);
				return new StreamChatAgent();
			},
		});

		const response = await routes(reviewSettingsRequest({ agent: "gpt" }));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: expect.any(String) });
		expect(factoryCalls).toHaveLength(0);
	});

	test("returns 501 when review agent factory is unavailable", async () => {
		const routes = createReviewRoutes({ token, state: state() });

		const response = await routes(
			reviewSettingsRequest({ agent: "claude", model: "m" }),
		);
		expect(response.status).toBe(501);
		expect(await response.json()).toEqual({
			error: "Review agent selection is unavailable",
		});
	});

	test("reads swapped review settings from GET /api/settings", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-agent-readback-"));
		try {
			const routes = createReviewRoutes({
				token,
				state: state(),
				promptSourceDir: dir,
				config: { review: { agent: "omp", model: "old-model" } },
				createReviewAgent: () => new StreamChatAgent(),
			});

			const updateResponse = await routes(
				reviewSettingsRequest({ agent: "claude", model: "new-model" }),
			);
			expect(updateResponse.status).toBe(200);

			const settingsResponse = await routes(
				request(`/api/settings?t=${token}`),
			);
			expect(settingsResponse.status).toBe(200);
			const settings = (await settingsResponse.json()) as {
				review: {
					agent: "omp" | "claude";
					model?: string;
					agents: string[];
				};
			};
			expect(settings.review).toEqual({
				agent: "claude",
				model: "new-model",
				agents: ["omp", "claude"],
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
