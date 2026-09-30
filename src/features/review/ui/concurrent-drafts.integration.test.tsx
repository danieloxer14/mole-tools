import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import type { HostDiscussion } from "../../../ports/git-host";
import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../../ports/review-agent";
import type { ParsedFileDiff } from "../../../shared/diff-parse";
import { createReviewRoutes } from "../routes";
import { type ReviewState, ReviewStateSchema } from "../state";
import { ReviewStore } from "../store";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const token = "concurrent-draft-smoke-token";
const selection = {
	path: "src/app.ts",
	side: "new" as const,
	startLine: 2,
	endLine: 2,
};
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
				header: "@@ -1 +1,2 @@",
				oldStart: 1,
				oldLines: 1,
				newStart: 1,
				newLines: 2,
				lines: [
					{ kind: "context", oldLine: 1, newLine: 1, text: "const a = 1;" },
					{ kind: "add", oldLine: null, newLine: 2, text: "const b = 2;" },
				],
			},
		],
	},
];

function draft(id: string) {
	return {
		id,
		body: "",
		selection,
		filePath: selection.path,
		status: "draft" as const,
		error: null,
		postedDiscussionId: null,
		staleSince: null,
	};
}

function reviewState(drafts: ReviewState["drafts"]): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Concurrent drafts",
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
		drafts,
	});
}

class DeferredCommentAgent implements ReviewAgent {
	hasStarted = false;
	readonly release = Promise.withResolvers<void>();

	async preflight(): Promise<void> {}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		this.hasStarted = true;
		await this.release.promise;
		const writeDir = turn.writeDir ?? ".";
		await mkdir(writeDir, { recursive: true });
		await Bun.write(join(writeDir, "comment.md"), "Generated for B");
		yield { kind: "turn_end" };
	}
}

async function waitFor(
	label: string,
	condition: () => boolean | Promise<boolean>,
): Promise<void> {
	for (let attempt = 0; attempt < 800; attempt++) {
		let ready = false;
		await act(async () => {
			ready = await condition();
			if (!ready) await Bun.sleep(5);
		});
		if (ready) return;
	}
	throw new Error(`Timed out waiting for ${label}`);
}

function enterText(textarea: HTMLTextAreaElement, value: string): void {
	Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set?.call(textarea, value);
	textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
}

describe("concurrent draft route and mounted UI smoke", () => {
	test("Send A refresh keeps generated B visible and persisted", {
		timeout: 30_000,
	}, async () => {
		if (process.env.MOLE_T004_CONCURRENT_DRAFTS_CHILD !== "1") {
			const smokePath = new URL(
				"./concurrent-drafts.integration.test.tsx",
				import.meta.url,
			).pathname;
			const child = Bun.spawn(["bun", "test", smokePath], {
				cwd: process.cwd(),
				env: {
					...process.env,
					MOLE_T004_CONCURRENT_DRAFTS_CHILD: "1",
				},
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (exitCode !== 0)
				throw new Error(`Mounted route smoke failed:\n${stdout}\n${stderr}`);
			expect(`${stdout}\n${stderr}`).toContain("1 pass");
			return;
		}
		const dir = await mkdtemp(join(tmpdir(), "mole-concurrent-drafts-smoke-"));
		const container = document.createElement("div");
		container.innerHTML = '<div id="root"></div>';
		document.body.append(container);
		window.history.replaceState(null, "", `/?t=${token}`);

		const originalFetch = globalThis.fetch;
		const store = new ReviewStore({
			statePath: join(dir, "review.json"),
			chatPath: join(dir, "chat.ndjson"),
			chatsDir: join(dir, "chats"),
		});
		const initial = reviewState([draft("draft-a"), draft("draft-b")]);
		const agent = new DeferredCommentAgent();
		const postedDiscussions: HostDiscussion[] = [];
		const postedBodies: string[] = [];
		const releasePost = Promise.withResolvers<void>();
		const releaseStateRefresh = Promise.withResolvers<void>();
		let postHasStarted = false;
		let stateRefreshHasStarted = false;
		let stateGetCount = 0;

		try {
			await store.write(initial);
			await store.appendChat("chat-a", {
				role: "assistant",
				text: "Use generated suggestion for B.",
			});
			const promptDir = join(dir, "prompt");
			const commentPromptDir = join(
				promptDir,
				"review-comment-from-chat",
				"default",
			);
			await mkdir(commentPromptDir, { recursive: true });
			await writeFile(join(commentPromptDir, "001.md"), "Generate a comment.");
			const routes = createReviewRoutes({
				token,
				store,
				paths: {
					layersDir: join(dir, "layers"),
					promptDir,
					layerPath: (runId) => join(dir, "layers", `${runId}.json`),
					promptPath: (turnId) => join(promptDir, `${turnId}.md`),
				},
				diff,
				reviewAgent: agent,
				getDiscussions: async () => postedDiscussions,
				gitHost: {
					createDiscussion: async (input) => {
						postedBodies.push(input.body);
						postHasStarted = true;
						await releasePost.promise;
						const posted = {
							id: "discussion-a",
							resolved: false,
							position: {
								oldPath: "src/app.ts",
								newPath: "src/app.ts",
								oldLine: 1,
								newLine: 2,
							},
							notes: [
								{
									id: "note-a",
									author: "reviewer",
									body: input.body,
									createdAt: "2026-01-01T00:00:00.000Z",
									system: false,
								},
							],
						} satisfies HostDiscussion;
						postedDiscussions.push(posted);
						return posted;
					},
					fetchApprovalState: async () => ({
						approved: false,
						currentUser: "reviewer",
						approvalsLeft: 1,
						approvedBy: [],
						rules: [],
					}),
				},
			});

			globalThis.fetch = async (input, init) => {
				const request = new Request(
					input instanceof Request
						? input
						: new URL(
								input instanceof URL ? input.href : input,
								window.location.href,
							),
					init,
				);
				const response = await routes(request);
				if (
					request.method === "GET" &&
					new URL(request.url).pathname === "/api/state"
				) {
					stateGetCount++;
					if (stateGetCount === 2) {
						stateRefreshHasStarted = true;
						await releaseStateRefresh.promise;
					}
				}
				return response;
			};

			// The entry module boots during evaluation; install root and route fetch first.
			await act(async () => {
				await import("./main");
				await Bun.sleep(0);
			});
			const root = container.querySelector<HTMLElement>("#root");
			if (!root) throw new Error("Review app root is missing");
			await waitFor(
				"two mounted draft cards and loaded chat controls",
				() =>
					container.querySelectorAll("article[data-draft-id]").length === 2 &&
					container.querySelector(
						'article[data-draft-id="draft-b"] button[aria-label="From chat"]:not([disabled])',
					) !== null,
			);

			const articleA = container.querySelector<HTMLElement>(
				'article[data-draft-id="draft-a"]',
			);
			const articleB = container.querySelector<HTMLElement>(
				'article[data-draft-id="draft-b"]',
			);
			const textareaA = articleA?.querySelector<HTMLTextAreaElement>(
				' textarea[aria-label="Comment draft"]',
			);
			const textareaB = articleB?.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Comment draft"]',
			);
			expect(textareaA).not.toBeNull();
			expect(textareaB).not.toBeNull();
			await act(async () => {
				enterText(textareaA as HTMLTextAreaElement, "Body from A");
				enterText(textareaB as HTMLTextAreaElement, "Body from B");
			});
			await waitFor("both edits persisted by their draft IDs", async () => {
				const persisted = await store.read();
				return (
					persisted?.drafts.find((item) => item.id === "draft-a")?.body ===
						"Body from A" &&
					persisted.drafts.find((item) => item.id === "draft-b")?.body ===
						"Body from B"
				);
			});

			const sendA = [...(articleA?.querySelectorAll("button") ?? [])].find(
				(button) => button.textContent?.trim() === "Send",
			);
			const fromChatB = articleB?.querySelector<HTMLButtonElement>(
				'button[aria-label="From chat"]',
			);
			expect(sendA).not.toBeUndefined();
			expect(fromChatB?.disabled).toBe(false);
			act(() => sendA?.click());
			await waitFor("A discussion post to start", () => postHasStarted);
			act(() => fromChatB?.click());
			await waitFor("B generation to start", () => agent.hasStarted);

			releasePost.resolve();
			await waitFor(
				"A's state refresh to capture the older B body",
				() => stateRefreshHasStarted,
			);
			agent.release.resolve();
			await waitFor("generated B text to persist and render", async () => {
				const persisted = await store.read();
				const body = persisted?.drafts.find(
					(item) => item.id === "draft-b",
				)?.body;
				return (
					body === "Body from B\n\nGenerated for B" &&
					articleB?.querySelector<HTMLTextAreaElement>(
						'textarea[aria-label="Comment draft"]',
					)?.value === body
				);
			});
			releaseStateRefresh.resolve();
			await waitFor("A refresh to finish without replacing B", () => {
				const refreshedB = container.querySelector<HTMLElement>(
					'article[data-draft-id="draft-b"]',
				);
				const postedA = container.querySelector<HTMLElement>(
					'[data-discussion-id="discussion-a"]',
				);
				return (
					refreshedB?.querySelector<HTMLTextAreaElement>(
						'textarea[aria-label="Comment draft"]',
					)?.value === "Body from B\n\nGenerated for B" &&
					postedA?.textContent?.includes("Body from A") === true
				);
			});

			const persistedStateResponse = await routes(
				new Request(`http://localhost/api/state?t=${token}`),
			);
			const persistedState = (await persistedStateResponse.json()) as {
				drafts: ReviewState["drafts"];
				discussions: HostDiscussion[];
			};
			expect(postedBodies).toEqual(["Body from A"]);
			expect(postedDiscussions).toHaveLength(1);
			expect(persistedState.discussions).toHaveLength(1);
			expect(persistedState.discussions[0]?.notes[0]?.body).toBe("Body from A");
			expect(persistedState.drafts).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: "draft-a",
						body: "Body from A",
						status: "posted",
						postedDiscussionId: "discussion-a",
					}),
					expect.objectContaining({
						id: "draft-b",
						body: "Body from B\n\nGenerated for B",
						status: "draft",
						postedDiscussionId: null,
					}),
				]),
			);
		} finally {
			releasePost.resolve();
			agent.release.resolve();
			releaseStateRefresh.resolve();
			globalThis.fetch = originalFetch;
			container.remove();
			await rm(dir, { recursive: true, force: true });
		}
	});
});
