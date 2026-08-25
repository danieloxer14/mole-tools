import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import type { HostDiscussion } from "../../ports/git-host";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import type { ParsedFileDiff } from "../../shared/diff-parse";
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
