import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatTag } from "../../src/features/review/chat-tags";
import {
	createReviewServer,
	type ReviewServer,
} from "../../src/features/review/server";
import { ReviewStateSchema } from "../../src/features/review/state";
import { ReviewStore } from "../../src/features/review/store";
import type {
	CreateDiscussionInput,
	HostDiscussion,
} from "../../src/ports/git-host";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../src/ports/review-agent";
import type { ParsedFileDiff } from "../../src/shared/diff-parse";
import type { MrRef } from "../../src/shared/mr-url";

class WholeFileAgent implements ReviewAgent {
	async preflight(): Promise<void> {}

	async *run(_turn: AgentTurn): AsyncIterable<AgentEvent> {
		yield { kind: "session", sessionId: "sess-file-tag" };
		yield { kind: "text", delta: "Whole-file review done." };
		yield { kind: "turn_end" };
	}
}

/** A tag for the normal, hunk-bearing file. */
const normalTag: ChatTag = { kind: "file", path: "src/app.ts" };
/** A tag for the collapsed, stat-only file. */
const statTag: ChatTag = { kind: "file", path: "lib/bin" };

const diff: ParsedFileDiff[] = [
	{
		oldPath: "src/app.ts",
		newPath: "src/app.ts",
		status: "modified",
		binary: false,
		insertions: 1,
		deletions: 0,
		hunks: [
			{
				header: "@@ -1 +1 @@",
				oldStart: 1,
				oldLines: 1,
				newStart: 1,
				newLines: 1,
				lines: [
					{
						kind: "add",
						oldLine: null,
						newLine: 1,
						text: "export const ok = true;",
					},
				],
			},
		],
	},
	{
		oldPath: "lib/bin",
		newPath: "lib/bin",
		status: "modified",
		binary: false,
		insertions: 4,
		deletions: 2,
		hunks: [],
	},
];

let dir = "";
let server: ReviewServer;
let store: ReviewStore;
let baseUrl = "";
let token = "";
const createDiscussionCalls: CreateDiscussionInput[] = [];

async function readSse(body: ReadableStream<Uint8Array>): Promise<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		text += decoder.decode(value);
	}
	return text;
}

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "mole-file-tag-"));
	store = new ReviewStore({
		statePath: join(dir, "state.json"),
		chatPath: join(dir, "chat.ndjson"),
		chatsDir: join(dir, "chats"),
	});
	await store.mutate(() =>
		ReviewStateSchema.parse({
			version: 1,
			mode: "code",
			mr: {
				host: "gitlab.example.com",
				projectPath: "group/project",
				iid: 42,
				webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
				title: "File tag smoke",
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
			layerStatus: "ready",
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
		}),
	);
	server = createReviewServer({
		token: "file-tag-token",
		store,
		paths: {
			layersDir: join(dir, "layers"),
			promptDir: join(dir, "prompt"),
			layerPath: (id: string) => join(dir, "layers", id),
			promptPath: (id: string) => join(dir, "prompt", `${id}.md`),
		},
		promptText: "Test chat prompt.",
		reviewAgent: new WholeFileAgent(),
		diff,
		gitHost: {
			listDiscussions: async (_ref: MrRef): Promise<HostDiscussion[]> => [],
			createDiscussion: (input: CreateDiscussionInput) => {
				createDiscussionCalls.push(input);
				return Promise.reject(new Error("must not be called"));
			},
		},
	});
	const address = server.start();
	baseUrl = `http://${address.hostname}:${address.port}`;
	token = address.token;
});

afterAll(async () => {
	await server.stop();
	await rm(dir, { recursive: true, force: true });
});

test("whole-file tags survive the real HTTP chat round-trip", async () => {
	// The UI only offers "Tag whole file" for non-empty paths in the diff.
	const stateResponse = await fetch(`${baseUrl}/api/state?t=${token}`);
	expect(stateResponse.status).toBe(200);
	const apiState = (await stateResponse.json()) as {
		diff: ParsedFileDiff[];
	};
	const taggedPaths = apiState.diff
		.filter((file) => file.binary === false)
		.map((file) => file.newPath ?? file.oldPath ?? "")
		.filter((candidate) => candidate.length > 0);
	expect(taggedPaths).toEqual(["src/app.ts", "lib/bin"]);

	// Send one tag per path, exactly what the deduplicating composer would
	// ship after "Tag whole file" is clicked for a normal and a stat-only
	// file.
	const chatResponse = await fetch(`${baseUrl}/api/chat?t=${token}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			chatId: "chat-a",
			message: "Inspect both tagged files.",
			tags: [normalTag, statTag],
			openFile: null,
		}),
	});
	expect(chatResponse.status).toBe(200);
	expect(chatResponse.headers.get("content-type")).toContain(
		"text/event-stream",
	);
	if (!chatResponse.body) throw new Error("Chat stream missing body");
	const stream = await readSse(chatResponse.body);
	expect(stream).toContain("Whole-file review done.");

	// The persisted transcript keeps one tag per path, in order.
	const transcript = await store.readChat("chat-a");
	const userEntry = transcript.find((entry) => entry.role === "user");
	expect(userEntry).toBeDefined();
	expect(userEntry?.tags).toEqual([normalTag, statTag]);
	expect(transcript).toHaveLength(2);

	// The persisted prompt keeps whole-file semantics for every tag.
	const promptDir = join(dir, "prompt");
	const promptNames = (await readdir(promptDir)).sort();
	expect(promptNames).toHaveLength(1);
	const prompt = await Bun.file(join(promptDir, promptNames[0])).text();
	expect(prompt).toContain('"kind": "file"');
	expect(prompt).toContain('"path": "src/app.ts"');
	expect(prompt).toContain('"path": "lib/bin"');
	expect(prompt).toContain(
		'kind "file" and a path only means inspect the entire file at that path',
	);

	// Tags are chat context only: no GitLab discussion was created.
	expect(createDiscussionCalls).toHaveLength(0);
}, 15000);
