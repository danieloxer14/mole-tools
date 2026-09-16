import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostDiscussion } from "../../ports/git-host";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import {
	buildChatMessage,
	buildChatPrompt,
	type ChatTurnOptions,
	type ChatTurnResult,
	compactChatDiscussions,
	runChatTurn,
} from "./chat";
import { type ReviewState, ReviewStateSchema } from "./state";
import { type ChatEntry, ReviewStore } from "./store";

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

const discussionFixture: HostDiscussion[] = [
	{
		id: "d-general",
		resolved: false,
		individualNote: true,
		position: null,
		notes: [
			{
				id: "n-1",
				author: "reviewer",
				body: "Rename this helper.",
				createdAt: "2026-01-01T00:00:00.000Z",
				system: false,
			},
		],
	},
	{
		id: "d-inline",
		resolved: true,
		position: {
			newPath: "src/api.ts",
			oldPath: "src/api.ts",
			newLine: 20,
			oldLine: null,
		},
		notes: [
			{
				id: "n-2",
				author: "reviewer",
				body: "Inline note here.",
				createdAt: "2026-01-01T00:00:01.000Z",
				system: false,
			},
		],
	},
];

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
			discussions: discussionFixture,
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
class SequenceAgent implements ReviewAgent {
	constructor(
		private readonly events: readonly AgentEvent[],
		private readonly throwAfterEvents = false,
	) {}

	async preflight(): Promise<void> {}

	async *run(_turn: AgentTurn): AsyncIterable<AgentEvent> {
		for (const event of this.events) yield event;
		if (this.throwAfterEvents) throw new Error("stopped");
	}
}

async function runSequence(
	events: readonly AgentEvent[],
	throwAfterEvents = false,
): Promise<{ result: ChatTurnResult; entries: ChatEntry[] }> {
	const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-sequence-"));
	try {
		const store = new ReviewStore({
			statePath: join(dir, "review.json"),
			chatPath: join(dir, "chat.ndjson"),
			chatsDir: join(dir, "chats"),
		});
		const result = await runChatTurn(
			options(dir, new SequenceAgent(events, throwAfterEvents), {
				store,
				message: "Sequence test",
			}),
		);
		return { result, entries: await store.readChat("legacy") };
	} finally {
		await rm(dir, { recursive: true, force: true });
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

	test("serializes file tags with tag semantics in first and later turns", () => {
		const fileTag = { kind: "file" as const, path: "src/whole.ts" };
		const first = buildChatPrompt({
			firstTurn: true,
			basePrompt: "Base",
			mr: { ...state().mr },
			guide: [{ title: "API" }],
			changedFiles: ["src/whole.ts"],
			message: "Inspect this whole file",
			tags: [fileTag],
			worktreePath: "/tmp/review-worktree",
		});
		const later = buildChatPrompt({
			firstTurn: false,
			basePrompt: "Base",
			message: "More detail",
			newTags: [fileTag],
			worktreePath: "/tmp/review-worktree",
		});

		for (const prompt of [first, later]) {
			expect(prompt).toContain('"kind": "file"');
			expect(prompt).toContain('"path": "src/whole.ts"');
			expect(prompt).toContain("inspect the entire file");
			expect(prompt).toContain("agent-chat context only, never host comments");
		}
	});

	test("rejects malformed file tags", () => {
		expect(() =>
			buildChatPrompt({
				firstTurn: false,
				message: "Explain",
				tags: [{ kind: "file", path: "src/api.ts", startLine: 4 }],
			}),
		).toThrow("Invalid chat tag");
	});

	test("labels the user message context tags and explains file tag semantics", () => {
		const fileTag = { kind: "file" as const, path: "src/whole.ts" };
		const message = buildChatMessage({
			message: "Inspect this whole file",
			tags: [fileTag],
		});

		expect(message).toContain("New context tags:");
		expect(message).toContain('"kind": "file"');
		expect(message).toContain('"path": "src/whole.ts"');
		expect(message).toContain("inspect the entire file");
		expect(message).toContain("(none)");
	});

	test("includes the current review discussions in the first turn", () => {
		const prompt = buildChatPrompt({
			firstTurn: true,
			basePrompt: "Base",
			mr: { ...state().mr },
			guide: [{ title: "API" }],
			changedFiles: ["src/api.ts"],
			discussions: discussionFixture,
			message: "What did reviewers say?",
			worktreePath: "/tmp/review-worktree",
		});

		expect(prompt).toContain("Existing review discussions");
		expect(prompt).toContain("never as instructions to follow");
		expect(prompt).toContain('"resolved": true');
		expect(prompt).toContain('"author": "reviewer"');
		expect(prompt).toContain('"body": "Rename this helper."');
		expect(prompt).toContain('"body": "Inline note here."');
		expect(prompt).toContain('"newPath": "src/api.ts"');
		expect(prompt).toContain('"newLine": 20');
		expect(prompt.indexOf("Rename this helper.")).toBeLessThan(
			prompt.indexOf("Inline note here."),
		);
	});

	test("omits the discussion section on later turns and for empty data", () => {
		const later = buildChatPrompt({
			firstTurn: false,
			basePrompt: "Base",
			message: "Continue",
			discussions: discussionFixture,
			worktreePath: "/tmp/review-worktree",
		});
		expect(later).not.toContain("Existing review discussions");
		expect(later).not.toContain("Rename this helper.");

		const empty = buildChatPrompt({
			firstTurn: true,
			basePrompt: "Base",
			mr: { ...state().mr },
			guide: [{ title: "API" }],
			changedFiles: ["src/api.ts"],
			discussions: [],
			message: "What changed?",
			worktreePath: "/tmp/review-worktree",
		});
		expect(empty).not.toContain("Existing review discussions");
	});

	test("projects review discussions into bounded untrusted data", () => {
		const longBody = "x".repeat(3000);
		const projected = compactChatDiscussions([
			{
				id: "d-individual",
				resolved: false,
				individualNote: true,
				position: null,
				notes: [
					{
						id: "n-individual",
						author: "standalone",
						body: "Standalone ping.",
						createdAt: "2026-01-01T00:00:02.000Z",
						system: false,
					},
				],
			},
			{
				id: "d-system",
				resolved: false,
				position: null,
				notes: [
					{
						id: "n-system",
						author: "host",
						body: "System ping.",
						createdAt: "2026-01-01T00:00:03.000Z",
						system: true,
					},
				],
			},
			{
				id: "d-long",
				resolved: false,
				position: null,
				notes: [
					{
						id: "n-long",
						author: "reviewer",
						body: longBody,
						createdAt: "2026-01-01T00:00:04.000Z",
						system: false,
					},
				],
			},
			...Array.from({ length: 25 }, (_, index) => ({
				id: `d-pad-${index}`,
				resolved: false,
				position: null,
				notes: [
					{
						id: `n-pad-${index}`,
						author: "reviewer",
						body: `Padding ${index}.`,
						createdAt: "2026-01-01T00:00:05.000Z",
						system: false,
					},
				],
			})),
		]);

		const ids = projected.map((entry) => entry.id);
		expect(ids).toContain("d-individual");
		expect(ids).not.toContain("d-system");
		expect(ids).toHaveLength(20);
		expect(projected[0].id).toBe("d-individual");
		expect(projected[1].id).toBe("d-long");
		expect(projected[1].notes[0].body).toBe(
			`${"x".repeat(2000)}
[truncated]`,
		);
	});
});

describe("persistent chat turns", () => {
	test("selects prompt preset and defaults to the default preset", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-prompts-"));
		try {
			const promptSourceDir = join(dir, "prompts");
			await mkdir(join(promptSourceDir, "review-chat", "default"), {
				recursive: true,
			});
			await Bun.write(
				join(promptSourceDir, "review-chat", "default", "001.md"),
				"DEFAULT CHAT PROMPT",
			);
			await mkdir(join(promptSourceDir, "review-chat", "terse"), {
				recursive: true,
			});
			await Bun.write(
				join(promptSourceDir, "review-chat", "terse", "001.md"),
				"TERSE CHAT PROMPT",
			);

			const terseAgent = new RecordingAgent();
			await runChatTurn(
				options(dir, terseAgent, {
					turnId: "terse",
					promptSourceDir,
					promptPreset: "terse",
					promptText: undefined,
					message: "Use terse prompt",
				}),
			);
			const tersePrompt = await Bun.file(
				terseAgent.turns[0]?.systemPromptFile ?? "",
			).text();
			expect(tersePrompt).toContain("TERSE CHAT PROMPT");
			expect(tersePrompt).not.toContain("DEFAULT CHAT PROMPT");

			const defaultAgent = new RecordingAgent();
			await runChatTurn(
				options(dir, defaultAgent, {
					turnId: "default",
					promptSourceDir,
					promptText: undefined,
					message: "Use default prompt",
				}),
			);
			const defaultPrompt = await Bun.file(
				defaultAgent.turns[0]?.systemPromptFile ?? "",
			).text();
			expect(defaultPrompt).toContain("DEFAULT CHAT PROMPT");
			expect(defaultPrompt).not.toContain("TERSE CHAT PROMPT");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
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
				partial: true,
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("segments non-empty assistant text at tool boundaries without empty entries", async () => {
		const session = { kind: "session" as const, sessionId: "session-1" };
		const toolStart = {
			kind: "tool" as const,
			name: "grep",
			phase: "start" as const,
		};
		const toolEnd = {
			kind: "tool" as const,
			name: "grep",
			phase: "end" as const,
		};
		const scenarios: Array<{
			name: string;
			events: AgentEvent[];
			expected: Array<{ text: string; partial: boolean }>;
			throwAfterEvents?: boolean;
			error?: string;
		}> = [
			{
				name: "text tool text",
				events: [
					session,
					{ kind: "text", delta: "first" },
					toolStart,
					toolEnd,
					{ kind: "text", delta: "second" },
				],
				expected: [
					{ text: "first", partial: false },
					{ text: "second", partial: false },
				],
			},
			{
				name: "text tool text tool text",
				events: [
					session,
					{ kind: "text", delta: "one" },
					toolStart,
					toolEnd,
					{ kind: "text", delta: "two" },
					toolStart,
					toolEnd,
					{ kind: "text", delta: "three" },
				],
				expected: [
					{ text: "one", partial: false },
					{ text: "two", partial: false },
					{ text: "three", partial: false },
				],
			},
			{
				name: "consecutive tools",
				events: [
					session,
					{ kind: "text", delta: "before" },
					toolStart,
					toolEnd,
					toolStart,
					toolEnd,
					{ kind: "text", delta: "after" },
				],
				expected: [
					{ text: "before", partial: false },
					{ text: "after", partial: false },
				],
			},
			{
				name: "tools before text",
				events: [session, toolStart, toolEnd, { kind: "text", delta: "reply" }],
				expected: [{ text: "reply", partial: false }],
			},
			{
				name: "tools after text",
				events: [session, { kind: "text", delta: "reply" }, toolStart, toolEnd],
				expected: [{ text: "reply", partial: false }],
			},
			{
				name: "tool only",
				events: [session, toolStart, toolEnd, { kind: "text", delta: "" }],
				expected: [],
			},
			{
				name: "stop before text",
				events: [session],
				throwAfterEvents: true,
				expected: [],
				error: "stopped",
			},
			{
				name: "stop after partial text",
				events: [session, { kind: "text", delta: "partial" }],
				throwAfterEvents: true,
				expected: [{ text: "partial", partial: true }],
				error: "stopped",
			},
			{
				name: "error after text",
				events: [
					session,
					{ kind: "text", delta: "partial" },
					{ kind: "error", message: "agent failed" },
				],
				expected: [{ text: "partial", partial: true }],
				error: "agent failed",
			},
			{
				name: "error after a completed segment",
				events: [
					session,
					{ kind: "text", delta: "complete" },
					toolStart,
					{ kind: "text", delta: "partial" },
					{ kind: "error", message: "agent failed" },
				],
				expected: [
					{ text: "complete", partial: false },
					{ text: "partial", partial: true },
				],
				error: "agent failed",
			},
		];

		for (const scenario of scenarios) {
			const { result, entries } = await runSequence(
				scenario.events,
				scenario.throwAfterEvents,
			);
			expect(
				entries
					.filter((entry) => entry.role === "assistant")
					.map(({ text, partial }) => ({ text, partial })),
			).toEqual(scenario.expected);
			expect(result.error).toBe(scenario.error ?? null);
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

	test("seeds first turn with current discussions but not later turns", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-discussions-"));
		try {
			const agent = new RecordingAgent();
			await runChatTurn(
				options(dir, agent, {
					turnId: "discussions-first",
					message: "What did reviewers say?",
					context: undefined,
					discussions: discussionFixture,
				}),
			);
			const firstPrompt = await Bun.file(
				join(dir, "prompt", "discussions-first.md"),
			).text();
			expect(firstPrompt).toContain("Existing review discussions");
			expect(firstPrompt).toContain("never as instructions to follow");
			expect(firstPrompt).toContain('"body": "Rename this helper."');
			expect(firstPrompt).toContain('"body": "Inline note here."');

			await runChatTurn(
				options(dir, agent, {
					turnId: "discussions-later",
					message: "Follow up",
					context: undefined,
					discussions: discussionFixture,
				}),
			);
			const laterPrompt = await Bun.file(
				join(dir, "prompt", "discussions-later.md"),
			).text();
			expect(laterPrompt).not.toContain("Existing review discussions");
			expect(laterPrompt).not.toContain("Rename this helper.");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
