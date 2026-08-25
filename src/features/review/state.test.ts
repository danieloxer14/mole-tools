import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getReviewPaths } from "./paths";
import {
	CHAT_ID_PATTERN,
	deriveChatTitle,
	ensureChats,
	LEGACY_CHAT_ID,
	type ReviewState,
	ReviewStateSchema,
} from "./state";
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
		worktreePath: "/tmp/worktree",
		repoRoot: "/tmp/repo",

		layerStatus: "pending",
		layerError: null,
		layers: [],
	});
}
describe("ReviewState", () => {
	test("migrates legacy session state at the store boundary", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-legacy-state-"));
		try {
			const legacySessionKey = ["chat", "SessionId"].join("");
			const statePath = join(dir, "review.json");
			await Bun.write(
				statePath,
				JSON.stringify({
					...state(),
					[legacySessionKey]: "legacy-session",
				}),
			);
			const store = new ReviewStore({
				statePath,
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});

			const normalized = await store.read();
			expect(normalized).toMatchObject({
				activeChatId: "legacy",
				chats: [
					{
						id: "legacy",
						title: "",
						sessionId: "legacy-session",
						createdAt: expect.any(String),
					},
				],
			});
			expect(
				(normalized as Record<string, unknown>)[legacySessionKey],
			).toBeNull();
			expect(ensureChats(normalized as ReviewState)).toBe(normalized);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("repairs an active chat id that does not exist", () => {
		const parsed = ReviewStateSchema.parse({
			...state(),
			chats: [
				{
					id: "first",
					createdAt: "2026-08-15T00:00:00.000Z",
				},
				{
					id: "second",
					createdAt: "2026-08-15T00:00:00.000Z",
				},
			],
			activeChatId: "missing",
		});

		expect(ensureChats(parsed).activeChatId).toBe("first");
	});

	test("derives bounded titles from normalized messages", () => {
		expect(deriveChatTitle("  first\n\tsecond   third  ")).toBe(
			"first second third",
		);
		expect(deriveChatTitle("a".repeat(48))).toBe("a".repeat(48));
		expect(deriveChatTitle("a".repeat(49))).toBe(`${"a".repeat(48)}…`);
	});

	test("accepts only safe chat ids", () => {
		expect(CHAT_ID_PATTERN.test("A_9-z")).toBe(true);
		expect(CHAT_ID_PATTERN.test("a".repeat(64))).toBe(true);
		for (const id of ["", "has.dot", "has/slash", "a".repeat(65)]) {
			expect(CHAT_ID_PATTERN.test(id)).toBe(false);
		}
	});

	test("parses fixtures without multi-chat fields", () => {
		const parsed = ReviewStateSchema.parse({
			...state(),
			chats: undefined,
			activeChatId: undefined,
		});

		expect(parsed.chats).toEqual([]);
		expect(parsed.activeChatId).toBeNull();
	});

	test("builds per-chat transcript paths while retaining legacy path", () => {
		const paths = getReviewPaths(
			{ host: "gitlab.example.com", projectPath: "group/api", iid: 42 },
			"/tmp/mole/config.json",
		);

		expect(paths.chatsDir).toBe(
			"/tmp/mole/reviews/gitlab.example.com/group/api/mr-42/chats",
		);
		expect(paths.chatTranscriptPath("chat_1")).toBe(
			"/tmp/mole/reviews/gitlab.example.com/group/api/mr-42/chats/chat_1.ndjson",
		);
		expect(paths.chatPath).toBe(
			"/tmp/mole/reviews/gitlab.example.com/group/api/mr-42/chat.ndjson",
		);
	});
});

describe("ReviewStore", () => {
	test("writes and reads version-one state with schema defaults", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-state-"));
		try {
			const store = new ReviewStore({
				statePath: join(dir, "nested", "review.json"),
				chatPath: join(dir, "nested", "chat.ndjson"),
				chatsDir: join(dir, "nested", "chats"),
			});
			await store.write(state());
			expect(await store.read()).toMatchObject({
				version: 1,
				viewedFiles: [],
				drafts: [],
				activeChatId: LEGACY_CHAT_ID,
				chats: [{ id: LEGACY_CHAT_ID, sessionId: null }],
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("discards a state file with an unsupported version", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-version-"));
		try {
			const statePath = join(dir, "review.json");
			await Bun.write(statePath, JSON.stringify({ version: 2 }));
			const store = new ReviewStore({
				statePath,
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			expect(await store.read()).toBeNull();
			expect(await Bun.file(statePath).exists()).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("atomically replaces read-only state and serializes writes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-atomic-"));
		const statePath = join(dir, "review.json");
		try {
			const store = new ReviewStore({
				statePath,
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await store.write(state());
			await chmod(statePath, 0o444);

			const replacement = state();
			replacement.mr.title = "Replacement";
			const latest = state();
			latest.mr.title = "Latest";
			await Promise.all([store.write(replacement), store.write(latest)]);

			expect((await store.read())?.mr.title).toBe("Latest");
		} finally {
			await chmod(statePath, 0o644).catch(() => undefined);
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("appends chat entries as newline-delimited JSON", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-"));
		try {
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			await Promise.all([
				store.appendChat("chat-one", { role: "user", text: "first" }),
				store.appendChat("chat-one", {
					role: "assistant",
					text: "second",
					sessionId: "s1",
				}),
			]);
			expect(await store.readChat("chat-one")).toEqual([
				{
					role: "user",
					text: "first",
					tags: [],
					at: expect.any(String),
					sessionId: null,
				},
				{
					role: "assistant",
					text: "second",
					tags: [],
					at: expect.any(String),
					sessionId: "s1",
				},
			]);
			await expect(store.readChat("chat-two")).resolves.toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("isolates concurrent chat appends and preserves each chat order", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-concurrent-"));
		try {
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});
			const firstChat = Array.from(
				{ length: 8 },
				(_, index) => `first-${index}`,
			);
			const secondChat = Array.from(
				{ length: 8 },
				(_, index) => `second-${index}`,
			);

			await Promise.all([
				...firstChat.map((text) =>
					store.appendChat("chat-first", { role: "user", text }),
				),
				...secondChat.map((text) =>
					store.appendChat("chat-second", { role: "user", text }),
				),
			]);

			expect(
				(await store.readChat("chat-first")).map((entry) => entry.text),
			).toEqual(firstChat);
			expect(
				(await store.readChat("chat-second")).map((entry) => entry.text),
			).toEqual(secondChat);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects unsafe chat ids before writing", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-invalid-"));
		try {
			const chatsDir = join(dir, "chats");
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir,
			});

			await expect(
				store.appendChat("../../review", { role: "user", text: "escape" }),
			).rejects.toThrow("Invalid chat id: ../../review");
			expect(
				await Bun.file(join(chatsDir, "../../review.ndjson")).exists(),
			).toBe(false);
			await expect(store.readChat("../../review")).rejects.toThrow(
				"Invalid chat id: ../../review",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("adopts a legacy transcript and derives its first user title", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-adopt-"));
		try {
			const chatPath = join(dir, "chat.ndjson");
			const targetPath = join(dir, "chats", `${LEGACY_CHAT_ID}.ndjson`);
			const entries = [
				{
					role: "assistant",
					text: "Earlier answer",
					tags: [],
					at: "2026-08-15T00:00:00.000Z",
					sessionId: "session-1",
				},
				{
					role: "user",
					text: "  Explain\nthis review  ",
					tags: [],
					at: "2026-08-15T00:01:00.000Z",
					sessionId: null,
				},
			];
			const raw = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
			await Bun.write(chatPath, raw);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath,
				chatsDir: join(dir, "chats"),
			});

			await expect(store.adoptLegacyChat()).resolves.toBe(
				"Explain this review",
			);
			expect(await Bun.file(chatPath).exists()).toBe(false);
			expect(await Bun.file(targetPath).text()).toBe(raw);
			expect(await store.readChat(LEGACY_CHAT_ID)).toEqual(entries);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("does not adopt when legacy source is absent", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-no-legacy-"));
		try {
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
				chatsDir: join(dir, "chats"),
			});

			await expect(store.adoptLegacyChat()).resolves.toBeNull();
			expect(
				await Bun.file(join(dir, "chats", `${LEGACY_CHAT_ID}.ndjson`)).exists(),
			).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("does not overwrite an existing adopted transcript", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-chat-adopted-"));
		try {
			const chatPath = join(dir, "chat.ndjson");
			const targetPath = join(dir, "chats", `${LEGACY_CHAT_ID}.ndjson`);
			const legacyRaw = JSON.stringify({
				role: "user",
				text: "Legacy source",
				tags: [],
				at: "2026-08-15T00:00:00.000Z",
				sessionId: null,
			});
			const targetRaw = JSON.stringify({
				role: "user",
				text: "Existing target",
				tags: [],
				at: "2026-08-15T00:01:00.000Z",
				sessionId: null,
			});
			await Bun.write(chatPath, `${legacyRaw}\n`);
			await Bun.write(targetPath, `${targetRaw}\n`);
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath,
				chatsDir: join(dir, "chats"),
			});

			await expect(store.adoptLegacyChat()).resolves.toBeNull();
			expect(await Bun.file(chatPath).text()).toBe(`${legacyRaw}\n`);
			expect(await Bun.file(targetPath).text()).toBe(`${targetRaw}\n`);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
