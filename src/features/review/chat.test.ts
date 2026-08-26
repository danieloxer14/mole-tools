import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import { buildChatPrompt, type ChatTurnOptions, runChatTurn } from "./chat";
import { type ReviewState, ReviewStateSchema } from "./state";
import { ReviewStore } from "./store";

function state(): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/api",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/api/-/merge_requests/42",
			title: "Improve API",
			sourceBranch: "feature/api",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "base", headSha: "head" },
			syncedAt: "2026-08-15T00:00:00.000Z",
		},
		worktreePath: "/tmp/review-worktree",
		repoRoot: "/tmp/repo",
		layerStatus: "ready",
		layerError: null,
		layers: [
			{
				id: "layer-1",
				title: "API",
				tldr: "Review API behavior",
				files: ["src/api.ts"],
				bdd: [],
				done: false,
				stale: false,
			},
		],
		viewedFiles: [],
		drafts: [],
	});
}
const CHAT_A_ID = "chat-a";
const CHAT_B_ID = "chat-b";

function multiChatState(): ReviewState {
	const base = state();
	return ReviewStateSchema.parse({
		...base,
		chats: [
			{
				id: CHAT_A_ID,
				title: "Chat A",
				sessionId: null,
				createdAt: base.revision.syncedAt,
			},
			{
				id: CHAT_B_ID,
				title: "Chat B",
				sessionId: null,
				createdAt: base.revision.syncedAt,
			},
		],
		activeChatId: CHAT_A_ID,
	});
}

function options(
	dir: string,
	agent: ReviewAgent,
	extra: Partial<ChatTurnOptions> = {},
): ChatTurnOptions {
	return {
		agent,
		store: new ReviewStore({
			statePath: join(dir, "review.json"),
			chatPath: join(dir, "chat.ndjson"),
			chatsDir: join(dir, "chats"),
		}),
		state: state(),
		chatId: "legacy",
		promptDir: join(dir, "prompt"),
		promptPath: (turnId) => join(dir, "prompt", `${turnId}.md`),
		promptText: "Base chat prompt.",
		context: {
			mr: {
				...state().mr,
				headSha: "head",
			},
			guide: [{ title: "API", files: ["src/api.ts"] }],
			changedFiles: ["src/api.ts", "src/api.test.ts"],
		},
		message: "What changed?",
		...extra,
	};
}

class RecordingAgent implements ReviewAgent {
	readonly turns: AgentTurn[] = [];
	private readonly failAfterText: boolean;
	private readonly sessionIds: readonly string[];

	constructor(
		failAfterText = false,
		sessionIds: readonly string[] = ["session-1"],
	) {
		this.failAfterText = failAfterText;
		this.sessionIds = sessionIds;
	}

	async preflight(): Promise<void> {}

	run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.turns.push(turn);
		const fail = this.failAfterText;
		const sessionId =
			this.sessionIds[this.turns.length - 1] ??
			this.sessionIds[this.sessionIds.length - 1] ??
			"session-1";
		return (async function* () {
			yield { kind: "session", sessionId };
			yield { kind: "text", delta: "partial " };
			if (fail) throw new Error("stopped");
			yield { kind: "text", delta: "answer" };
			yield { kind: "turn_end" };
		})();
	}
}

describe("chat prompt construction", () => {
	test("seeds first turn and sends only deltas on later turns", () => {
		const tag = {
			path: "src/api.ts",
			side: "new" as const,
			startLine: 20,
			endLine: 22,
			hunk: "@@ -19,3 +20,4 @@",
		};
		const first = buildChatPrompt({
			firstTurn: true,
			basePrompt: "Base",
			mr: { ...state().mr },
			guide: [{ title: "API" }],
			changedFiles: ["src/api.ts"],
			message: "Explain this",
			tags: [tag],
			openFile: "src/api.ts",
			worktreePath: "/tmp/review-worktree",
		});
		const later = buildChatPrompt({
			firstTurn: false,
			basePrompt: "Base",
			message: "Continue",
			newTags: [tag],
			currentFile: "src/api.ts",
			worktreePath: "/tmp/review-worktree",
		});

		expect(first).toContain('"projectPath": "group/api"');
		expect(first).toContain('"title": "API"');
		expect(first).toContain('"src/api.ts"');
		expect(first).toContain('"hunk": "@@ -19,3 +20,4 @@"');
		expect(later).not.toContain("Merge request metadata:");
		expect(later).not.toContain("Changed files:");
		expect(later).toContain("Continue");
		expect(later).toContain("Current file");
		expect(first).toContain("pinned at the absolute path /tmp/review-worktree");
		expect(later).toContain("pinned at the absolute path /tmp/review-worktree");
		expect(later).toContain("even though the tools are not sandboxed");
		expect(first).toContain("bash");
	});

	test("rejects malformed line tags", () => {
		expect(() =>
			buildChatPrompt({
				firstTurn: false,
				message: "Explain",
				tags: [
					{
						path: "src/api.ts",
						side: "new",
						startLine: 4,
						endLine: 3,
						hunk: "@@",
					},
				],
			}),
		).toThrow("Invalid chat tag");
	});
});

describe("persistent chat turns", () => {
	test("persists session, transcript, deltas, and read-only agent context", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-test-"));
		try {
			const agent = new RecordingAgent();
			const first = await runChatTurn(
				options(dir, agent, {
					chatId: "legacy",
					turnId: "first",
					message: "What changed?",
					tags: [
						{
							path: "src/api.ts",
							side: "new",
							startLine: 20,
							endLine: 22,
							hunk: "@@ -19,3 +20,4 @@",
						},
					],
					openFile: "src/api.ts",
				}),
			);
			const secondStore = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await runChatTurn(
				options(dir, agent, {
					store: secondStore,
					chatId: "legacy",
					turnId: "second",
					message: "Which file did you mention?",
					changedFiles: [],
					guide: [],
					context: undefined,
					currentFile: "src/api.ts",
				}),
			);

			expect(first.state.chats).toEqual([
				expect.objectContaining({ id: "legacy", sessionId: "session-1" }),
			]);
			expect(agent.turns[0]?.writeDir).toBeUndefined();
			expect(agent.turns[1]?.sessionId).toBe("session-1");
			expect(await secondStore.read()).toMatchObject({
				chats: [
					expect.objectContaining({ id: "legacy", sessionId: "session-1" }),
				],
			});
			expect(await secondStore.readChat("legacy")).toEqual([
				expect.objectContaining({ role: "user", sessionId: null }),
				expect.objectContaining({ role: "assistant", text: "partial answer" }),
				expect.objectContaining({
					role: "user",
					sessionId: "session-1",
					text: "Which file did you mention?",
				}),
				expect.objectContaining({ role: "assistant", text: "partial answer" }),
			]);
			const secondPrompt = await Bun.file(
				join(dir, "prompt", "second.md"),
			).text();
			expect(secondPrompt).not.toContain("Merge request metadata:");
			expect(secondPrompt).toContain("Which file did you mention?");
			expect(
				await Bun.file(agent.turns[0]?.systemPromptFile ?? "").text(),
			).toContain("read-only");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	test("rejects an unknown chat", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-unknown-"));
		try {
			await expect(
				runChatTurn(
					options(dir, new RecordingAgent(), {
						chatId: "missing",
						message: "This should not run",
					}),
				),
			).rejects.toThrow("Unknown chat: missing");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("isolates provider sessions and transcripts by chat", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-isolated-"));
		try {
			const agent = new RecordingAgent(false, [
				"session-a",
				"session-b",
				"session-a",
			]);
			const sharedState = multiChatState();
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});

			await runChatTurn(
				options(dir, agent, {
					store,
					state: sharedState,
					chatId: CHAT_A_ID,
					turnId: "chat-a-first",
					message: "Explain chat A",
				}),
			);
			await runChatTurn(
				options(dir, agent, {
					store,
					state: sharedState,
					chatId: CHAT_B_ID,
					turnId: "chat-b-first",
					message: "Explain chat B",
				}),
			);
			await runChatTurn(
				options(dir, agent, {
					store,
					state: sharedState,
					chatId: CHAT_A_ID,
					turnId: "chat-a-second",
					message: "Follow up in chat A",
					context: undefined,
					changedFiles: [],
					guide: [],
				}),
			);

			expect(agent.turns[0]?.sessionId).toBeUndefined();
			expect(agent.turns[1]?.sessionId).toBeUndefined();
			expect(agent.turns[2]?.sessionId).toBe("session-a");

			const persisted = await store.read();
			expect(persisted?.chats).toEqual([
				expect.objectContaining({ id: CHAT_A_ID, sessionId: "session-a" }),
				expect.objectContaining({ id: CHAT_B_ID, sessionId: "session-b" }),
			]);

			const chatA = await store.readChat(CHAT_A_ID);
			const chatB = await store.readChat(CHAT_B_ID);
			expect(chatA).toEqual([
				expect.objectContaining({ role: "user", text: "Explain chat A" }),
				expect.objectContaining({ role: "assistant", text: "partial answer" }),
				expect.objectContaining({
					role: "user",
					text: "Follow up in chat A",
				}),
				expect.objectContaining({ role: "assistant", text: "partial answer" }),
			]);
			expect(chatB).toEqual([
				expect.objectContaining({ role: "user", text: "Explain chat B" }),
				expect.objectContaining({ role: "assistant", text: "partial answer" }),
			]);

			const secondChatPrompt = await Bun.file(
				join(dir, "prompt", "chat-b-first.md"),
			).text();
			expect(secondChatPrompt).toContain("Merge request metadata:");
			expect(secondChatPrompt).toContain("Layer guide:");
			expect(secondChatPrompt).toContain("Changed files:");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("retains partial assistant text after a failed stream", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-partial-"));
		try {
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			const result = await runChatTurn(
				options(dir, new RecordingAgent(true), {
					store,
					message: "Stop safely",
				}),
			);
			expect(result.text).toBe("partial ");
			expect(result.error).toBe("stopped");
			expect((await store.readChat("legacy")).at(-1)).toMatchObject({
				role: "assistant",
				text: "partial ",
				sessionId: "session-1",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("preserves live state when chat, layers, and progress interleave", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-race-"));
		try {
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatsDir: join(dir, "chats"),
				chatPath: join(dir, "chat.ndjson"),
			});
			const initial = state();
			await store.write(initial);

			const layerSnapshot = ReviewStateSchema.parse({
				...initial,
				layerStatus: "ready",
				layerError: null,
				layers: initial.layers.map((layer) => ({ ...layer, done: true })),
			});
			const progressSnapshot = ReviewStateSchema.parse({
				...initial,
				viewedFiles: ["src/api.ts"],
			});
			const chatSnapshot = ReviewStateSchema.parse({
				...initial,
				chats: [
					{
						id: "legacy",
						title: "",
						sessionId: "session-1",
						createdAt: initial.revision.syncedAt,
					},
				],
				activeChatId: "legacy",
			});

			await Promise.all([
				store.mutate((current) => ({
					...(current ?? layerSnapshot),
					layerStatus: layerSnapshot.layerStatus,
					layerError: layerSnapshot.layerError,
					layers: layerSnapshot.layers,
				})),
				store.mutate((current) => ({
					...(current ?? progressSnapshot),
					viewedFiles: progressSnapshot.viewedFiles,
				})),
				store.mutate((current) => ({
					...(current ?? chatSnapshot),
					chats: chatSnapshot.chats,
				})),
			]);

			expect(await store.read()).toMatchObject({
				layerStatus: "ready",
				chats: [
					expect.objectContaining({ id: "legacy", sessionId: "session-1" }),
				],
				viewedFiles: ["src/api.ts"],
				layers: [{ id: "layer-1", done: true }],
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
