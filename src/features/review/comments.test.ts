import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostDiscussion } from "../../ports/git-host";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import { createReviewRoutes } from "./routes";
import { DraftSchema, type ReviewState, ReviewStateSchema } from "./state";
import { ReviewStore } from "./store";

const token = "comment-test-token";
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

function state(drafts: ReviewState["drafts"] = []): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: "gitlab.example.com",
			projectPath: "group/project",
			iid: 42,
			webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
			title: "Comments",
			sourceBranch: "feature",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "start", headSha: "head" },
			syncedAt: "2026-01-01T00:00:00.000Z",
		},
		worktreePath: "/tmp/review-worktree",
		repoRoot: "/tmp/review-repo",
		layerStatus: "ready",
		layerError: null,
		layers: [],
		viewedFiles: [],
		drafts,
	});
}

function request(path: string, init?: RequestInit): Request {
	return new Request(`http://127.0.0.1${path}`, init);
}

function jsonRequest(path: string, method: string, body: unknown): Request {
	return request(path, {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function discussion(id = "discussion-1"): HostDiscussion {
	return {
		id,
		resolved: false,
		position: {
			newPath: "src/app.ts",
			oldPath: "src/app.ts",
			newLine: 2,
			oldLine: null,
		},
		notes: [],
	};
}

describe("comment drafts", () => {
	test("creates a blank local draft, then persists edits and cancellation", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-comments-route-"));
		try {
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
			});
			await store.write(state());
			const routes = createReviewRoutes({ token, store });

			const created = await routes(
				jsonRequest(`/api/comments/draft?t=${token}`, "POST", {
					selection,
					filePath: selection.path,
				}),
			);
			expect(created.status).toBe(201);
			const draft = (await created.json()) as ReviewState["drafts"][number];
			expect(draft).toMatchObject({
				body: "",
				selection,
				filePath: selection.path,
				status: "draft",
				error: null,
			});

			const persisted = (await store.read())?.drafts[0];
			expect(persisted).toEqual(draft);
			if (!persisted) throw new Error("draft was not persisted");

			const edited = await routes(
				jsonRequest(`/api/comments/${persisted.id}?t=${token}`, "PUT", {
					body: "Edited comment",
				}),
			);
			const editedDraft = DraftSchema.parse(await edited.json());
			expect(editedDraft.body).toBe("Edited comment");

			const deleted = await routes(
				request(`/api/comments/${persisted.id}?t=${token}`, {
					method: "DELETE",
				}),
			);
			expect(deleted.status).toBe(204);
			expect((await store.read())?.drafts).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("validates current position, posts, refreshes, and retains failed drafts", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-comments-send-"));
		try {
			const baseDraft = {
				id: "draft-send",
				body: "Please fix this.",
				selection,
				filePath: selection.path,
				status: "draft" as const,
				error: null,
				postedDiscussionId: null,
				staleSince: null,
			};
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
			});
			await store.write(state([baseDraft]));
			let created = 0;
			let refreshed = 0;
			const host = {
				createDiscussion: async (input: unknown) => {
					created++;
					expect(input).toMatchObject({ body: "Please fix this." });
					return discussion();
				},
				listDiscussions: async () => {
					refreshed++;
					return [discussion()];
				},
			};
			const routes = createReviewRoutes({
				token,
				store,
				diff,
				gitHost: host,
			});
			const sent = await routes(
				request(`/api/comments/${baseDraft.id}/send?t=${token}`, {
					method: "POST",
				}),
			);
			expect(sent.status).toBe(200);
			expect(created).toBe(1);
			expect(refreshed).toBe(1);
			expect((await store.read())?.drafts[0]).toMatchObject({
				status: "posted",
				postedDiscussionId: "discussion-1",
			});

			const failingStore = new ReviewStore({
				statePath: join(dir, "failed-review.json"),
				chatPath: join(dir, "failed-chat.ndjson"),
			});
			await failingStore.write(state([baseDraft]));
			const failingRoutes = createReviewRoutes({
				token,
				store: failingStore,
				diff,
				gitHost: {
					createDiscussion: async () => {
						throw new Error("glab unauthenticated");
					},
				},
			});
			const failed = await failingRoutes(
				request(`/api/comments/${baseDraft.id}/send?t=${token}`, {
					method: "POST",
				}),
			);
			expect(failed.status).toBe(502);
			expect((await failingStore.read())?.drafts[0]).toMatchObject({
				body: "Please fix this.",
				status: "failed",
				error: "glab unauthenticated",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("creates a markdown-block draft and posts it as an unpositioned general note", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-comments-markdown-"));
		try {
			const markdownSelection = {
				kind: "markdown" as const,
				path: "README.md",
				startLine: 3,
				endLine: 5,
				quote: "## Section\n\nBody text.",
			};
			const store = new ReviewStore({
				statePath: join(dir, "review.json"),
				chatPath: join(dir, "chat.ndjson"),
			});
			await store.write(state());
			const routes = createReviewRoutes({ token, store });

			const created = await routes(
				jsonRequest(`/api/comments/draft?t=${token}`, "POST", {
					selection: markdownSelection,
					filePath: markdownSelection.path,
				}),
			);
			expect(created.status).toBe(201);
			const draft = DraftSchema.parse(await created.json());
			expect(draft.selection).toEqual(markdownSelection);

			const edited = await routes(
				jsonRequest(`/api/comments/${draft.id}?t=${token}`, "PUT", {
					body: "Please fix this section.",
				}),
			);
			expect(edited.status).toBe(200);

			let sendCount = 0;
			let capturedInput: unknown;
			const routesWithHost = createReviewRoutes({
				token,
				store,
				gitHost: {
					createDiscussion: async (input: unknown) => {
						sendCount++;
						capturedInput = input;
						return discussion("discussion-markdown-1");
					},
				},
			});
			const sent = await routesWithHost(
				request(`/api/comments/${draft.id}/send?t=${token}`, {
					method: "POST",
				}),
			);
			expect(sent.status).toBe(200);
			expect(sendCount).toBe(1);
			expect(capturedInput).not.toHaveProperty("position");
			if (
				!capturedInput ||
				typeof capturedInput !== "object" ||
				!("body" in capturedInput) ||
				typeof capturedInput.body !== "string"
			) {
				throw new Error("createDiscussion was not called with a body");
			}
			const { body } = capturedInput;
			expect(body).toContain("README.md");
			expect(body).toContain("3-5");
			expect(body).toContain("Body text.");
			expect(body).toContain("Please fix this section.");
			expect((await store.read())?.drafts[0]).toMatchObject({
				status: "posted",
				postedDiscussionId: "discussion-markdown-1",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
