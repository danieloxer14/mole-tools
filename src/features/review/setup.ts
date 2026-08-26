import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "../../adapters/config/schema";
import { PortError } from "../../core/errors";
import type { FileDiff, Vcs } from "../../ports/vcs";
import { filterDiff } from "../../shared/diff";
import { type ParsedFileDiff, parseFileDiffs } from "../../shared/diff-parse";
import { buildPosition } from "../../shared/gitlab-position";
import type { MrRef } from "../../shared/mr-url";
import { getReviewPaths, type ReviewPaths } from "./paths";
import {
	createChatMeta,
	LEGACY_CHAT_ID,
	type ReviewState,
	ReviewStateSchema,
} from "./state";
import { ReviewStore } from "./store";

export interface ReviewDiffRefs {
	baseSha: string;
	startSha: string;
	headSha: string;
}

export interface ReviewMergeRequest {
	iid: number;
	projectPath: string;
	title: string;
	description?: string;
	webUrl: string;
	author?: string;
	sourceBranch: string;
	targetBranch: string;
	headSha: string;
	diffRefs?: ReviewDiffRefs;
	state?: string;
}

export interface ReviewFreshness {
	stale: boolean;
	headSha: string;
	newCommitCount: number;
}

export interface ReviewFreshnessInput {
	vcs: Vcs;
	state: ReviewState;
	mr: Pick<ReviewMergeRequest, "headSha">;
}
interface ReviewRevisionInput {
	vcs: Vcs;
	repoRoot: string;
	mr: Pick<ReviewMergeRequest, "headSha" | "targetBranch" | "diffRefs">;
}

interface ReviewRevision {
	mergeBaseSha: string;
	diffRefs: ReviewDiffRefs;
}

async function prepareReviewRevision(
	input: ReviewRevisionInput,
): Promise<ReviewRevision> {
	// GitLab's diff base is authoritative; local target branches may be stale.
	await input.vcs.fetchRef(input.repoRoot, "origin", input.mr.headSha);
	if (input.mr.diffRefs) {
		await input.vcs.fetchRef(
			input.repoRoot,
			"origin",
			input.mr.diffRefs.baseSha,
		);
		return {
			mergeBaseSha: input.mr.diffRefs.baseSha,
			diffRefs: input.mr.diffRefs,
		};
	}

	const mergeBaseSha = await input.vcs.mergeBase(
		input.repoRoot,
		input.mr.targetBranch,
		input.mr.headSha,
	);
	return {
		mergeBaseSha,
		diffRefs: {
			baseSha: mergeBaseSha,
			startSha: mergeBaseSha,
			headSha: input.mr.headSha,
		},
	};
}

export interface ReviewSyncInput {
	vcs: Vcs;
	ref: MrRef;
	mr: ReviewMergeRequest;
	state: ReviewState;
	store?: ReviewStore;
	paths?: ReviewPaths;
	repoRoot?: string;
	worktreePath?: string;
	config?: Pick<Config, "diff"> | { diff?: { ignore?: string[] } };
}

export interface ResolveRepoInput {
	vcs: Vcs;
	ref: MrRef;
	cwd?: string;
	paths?: ReviewPaths;
}

export interface ReviewSetupInput {
	vcs: Vcs;
	ref: MrRef;
	mr: ReviewMergeRequest;
	config?: Pick<Config, "diff"> | { diff?: { ignore?: string[] } };
	mode?: "code" | "plan";
	cwd?: string;
	paths?: ReviewPaths;
	store?: ReviewStore;
	refresh?: boolean;
}

export interface ReviewSetupResult {
	state: ReviewState;
	/** Diff after configured ignore globs; used for initial stat-only state. */
	diff: FileDiff[];
	/** Unfiltered local diff retained for explicit expansion in the UI. */
	fullDiff: FileDiff[];
	paths: ReviewPaths;
}

export function reviewRemoteUrl(ref: MrRef): string {
	return `git@${ref.host}:${ref.projectPath}.git`;
}

function normalizeRemote(remote: string): string | null {
	let trimmed = remote.trim();
	while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
	if (trimmed.endsWith(".git")) trimmed = trimmed.slice(0, -4);
	while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
	if (!trimmed) return null;

	if (trimmed.startsWith("git@")) {
		const separator = trimmed.indexOf(":", 4);
		if (separator < 0) return null;
		return `${trimmed.slice(4, separator).toLowerCase()}/${trimmed.slice(
			separator + 1,
		)}`;
	}

	try {
		const parsed = new URL(
			trimmed.includes("://") ? trimmed : `https://${trimmed}`,
		);
		return `${parsed.host.toLowerCase()}${decodeURIComponent(
			parsed.pathname,
		).replace(/\/$/, "")}`;
	} catch {
		return null;
	}
}

function remoteMatches(ref: MrRef, remote: string | null): boolean {
	if (!remote) return false;
	return normalizeRemote(remote) === normalizeRemote(reviewRemoteUrl(ref));
}

export async function resolveReviewRepo(
	input: ResolveRepoInput,
): Promise<string> {
	const cwd = input.cwd ?? process.cwd();
	const paths = input.paths ?? getReviewPaths(input.ref);
	let cwdRemote: string | null = null;
	try {
		cwdRemote = await input.vcs.remoteUrl(cwd, "origin");
	} catch {
		cwdRemote = null;
	}
	if (remoteMatches(input.ref, cwdRemote)) return cwd;

	let cachedRemote: string | null = null;
	try {
		cachedRemote = await input.vcs.remoteUrl(paths.repoPath, "origin");
	} catch {
		cachedRemote = null;
	}
	if (remoteMatches(input.ref, cachedRemote)) return paths.repoPath;

	await mkdir(dirname(paths.repoPath), { recursive: true });
	await input.vcs.cloneRepo(reviewRemoteUrl(input.ref), paths.repoPath);
	return paths.repoPath;
}
export async function compareReviewHead(
	input: ReviewFreshnessInput,
): Promise<ReviewFreshness> {
	const stale = input.mr.headSha !== input.state.revision.headSha;
	if (!stale) {
		return {
			stale: false,
			headSha: input.mr.headSha,
			newCommitCount: 0,
		};
	}

	await input.vcs.fetchRef(input.state.repoRoot, "origin", input.mr.headSha);
	let newCommitCount = 0;
	try {
		newCommitCount = (
			await input.vcs.log({
				base: input.state.revision.headSha,
				head: input.mr.headSha,
				cwd: input.state.repoRoot,
			})
		).length;
	} catch {
		// A head comparison remains useful when the local commit range is unavailable.
	}
	return { stale, headSha: input.mr.headSha, newCommitCount };
}

function draftAnchorResolves(
	draft: ReviewState["drafts"][number],
	diff: ParsedFileDiff[],
	diffRefs: ReviewDiffRefs,
): boolean {
	if (draft.filePath !== draft.selection.path) return false;
	const file = diff.find((candidate) => {
		const path =
			draft.selection.side === "new" ? candidate.newPath : candidate.oldPath;
		return path === draft.filePath;
	});
	if (!file) return false;
	try {
		buildPosition(draft.selection, file, diffRefs);
		return true;
	} catch {
		return false;
	}
}

function syncedState(
	base: ReviewState,
	input: ReviewSyncInput,
	repoRoot: string,
	worktreePath: string,
	mergeBaseSha: string,
	diffRefs: ReviewDiffRefs,
	syncedAt: string,
	parsedDiff: ParsedFileDiff[],
): ReviewState {
	// A layer guide belongs to the revision that produced it. After a sync an
	// in-flight or failed run says nothing about the new head, so it returns to
	// pending and becomes runnable again instead of pinning a dead error.
	const layerRunDiscarded =
		base.layerStatus === "running" || base.layerStatus === "failed";
	return ReviewStateSchema.parse({
		...base,
		mr: {
			...base.mr,
			host: input.ref.host,
			projectPath: input.ref.projectPath,
			iid: input.mr.iid,
			webUrl: input.mr.webUrl,
			title: input.mr.title,
			sourceBranch: input.mr.sourceBranch,
			targetBranch: input.mr.targetBranch,
		},
		revision: {
			headSha: input.mr.headSha,
			mergeBaseSha,
			diffRefs,
			syncedAt,
		},
		worktreePath,
		repoRoot,
		layerStatus: layerRunDiscarded ? "pending" : base.layerStatus,
		layerError: layerRunDiscarded ? null : base.layerError,
		layers: base.layers.map((layer) => ({ ...layer, stale: true })),
		drafts: base.drafts.map((draft) =>
			draftAnchorResolves(draft, parsedDiff, diffRefs)
				? { ...draft }
				: { ...draft, staleSince: draft.staleSince ?? syncedAt },
		),
	});
}

export async function syncReview(
	input: ReviewSyncInput,
): Promise<ReviewSetupResult> {
	if (input.ref.iid !== input.mr.iid) {
		throw new PortError(
			`Merge request IID mismatch: URL has ${input.ref.iid}, response has ${input.mr.iid}`,
		);
	}
	const paths = input.paths ?? getReviewPaths(input.ref);
	const repoRoot = input.repoRoot ?? input.state.repoRoot;
	const worktreePath = input.worktreePath ?? input.state.worktreePath;
	const { mergeBaseSha, diffRefs } = await prepareReviewRevision({
		vcs: input.vcs,
		repoRoot,
		mr: input.mr,
	});
	const existingWorktrees = await input.vcs.worktrees(repoRoot).catch(() => []);
	if (existingWorktrees.some((worktree) => worktree.path === worktreePath)) {
		await input.vcs.forceRemoveWorktree(worktreePath, repoRoot);
	}
	await mkdir(dirname(worktreePath), { recursive: true });
	await input.vcs.addWorktree({
		repoRoot,
		path: worktreePath,
		sha: input.mr.headSha,
	});
	const fullDiff = await input.vcs.diffRange(
		repoRoot,
		mergeBaseSha,
		input.mr.headSha,
	);
	const diff = filterDiff(fullDiff, input.config?.diff?.ignore ?? []);
	const parsedDiff = parseFileDiffs(fullDiff);

	const syncedAt = new Date().toISOString();
	const apply = (base: ReviewState): ReviewState =>
		syncedState(
			base,
			input,
			repoRoot,
			worktreePath,
			mergeBaseSha,
			diffRefs,
			syncedAt,
			parsedDiff,
		);
	const state = input.store
		? await input.store.mutate((current) => apply(current ?? input.state))
		: apply(input.state);
	return { state, diff, fullDiff, paths };
}

export async function setupReview(
	input: ReviewSetupInput,
): Promise<ReviewSetupResult> {
	if (input.ref.iid !== input.mr.iid) {
		throw new PortError(
			`Merge request IID mismatch: URL has ${input.ref.iid}, response has ${input.mr.iid}`,
		);
	}
	const paths = input.paths ?? getReviewPaths(input.ref);
	const store = input.store ?? new ReviewStore(paths);
	let previous = await store.read();

	// Move any pre-multi-chat transcript into its per-chat directory and give
	// the adopted conversation a readable title.
	const adoptedTitle = previous?.chats.some(
		(chat) => chat.id === LEGACY_CHAT_ID,
	)
		? await store.adoptLegacyChat()
		: null;
	if (previous && adoptedTitle !== null) {
		previous = {
			...previous,
			chats: previous.chats.map((chat) =>
				chat.id === LEGACY_CHAT_ID && chat.title === "" && adoptedTitle
					? { ...chat, title: adoptedTitle }
					: chat,
			),
		};
		await store.write(previous);
	}
	const mode = input.mode ?? previous?.mode ?? "code";
	const modeChanged = previous !== null && previous.mode !== mode;

	// An existing review remains anchored to its persisted revision until the
	// caller explicitly requests a refresh. This keeps the browser's refresh
	// endpoint able to report drift before any state or worktree mutation.
	if (previous && !input.refresh) {
		const fullDiff = await input.vcs.diffRange(
			previous.repoRoot,
			previous.revision.mergeBaseSha,
			previous.revision.headSha,
		);
		const diff = filterDiff(fullDiff, input.config?.diff?.ignore ?? []);
		if (!modeChanged) return { state: previous, diff, fullDiff, paths };

		const state = ReviewStateSchema.parse({
			...previous,
			mode,
			layerStatus: "pending",
			layerError: null,
			layers: [],
		});
		await store.write(state);
		return { state, diff, fullDiff, paths };
	}

	const repoRoot =
		previous && input.refresh && !modeChanged
			? previous.repoRoot
			: await resolveReviewRepo({
					vcs: input.vcs,
					ref: input.ref,
					cwd: input.cwd,
					paths,
				});

	if (input.refresh && previous && !modeChanged) {
		return syncReview({
			vcs: input.vcs,
			ref: input.ref,
			mr: input.mr,
			state: previous,
			store,
			paths,
			repoRoot,
			worktreePath: previous.worktreePath,
			config: input.config,
		});
	}

	const { mergeBaseSha, diffRefs } = await prepareReviewRevision({
		vcs: input.vcs,
		repoRoot,
		mr: input.mr,
	});
	await mkdir(dirname(paths.worktreePath), { recursive: true });
	const existingWorktrees = await input.vcs.worktrees(repoRoot).catch(() => []);
	if (
		!existingWorktrees.some((worktree) => worktree.path === paths.worktreePath)
	) {
		await input.vcs.addWorktree({
			repoRoot,
			path: paths.worktreePath,
			sha: input.mr.headSha,
		});
	}
	const fullDiff = await input.vcs.diffRange(
		repoRoot,
		mergeBaseSha,
		input.mr.headSha,
	);
	const diff = filterDiff(fullDiff, input.config?.diff?.ignore ?? []);
	const chats = previous?.chats.length
		? previous.chats.map((chat) =>
				chat.id === LEGACY_CHAT_ID && chat.title === "" && adoptedTitle
					? { ...chat, title: adoptedTitle }
					: chat,
			)
		: [createChatMeta()];
	const state = ReviewStateSchema.parse({
		version: 1,
		mode,
		mr: {
			host: input.ref.host,
			projectPath: input.ref.projectPath,
			iid: input.mr.iid,
			webUrl: input.mr.webUrl,
			title: input.mr.title,
			sourceBranch: input.mr.sourceBranch,
			targetBranch: input.mr.targetBranch,
		},
		revision: {
			headSha: input.mr.headSha,
			mergeBaseSha,
			diffRefs,
			syncedAt: new Date().toISOString(),
		},
		worktreePath: paths.worktreePath,
		repoRoot,
		layerStatus: modeChanged ? "pending" : (previous?.layerStatus ?? "pending"),
		layerError: modeChanged ? null : (previous?.layerError ?? null),
		layers: modeChanged ? [] : (previous?.layers ?? []),
		viewedFiles: previous?.viewedFiles ?? [],
		chatSessionId: null,
		chats,
		activeChatId: previous ? previous.activeChatId : (chats[0]?.id ?? null),
		drafts: previous?.drafts ?? [],
	});

	await store.write(state);
	return { state, diff, fullDiff, paths };
}

export const setupReviewWorktree = setupReview;
