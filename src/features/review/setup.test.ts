import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import { getReviewPaths, type ReviewPaths } from "./paths";
import {
	type ReviewMergeRequest,
	type ReviewSetupInput,
	type ReviewSetupResult,
	resolveReviewRepo,
	reviewRemoteUrl,
	setupReview,
	syncReview,
	syncReviewMetadata,
} from "./setup";
import { LEGACY_CHAT_ID, type ReviewState, ReviewStateSchema } from "./state";
import { ReviewStore } from "./store";

class CountingReviewStore extends ReviewStore {
	writeCount = 0;

	override async write(state: ReviewState): Promise<void> {
		this.writeCount += 1;
		await super.write(state);
	}

	override async mutate(
		mutator: (
			current: ReviewState | null,
		) => ReviewState | Promise<ReviewState>,
	): Promise<ReviewState> {
		this.writeCount += 1;
		return super.mutate(mutator);
	}
}

const ref = {
	host: "gitlab.example.com",
	projectPath: "group/api",
	iid: 42,
};

function mergeRequest(): ReviewMergeRequest {
	return {
		iid: ref.iid,
		projectPath: ref.projectPath,
		title: "Improve API",
		webUrl: "https://gitlab.example.com/group/api/-/merge_requests/42",
		sourceBranch: "feature/api",
		targetBranch: "main",
		headSha: "head",
		diffRefs: {
			baseSha: "base",
			startSha: "base",
			headSha: "head",
		},
	};
}

function pathsFor(dir: string): ReviewPaths {
	return getReviewPaths(ref, join(dir, "config.json"));
}

async function runSetup(
	paths: ReviewPaths,
	overrides: Partial<ReviewSetupInput> = {},
): Promise<ReviewSetupResult> {
	return setupReview({
		vcs: new FakeVcs({
			repoRoot: paths.repoPath,
			worktrees: [],
			mergeBase: "base",
			diffRange: [],
		}),
		ref,
		mr: mergeRequest(),
		paths,
		store: new ReviewStore(paths),
		cwd: paths.repoPath,
		...overrides,
	});
}

function stateFor(
	paths: ReviewPaths,
	overrides: Partial<ReviewState> = {},
): ReviewState {
	return ReviewStateSchema.parse({
		version: 1,
		mode: "code",
		mr: {
			host: ref.host,
			projectPath: ref.projectPath,
			iid: ref.iid,
			webUrl: mergeRequest().webUrl,
			title: "Improve API",
			sourceBranch: "feature/api",
			targetBranch: "main",
		},
		revision: {
			headSha: "head",
			mergeBaseSha: "base",
			diffRefs: { baseSha: "base", startSha: "base", headSha: "head" },
			syncedAt: "2026-08-25T00:00:00.000Z",
		},
		worktreePath: paths.worktreePath,
		repoRoot: paths.repoPath,
		layerStatus: "ready",
		layerError: null,
		layers: [],
		viewedFiles: [],
		chats: [],
		activeChatId: null,
		drafts: [],
		...overrides,
	});
}

function rawDiff(path: string, patchText: string) {
	return {
		path,
		statOnly: false,
		patch: patchText,
		insertions: 1,
		deletions: 1,
	};
}

describe("setupReview chat state", () => {
	test("persists MR description and lifecycle state on first setup", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-setup-description-"));
		try {
			const paths = pathsFor(dir);
			const result = await runSetup(paths, {
				mr: { ...mergeRequest(), description: "Body", state: "merged" },
			});

			expect(result.state.mr.description).toBe("Body");
			expect(result.state.mr.state).toBe("merged");
			expect((await new ReviewStore(paths).read())?.mr.state).toBe("merged");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("refreshes MR description and lifecycle state on rerun", async () => {
		const dir = await mkdtemp(
			join(tmpdir(), "mole-review-setup-description-rerun-"),
		);
		try {
			const paths = pathsFor(dir);
			await runSetup(paths, {
				mr: { ...mergeRequest(), description: "Original", state: "opened" },
			});

			const updated = await runSetup(paths, {
				mr: { ...mergeRequest(), description: "Updated", state: "merged" },
			});
			expect(updated.state.mr.description).toBe("Updated");
			expect(updated.state.mr.state).toBe("merged");

			const cleared = await runSetup(paths);
			expect(cleared.state.mr.description).toBe("");
			expect(cleared.state.mr.state).toBeNull();
			expect((await new ReviewStore(paths).read())?.mr.state).toBeNull();

			const refreshed = await runSetup(paths, {
				mr: { ...mergeRequest(), description: "Refreshed", state: "closed" },
				refresh: true,
			});
			expect(refreshed.state.mr.description).toBe("Refreshed");
			expect(refreshed.state.mr.state).toBe("closed");

			const refreshCleared = await runSetup(paths, { refresh: true });
			expect(refreshCleared.state.mr.description).toBe("");
			expect(refreshCleared.state.mr.state).toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	test("replaces missing legacy description on setup re-run", async () => {
		const dir = await mkdtemp(
			join(tmpdir(), "mole-review-setup-legacy-description-"),
		);
		try {
			const paths = pathsFor(dir);
			await runSetup(paths);
			const legacy = JSON.parse(
				await Bun.file(paths.statePath).text(),
			) as Record<string, unknown>;
			expect((legacy.mr as Record<string, unknown>).description).toBe("");
			delete (legacy.mr as Record<string, unknown>).description;
			await Bun.write(paths.statePath, `${JSON.stringify(legacy)}\n`);

			const result = await runSetup(paths, {
				mr: { ...mergeRequest(), description: "Fresh body" },
			});

			expect(result.state.mr.description).toBe("Fresh body");
			expect((await new ReviewStore(paths).read())?.mr.description).toBe(
				"Fresh body",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("seeds one generated active chat for a new review", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-setup-new-"));
		try {
			const paths = pathsFor(dir);
			const result = await runSetup(paths);
			const persisted = JSON.parse(
				await Bun.file(paths.statePath).text(),
			) as ReviewState;

			expect(persisted.chats).toHaveLength(1);
			expect(persisted.chats[0]?.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
			expect(persisted.chats[0]?.id).not.toBe(LEGACY_CHAT_ID);
			expect(persisted.activeChatId).toBe(persisted.chats[0]?.id ?? null);
			expect(result.state.collapsedDiscussionIds).toEqual([]);
			expect(persisted.collapsedDiscussionIds).toEqual([]);
			expect(result.state.activeChatId).toBe(result.state.chats[0]?.id ?? null);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("preserves existing chats and review progress", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-setup-existing-"));
		try {
			const paths = pathsFor(dir);
			const existing = stateFor(paths, {
				layers: [
					{
						id: "layer-api",
						title: "API",
						tldr: "API layer",
						files: ["src/api.ts"],
						done: true,
						stale: false,
					},
				],
				viewedFiles: ["src/api.ts"],
				collapsedDiscussionIds: ["discussion-1"],
				chats: [
					{
						id: "chat-one",
						title: "Existing chat",
						sessionId: "provider-session",
						createdAt: "2026-08-25T00:00:00.000Z",
						agent: null,
						model: null,
						effort: null,
						kind: "review",
					},
					{
						id: "chat-two",
						title: "Another chat",
						sessionId: null,
						createdAt: "2026-08-25T00:01:00.000Z",
						agent: null,
						model: null,
						effort: null,
						kind: "review",
					},
					{
						id: "pager-chat",
						title: "One pager chat",
						sessionId: null,
						createdAt: "2026-08-25T00:02:00.000Z",
						agent: null,
						model: null,
						effort: null,
						kind: "one-pager",
					},
					{
						id: "pager-last",
						title: "Latest one pager chat",
						sessionId: null,
						createdAt: "2026-08-25T00:03:00.000Z",
						agent: null,
						model: null,
						effort: null,
						kind: "one-pager",
					},
				],
				activeChatId: "chat-two",
				activeOnePagerChatId: "pager-chat",
				drafts: [
					{
						id: "draft-1",
						body: "Please check this.",
						selection: {
							path: "src/api.ts",
							side: "new",
							startLine: 1,
							endLine: 1,
						},
						filePath: "src/api.ts",
						status: "draft",
						error: null,
						postedDiscussionId: null,
						staleSince: null,
					},
				],
			});
			const store = new ReviewStore(paths);
			await store.write(existing);

			const result = await runSetup(paths);
			const persisted = JSON.parse(
				await Bun.file(paths.statePath).text(),
			) as ReviewState;

			expect(result.state.chats).toEqual(existing.chats);
			expect(result.state.activeChatId).toBe(existing.activeChatId);
			expect(result.state.activeOnePagerChatId).toBe("pager-chat");
			expect(result.state.layers).toEqual(existing.layers);
			expect(result.state.viewedFiles).toEqual(existing.viewedFiles);
			expect(result.state.collapsedDiscussionIds).toEqual(["discussion-1"]);
			expect(result.state.drafts).toEqual(existing.drafts);
			expect(persisted.chats).toEqual(existing.chats);
			expect(persisted.activeChatId).toBe(existing.activeChatId);
			expect(persisted.activeOnePagerChatId).toBe("pager-chat");
			expect(persisted.collapsedDiscussionIds).toEqual(["discussion-1"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("updates MR metadata in either launch mode without resetting review data", async () => {
		for (const mode of ["code", "plan"] as const) {
			const dir = await mkdtemp(
				join(tmpdir(), `mole-review-metadata-${mode}-`),
			);
			try {
				const paths = pathsFor(dir);
				const existing = stateFor(paths, {
					mr: { ...stateFor(paths).mr, description: "Old description" },
					revision: {
						headSha: "persisted-head",
						mergeBaseSha: "persisted-base",
						diffRefs: {
							baseSha: "persisted-base",
							startSha: "persisted-start",
							headSha: "persisted-head",
						},
						syncedAt: "2026-08-25T00:00:00.000Z",
					},
					worktreePath: "/persisted/worktree",
					repoRoot: "/persisted/repo",
					layers: [
						{
							id: "layer-api",
							title: "API",
							tldr: "API layer",
							files: ["src/api.ts"],
							done: true,
							stale: false,
						},
					],
					viewedFiles: ["src/api.ts"],
					chats: [
						{
							id: "chat-one",
							title: "Existing chat",
							sessionId: null,
							createdAt: "2026-08-25T00:00:00.000Z",
							agent: null,
							model: null,
							effort: null,
							kind: "review",
						},
					],
					activeChatId: "chat-one",
					drafts: [
						{
							id: "draft-1",
							body: "Keep draft",
							selection: {
								path: "src/api.ts",
								side: "new",
								startLine: 1,
								endLine: 1,
							},
							filePath: "src/api.ts",
							status: "draft",
							error: null,
							postedDiscussionId: null,
							staleSince: null,
						},
					],
				});
				const store = new CountingReviewStore(paths);
				await store.write(existing);
				store.writeCount = 0;
				const validatedRef = {
					...ref,
					host: "gitlab-new.example.com",
					projectPath: "group/new-api",
				};
				const mr = {
					...mergeRequest(),
					projectPath: "group/new-api",
					webUrl:
						"https://gitlab-new.example.com/group/new-api/-/merge_requests/42",
					title: "Current title",
					description: "",
					state: "merged",
					sourceBranch: "current-source",
					targetBranch: "current-target",
				};
				const result = await setupReview({
					vcs: new FakeVcs({
						repoRoot: paths.repoPath,
						worktrees: [],
						diffRange: [],
					}),
					ref: validatedRef,
					mr,
					paths,
					store,
					mode,
				});
				const persisted = await store.read();
				expect(result.state.mr).toEqual({
					host: validatedRef.host,
					projectPath: validatedRef.projectPath,
					iid: ref.iid,
					provider: "gitlab",
					webUrl: mr.webUrl,
					title: mr.title,
					description: "",
					state: "merged",
					sourceBranch: mr.sourceBranch,
					targetBranch: mr.targetBranch,
				});
				expect(persisted?.mr).toEqual(result.state.mr);
				expect(result.state.revision).toEqual(existing.revision);
				expect(result.state.worktreePath).toBe(existing.worktreePath);
				expect(result.state.repoRoot).toBe(existing.repoRoot);
				expect(result.state.chats).toEqual(existing.chats);
				expect(result.state.activeChatId).toBe(existing.activeChatId);
				expect(result.state.drafts).toEqual(existing.drafts);
				expect(result.state.layers).toEqual(existing.layers);
				expect(result.state.viewedFiles).toEqual(existing.viewedFiles);
				expect(result.state.mode).toBe(mode);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		}
	});

	test("writes changed lifecycle metadata but not unchanged metadata", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-metadata-noop-"));
		try {
			const paths = pathsFor(dir);
			const store = new CountingReviewStore(paths);
			await store.write(stateFor(paths));
			store.writeCount = 0;
			const input = {
				vcs: new FakeVcs({
					repoRoot: paths.repoPath,
					worktrees: [],
					diffRange: [],
				}),
				ref,
				mr: { ...mergeRequest(), state: "merged" },
				paths,
				store,
			};
			const updated = await setupReview(input);
			expect(updated.state.mr.state).toBe("merged");
			expect(store.writeCount).toBe(1);

			await setupReview(input);
			expect(store.writeCount).toBe(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("persists provider for fresh GitHub and GitLab reviews", async () => {
		for (const [provider, expected] of [
			["github", "github"],
			[undefined, "gitlab"],
		] as const) {
			const dir = await mkdtemp(join(tmpdir(), "mole-review-provider-fresh-"));
			try {
				const paths = pathsFor(dir);
				const store = new ReviewStore(paths);
				const result = await runSetup(paths, {
					mr: { ...mergeRequest(), provider },
					store,
				});

				expect(result.state.mr.provider).toBe(expected);
				expect((await store.read())?.mr).toEqual(result.state.mr);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		}
	});

	test("keeps GitLab default when resuming legacy state with provider-less MR", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-provider-legacy-"));
		try {
			const paths = pathsFor(dir);
			const legacy = stateFor(paths);
			const legacyMr = { ...legacy.mr } as Record<string, unknown>;
			delete legacyMr.provider;
			await mkdir(paths.reviewDir, { recursive: true });
			await Bun.write(
				paths.statePath,
				`${JSON.stringify({ ...legacy, mr: legacyMr })}\n`,
			);

			const store = new ReviewStore(paths);
			expect((await store.read())?.mr.provider).toBe("gitlab");
			const result = await runSetup(paths, { store });
			expect(result.state.mr.provider).toBe("gitlab");
			expect((await store.read())?.mr).toEqual(result.state.mr);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("syncs provider changes and skips writes when metadata matches", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-provider-sync-"));
		try {
			const paths = pathsFor(dir);
			const store = new CountingReviewStore(paths);
			const existing = stateFor(paths);
			await store.write(existing);
			store.writeCount = 0;
			const input = {
				ref,
				mr: { ...mergeRequest(), provider: "github" as const },
				state: existing,
				store,
			};

			const updated = await syncReviewMetadata(input);
			expect(updated.mr.provider).toBe("github");
			expect(store.writeCount).toBe(1);
			expect((await store.read())?.mr).toEqual(updated.mr);

			const unchanged = await syncReviewMetadata({ ...input, state: updated });
			expect(unchanged.mr).toEqual(updated.mr);
			expect(store.writeCount).toBe(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("adopts a legacy transcript once and keeps its title", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-setup-legacy-"));
		try {
			const paths = pathsFor(dir);
			const legacyState = {
				...stateFor(paths),
				chats: [
					{
						id: LEGACY_CHAT_ID,
						title: "",
						sessionId: "old-provider-session",
						createdAt: "2026-08-25T00:00:00.000Z",
					},
				],
				activeChatId: LEGACY_CHAT_ID,
			};
			const entries = [
				{
					role: "assistant",
					text: "Earlier answer",
					tags: [],
					at: "2026-08-25T00:00:00.000Z",
					sessionId: "old-provider-session",
				},
				{
					role: "user",
					text: "  Explain\nthis   review  ",
					tags: [],
					at: "2026-08-25T00:01:00.000Z",
					sessionId: null,
				},
			];
			const rawTranscript = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
			await mkdir(paths.reviewDir, { recursive: true });
			await Bun.write(paths.statePath, `${JSON.stringify(legacyState)}\n`);
			await Bun.write(paths.chatPath, rawTranscript);

			const first = await runSetup(paths);
			const adoptedPath = paths.chatTranscriptPath(LEGACY_CHAT_ID);
			expect(await Bun.file(paths.chatPath).exists()).toBe(false);
			expect(await Bun.file(adoptedPath).text()).toBe(rawTranscript);
			expect(first.state.chats).toEqual([
				expect.objectContaining({
					id: LEGACY_CHAT_ID,
					title: "Explain this review",
					sessionId: "old-provider-session",
				}),
			]);
			const persistedAfterFirst = JSON.parse(
				await Bun.file(paths.statePath).text(),
			) as ReviewState;
			expect(persistedAfterFirst.activeChatId).toBe(LEGACY_CHAT_ID);
			expect(persistedAfterFirst.chats[0]).toMatchObject({
				id: LEGACY_CHAT_ID,
				title: "Explain this review",
				sessionId: "old-provider-session",
			});

			const adoptedTranscript = await Bun.file(adoptedPath).text();
			const second = await runSetup(paths);
			expect(await Bun.file(paths.chatPath).exists()).toBe(false);
			expect(await Bun.file(adoptedPath).text()).toBe(adoptedTranscript);
			expect(second.state.chats[0]?.title).toBe("Explain this review");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("syncReview viewed files", () => {
	test("keeps viewed files whose diff content is unchanged", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-sync-viewed-"));
		try {
			const paths = pathsFor(dir);
			const previousDiff = [
				rawDiff("src/kept.ts", "@@ -1 +1 @@\n context\n"),
				rawDiff("src/changed.ts", "@@ -1 +1 @@\n-old\n+new\n"),
				rawDiff("src/shifted.ts", "@@ -1 +1 @@\n-old\n+new\n"),
				rawDiff("src/gone.ts", "@@ -1 +1 @@\n-old\n+gone\n"),
			];
			const nextDiff = [
				rawDiff("src/kept.ts", "@@ -20 +20 @@\n context\n"),
				rawDiff("src/changed.ts", "@@ -1 +1 @@\n-old\n+updated\n"),
				rawDiff("src/shifted.ts", "@@ -40 +40 @@\n-old\n+new\n"),
			];
			const existing = stateFor(paths, {
				viewedFiles: [
					"src/kept.ts",
					"src/changed.ts",
					"src/shifted.ts",
					"src/gone.ts",
				],
			});
			const store = new ReviewStore(paths);
			await store.write(existing);

			const result = await syncReview({
				vcs: new FakeVcs({
					repoRoot: paths.repoPath,
					worktrees: [],
					mergeBase: "base-2",
					diffRange: nextDiff,
				}),
				ref,
				mr: {
					...mergeRequest(),
					headSha: "head-2",
					diffRefs: {
						baseSha: "base-2",
						startSha: "base-2",
						headSha: "head-2",
					},
				},
				state: existing,
				store,
				paths,
				previousDiff,
			});

			expect(result.state.viewedFiles).toEqual([
				"src/kept.ts",
				"src/shifted.ts",
			]);
			expect((await store.read())?.viewedFiles).toEqual([
				"src/kept.ts",
				"src/shifted.ts",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("preserves viewed files when no previous diff is supplied", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-sync-no-baseline-"));
		try {
			const paths = pathsFor(dir);
			const existing = stateFor(paths, {
				viewedFiles: ["src/kept.ts", "src/gone.ts"],
				collapsedDiscussionIds: ["discussion-not-in-current-diff"],
			});
			const store = new ReviewStore(paths);
			await store.write(existing);

			const result = await syncReview({
				vcs: new FakeVcs({
					repoRoot: paths.repoPath,
					worktrees: [],
					mergeBase: "base-2",
					diffRange: [],
				}),
				ref,
				mr: {
					...mergeRequest(),
					headSha: "head-2",
					diffRefs: {
						baseSha: "base-2",
						startSha: "base-2",
						headSha: "head-2",
					},
				},
				state: existing,
				store,
				paths,
			});

			expect(result.state.viewedFiles).toEqual(["src/kept.ts", "src/gone.ts"]);
			expect(result.state.collapsedDiscussionIds).toEqual([
				"discussion-not-in-current-diff",
			]);
			expect((await store.read())?.viewedFiles).toEqual([
				"src/kept.ts",
				"src/gone.ts",
			]);
			expect((await store.read())?.collapsedDiscussionIds).toEqual([
				"discussion-not-in-current-diff",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("syncReview MR description", () => {
	test("replaces supplied description and keeps it when the next input omits it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-sync-description-"));
		try {
			const paths = pathsFor(dir);
			const existing = stateFor(paths);
			existing.mr.description = "Original";
			const store = new ReviewStore(paths);
			await store.write(existing);

			const syncInput = {
				vcs: new FakeVcs({
					repoRoot: paths.repoPath,
					worktrees: [],
					mergeBase: "base-2",
					diffRange: [],
				}),
				ref,
				mr: {
					...mergeRequest(),
					headSha: "head-2",
					diffRefs: {
						baseSha: "base-2",
						startSha: "base-2",
						headSha: "head-2",
					},
				},
				store,
				paths,
			};

			const updated = await syncReview({
				...syncInput,
				mr: { ...syncInput.mr, description: "Updated", state: "merged" },
				state: existing,
			});
			expect(updated.state.mr.description).toBe("Updated");
			expect(updated.state.mr.state).toBe("merged");
			expect((await store.read())?.mr.state).toBe("merged");

			const cleared = await syncReview({
				...syncInput,
				state: updated.state,
			});
			expect(cleared.state.mr.description).toBe("Updated");
			expect(cleared.state.mr.state).toBeNull();
			expect((await store.read())?.mr.state).toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("syncReviewMetadata", () => {
	test("updates latest persisted metadata without changing revision or local review data", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-metadata-sync-"));
		try {
			const paths = pathsFor(dir);
			const latest = stateFor(paths, {
				mr: { ...stateFor(paths).mr, description: "Old body" },
				viewedFiles: ["src/kept.ts"],
			});
			const store = new ReviewStore(paths);
			await store.write(latest);
			const staleInput = stateFor(paths, { viewedFiles: [] });
			const updated = await syncReviewMetadata({
				ref: {
					...ref,
					host: "gitlab-new.example.com",
					projectPath: "group/new-api",
				},
				mr: {
					...mergeRequest(),
					projectPath: "group/new-api",
					webUrl:
						"https://gitlab-new.example.com/group/new-api/-/merge_requests/42",
					title: "New title",
					description: "",
					sourceBranch: "new-source",
					targetBranch: "new-target",
					author: "not persisted",
					state: "closed",
				},
				state: staleInput,
				store,
			});
			expect(updated.mr).toEqual({
				host: "gitlab-new.example.com",
				projectPath: "group/new-api",
				iid: ref.iid,
				provider: "gitlab",
				webUrl:
					"https://gitlab-new.example.com/group/new-api/-/merge_requests/42",
				title: "New title",
				description: "",
				state: "closed",
				sourceBranch: "new-source",
				targetBranch: "new-target",
			});
			expect(updated.revision).toEqual(latest.revision);
			expect(updated.worktreePath).toBe(latest.worktreePath);
			expect(updated.viewedFiles).toEqual(latest.viewedFiles);
			const reread = await store.read();
			expect(reread).toEqual(updated);
			expect(reread?.mr).not.toHaveProperty("author");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("rejects an IID mismatch like syncReview", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-metadata-iid-"));
		try {
			const paths = pathsFor(dir);
			await expect(
				syncReviewMetadata({
					ref,
					mr: { ...mergeRequest(), iid: ref.iid + 1 },
					state: stateFor(paths),
				}),
			).rejects.toThrow(
				`Merge request IID mismatch: URL has ${ref.iid}, response has ${ref.iid + 1}`,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

test("defaults new state and preserves an explicit hidden choice through sync", async () => {
	const dir = await mkdtemp(join(tmpdir(), "mole-review-whitespace-state-"));
	try {
		const paths = pathsFor(dir);
		const store = new ReviewStore(paths);
		const fresh = await runSetup(paths);
		expect(fresh.state.showWhitespaceChanges).toBe(true);

		const existing = stateFor(paths, { showWhitespaceChanges: false });
		await store.write(existing);

		const reopened = await runSetup(paths);
		expect(reopened.state.showWhitespaceChanges).toBe(false);

		const synced = await syncReview({
			vcs: new FakeVcs({
				repoRoot: paths.repoPath,
				worktrees: [],
				mergeBase: "base-2",
				diffRange: [],
			}),
			ref,
			mr: {
				...mergeRequest(),
				headSha: "head-2",
				diffRefs: {
					baseSha: "base-2",
					startSha: "base-2",
					headSha: "head-2",
				},
			},
			state: reopened.state,
			store,
			paths,
		});

		expect(synced.state.showWhitespaceChanges).toBe(false);
		const persisted = await store.read();
		expect(persisted?.showWhitespaceChanges).toBe(false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("reviewRemoteUrl", () => {
	test("builds an SSH remote so cloning doesn't require HTTPS git credentials", () => {
		expect(reviewRemoteUrl(ref)).toBe("git@gitlab.example.com:group/api.git");
	});
});

describe("resolveReviewRepo", () => {
	test("clones via SSH when no cwd or cached remote matches the MR", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-resolve-"));
		try {
			const paths = pathsFor(dir);
			const vcs = new FakeVcs({ remoteUrl: null });
			const repoPath = await resolveReviewRepo({
				vcs,
				ref,
				cwd: dir,
				paths,
			});
			expect(repoPath).toBe(paths.repoPath);
			expect(vcs.cloneCalls).toEqual([
				{
					remoteUrl: "git@gitlab.example.com:group/api.git",
					destination: paths.repoPath,
				},
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("reuses cwd when its origin matches the MR over SSH", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mole-review-resolve-cwd-"));
		try {
			const paths = pathsFor(dir);
			const vcs = new FakeVcs({
				remoteUrl: "git@gitlab.example.com:group/api.git",
			});
			const repoPath = await resolveReviewRepo({
				vcs,
				ref,
				cwd: dir,
				paths,
			});
			expect(repoPath).toBe(dir);
			expect(vcs.cloneCalls).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
