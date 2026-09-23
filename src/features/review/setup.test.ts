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
} from "./setup";
import { LEGACY_CHAT_ID, type ReviewState, ReviewStateSchema } from "./state";
import { ReviewStore } from "./store";

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
			expect(persisted.activeChatId).toBe(persisted.chats[0]?.id);
			expect(result.state.activeChatId).toBe(persisted.chats[0]?.id);
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
				chats: [
					{
						id: "chat-one",
						title: "Existing chat",
						sessionId: "provider-session",
						createdAt: "2026-08-25T00:00:00.000Z",
					},
					{
						id: "chat-two",
						title: "Another chat",
						sessionId: null,
						createdAt: "2026-08-25T00:01:00.000Z",
					},
				],
				activeChatId: "chat-two",
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
			expect(result.state.layers).toEqual(existing.layers);
			expect(result.state.viewedFiles).toEqual(existing.viewedFiles);
			expect(result.state.drafts).toEqual(existing.drafts);
			expect(persisted.chats).toEqual(existing.chats);
			expect(persisted.activeChatId).toBe(existing.activeChatId);
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
			expect((await store.read())?.viewedFiles).toEqual([
				"src/kept.ts",
				"src/gone.ts",
			]);
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
