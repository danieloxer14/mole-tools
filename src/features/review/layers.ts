import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Config } from "../../adapters/config/schema";
import { loadPrompt, type PromptName } from "../../adapters/prompts/loader";
import { logger } from "../../core/logger";
import type { GitHost, HostDiscussion, MrDetail } from "../../ports/git-host";
import type { Issue, IssueTracker } from "../../ports/issue-tracker";
import type { ReviewAgent } from "../../ports/review-agent";
import type { CommitMeta, FileDiff, Vcs } from "../../ports/vcs";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import type { MrRef } from "../../shared/mr-url";
import type { ReviewPaths } from "./paths";
import type { ReviewMergeRequest } from "./setup";
import {
	type LayerDoc,
	LayerDocSchema,
	LayerSchema,
	type ReviewState,
	ReviewStateSchema,
} from "./state";
import type { ReviewStore } from "./store";

export interface LayerFileStat {
	path: string;
	insertions: number;
	deletions: number;
	statOnly: boolean;
}

export interface LayerMergeRequest {
	description?: string;
	author?: string;
	state?: string;
	diffRefs?: {
		baseSha: string;
		startSha: string;
		headSha: string;
	};
}

export interface LayerInput {
	mr: {
		host: string;
		projectPath: string;
		iid: number;
		webUrl: string;
		title: string;
		description: string;
		author: string;
		sourceBranch: string;
		targetBranch: string;
		headSha: string;
		mergeBaseSha: string;
		diffRefs: {
			baseSha: string;
			startSha: string;
			headSha: string;
		};
	};
	commits: CommitMeta[];
	files: LayerFileStat[];
	changedFiles: string[];
	discussions: HostDiscussion[];
	jira: Issue | null;
	outputPath: string;
}

export interface ReviewJiraConfig {
	enabled?: boolean;
	branchPattern?: string;
}

export interface ReviewLayerConfig {
	layerTimeoutSeconds?: number;
	maxLayerPromptBytes?: number;
}

const DEFAULT_MAX_LAYER_PROMPT_BYTES = 100_000;
const MAX_LAYER_DESCRIPTION_CHARS = 12_000;
const MAX_LAYER_COMMIT_SUBJECT_CHARS = 1_000;
const MAX_LAYER_NOTE_CHARS = 2_000;
const MAX_LAYER_DISCUSSIONS = 20;
const MAX_LAYER_COMMITS = 200;
const MAX_LAYER_FILES = 500;
const MAX_LAYER_CHANGED_FILES = 500;

const COMPACT_CONTEXT_NOTE =
	"Context compacted to fit prompt budget; inspect the pinned worktree for complete details.";
export interface BuildLayerInputOptions {
	state: ReviewState;
	outputPath?: string;
	vcs?: Vcs;
	gitHost?: Pick<GitHost, "listDiscussions">;
	ref?: MrRef;
	getDiscussions?: () => Promise<HostDiscussion[]>;
	discussions?: HostDiscussion[];
	issues?: IssueTracker | null;
	config?:
		| (Pick<Config, "jira"> & Partial<Pick<Config, "review">>)
		| {
				jira?: ReviewJiraConfig;
				review?: ReviewLayerConfig;
		  };
	mr?: LayerMergeRequest | ReviewMergeRequest | MrDetail;
	/** Raw local diff after configured ignore filtering. */
	diff?: FileDiff[];
	/** Parsed diff is accepted for callers that already parsed the local diff. */
	parsedDiff?: ParsedFileDiff[];
	commits?: CommitMeta[];
}

export interface LayerGenerationOptions extends BuildLayerInputOptions {
	agent: ReviewAgent;
	store?: ReviewStore;
	paths?: Pick<
		ReviewPaths,
		"layersDir" | "promptDir" | "layerPath" | "promptPath"
	>;
	/** Fallback output root for callers without ReviewPaths. */
	outputDir?: string;
	/** Optional directory containing user-configurable review prompts. */
	promptSourceDir?: string;
	promptText?: string;
	runId?: string;
	onState?: (state: ReviewState) => void | Promise<void>;
	onStatus?: (status: LayerGenerationStatus) => void | Promise<void>;
}

export interface LayerGenerationStatus {
	status: ReviewState["layerStatus"];
	state: ReviewState;
	attempt?: number;
	error?: string;
}

export interface LayerGenerationResult {
	state: ReviewState;
	doc: LayerDoc | null;
	runId: string;
	attempts: number;
}

interface LayerAttemptSuccess {
	ok: true;
	doc: LayerDoc;
}

interface LayerAttemptFailure {
	ok: false;
	kind: "output" | "agent";
	error: string;
}

type LayerAttempt = LayerAttemptSuccess | LayerAttemptFailure;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function filePathSet(
	diff: FileDiff[] | undefined,
	parsedDiff: ParsedFileDiff[] | undefined,
): Set<string> {
	const paths = new Set<string>();
	for (const file of diff ?? []) {
		if (file.path) paths.add(file.path);
	}
	for (const file of parsedDiff ?? []) {
		if (file.oldPath) paths.add(file.oldPath);
		if (file.newPath) paths.add(file.newPath);
	}
	return paths;
}

function fileStats(
	diff: FileDiff[] | undefined,
	parsedDiff: ParsedFileDiff[] | undefined,
): LayerFileStat[] {
	if (diff && diff.length > 0) {
		return diff.map((file) => ({
			path: file.path,
			insertions: file.insertions,
			deletions: file.deletions,
			statOnly: file.statOnly,
		}));
	}
	return (parsedDiff ?? []).flatMap((file) => {
		const path = file.newPath ?? file.oldPath;
		return path
			? [
					{
						path,
						insertions: file.insertions,
						deletions: file.deletions,
						statOnly: file.hunks.length === 0,
					},
				]
			: [];
	});
}

function truncateText(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n[truncated]`;
}

interface CompactDiscussion {
	id: string;
	position: HostDiscussion["position"];
	notes: Array<
		Pick<
			HostDiscussion["notes"][number],
			"id" | "author" | "body" | "createdAt"
		>
	>;
}

interface CompactLayerInput {
	mr: LayerInput["mr"];
	commits: CommitMeta[];
	files: LayerFileStat[];
	changedFiles: string[];
	discussions: CompactDiscussion[];
	jira: Issue | null;
}

interface CompactLayerResult {
	value: CompactLayerInput;
	compacted: boolean;
}

function compactLayerInput(input: LayerInput): CompactLayerResult {
	const discussions = input.discussions
		.filter((discussion) => !discussion.resolved && !discussion.individualNote)
		.map((discussion) => ({
			id: discussion.id,
			position: discussion.position,
			notes: discussion.notes
				.filter((note) => !note.system)
				.map((note) => ({
					id: note.id,
					author: note.author,
					body: truncateText(note.body, MAX_LAYER_NOTE_CHARS),
					createdAt: note.createdAt,
				})),
		}))
		.filter((discussion) => discussion.notes.length > 0);
	const value: CompactLayerInput = {
		mr: {
			...input.mr,
			description: truncateText(
				input.mr.description,
				MAX_LAYER_DESCRIPTION_CHARS,
			),
		},
		commits: input.commits.slice(0, MAX_LAYER_COMMITS).map((commit) => ({
			...commit,
			subject: truncateText(commit.subject, MAX_LAYER_COMMIT_SUBJECT_CHARS),
		})),
		files: input.files.slice(0, MAX_LAYER_FILES),
		changedFiles: input.changedFiles.slice(0, MAX_LAYER_CHANGED_FILES),
		discussions: discussions.slice(0, MAX_LAYER_DISCUSSIONS),
		jira: input.jira
			? {
					...input.jira,
					description: truncateText(
						input.jira.description,
						MAX_LAYER_DESCRIPTION_CHARS,
					),
				}
			: null,
	};
	return {
		value,
		compacted:
			input.commits.length > value.commits.length ||
			input.files.length > value.files.length ||
			input.changedFiles.length > value.changedFiles.length ||
			discussions.length > value.discussions.length,
	};
}

function trimCompactLayerInput(value: CompactLayerInput): boolean {
	if (value.commits.length > 0) {
		value.commits = value.commits.slice(
			0,
			Math.floor(value.commits.length / 2),
		);
		return true;
	}
	if (value.discussions.length > 0) {
		value.discussions = value.discussions.slice(
			0,
			Math.floor(value.discussions.length / 2),
		);
		return true;
	}
	if (value.jira !== null) {
		value.jira = null;
		return true;
	}
	if (value.files.length > 0) {
		value.files = value.files.slice(0, Math.floor(value.files.length / 2));
		return true;
	}
	if (value.changedFiles.length > 0) {
		value.changedFiles = value.changedFiles.slice(
			0,
			Math.floor(value.changedFiles.length / 2),
		);
		return true;
	}
	if (value.mr.description.length > 0) {
		value.mr.description = truncateText(
			value.mr.description,
			Math.floor(value.mr.description.length / 2),
		);
		return true;
	}
	return false;
}

function maxLayerPromptBytes(config: LayerGenerationOptions["config"]): number {
	const configured = config?.review?.maxLayerPromptBytes;
	return typeof configured === "number" &&
		Number.isInteger(configured) &&
		configured > 0
		? configured
		: DEFAULT_MAX_LAYER_PROMPT_BYTES;
}

function layerPromptSizeError(
	basePrompt: string,
	message: string,
	maxBytes: number,
): string | null {
	const promptBytes = new TextEncoder().encode(
		`${basePrompt}\n${message}`,
	).byteLength;
	return promptBytes > maxBytes
		? `Layer prompt is ${promptBytes} UTF-8 bytes; configured limit is ${maxBytes} bytes`
		: null;
}

function metadata(
	state: ReviewState,
	mr: LayerMergeRequest | ReviewMergeRequest | MrDetail | undefined,
): LayerInput["mr"] {
	return {
		host: state.mr.host,
		projectPath: state.mr.projectPath,
		iid: state.mr.iid,
		webUrl: state.mr.webUrl,
		title: state.mr.title,
		description: mr && "description" in mr ? (mr.description ?? "") : "",
		author: mr && "author" in mr ? (mr.author ?? "") : "",
		sourceBranch: state.mr.sourceBranch,
		targetBranch: state.mr.targetBranch,
		headSha: state.revision.headSha,
		mergeBaseSha: state.revision.mergeBaseSha,
		diffRefs:
			mr && "diffRefs" in mr && mr.diffRefs
				? mr.diffRefs
				: state.revision.diffRefs,
	};
}

async function fetchDiscussions(
	options: BuildLayerInputOptions,
): Promise<HostDiscussion[]> {
	if (options.getDiscussions) {
		try {
			return await options.getDiscussions();
		} catch (error) {
			logger.warn("review.layers.discussions-failed", { error });
			return options.discussions ?? [];
		}
	}
	if (options.discussions) return options.discussions;
	if (options.gitHost?.listDiscussions && options.ref) {
		try {
			return await options.gitHost.listDiscussions(options.ref);
		} catch (error) {
			logger.warn("review.layers.discussions-failed", { error });
		}
	}
	return [];
}

function configuredJira(
	config: BuildLayerInputOptions["config"],
): ReviewJiraConfig | null {
	if (!config || !("jira" in config) || !config.jira) return null;
	return config.jira;
}

async function fetchJiraIssue(
	options: BuildLayerInputOptions,
	state: ReviewState,
): Promise<Issue | null> {
	const jira = configuredJira(options.config);
	if (!jira?.enabled || !options.issues) return null;
	const pattern = jira.branchPattern ?? "[A-Z]+-[0-9]+";
	let matcher: RegExp;
	try {
		matcher = new RegExp(pattern, "i");
	} catch (error) {
		logger.warn("review.layers.invalid-jira-pattern", { pattern, error });
		return null;
	}
	const branchMatch = state.mr.sourceBranch.match(matcher);
	const titleMatch = state.mr.title.match(matcher);
	const key = (branchMatch?.[0] ?? titleMatch?.[0])?.toUpperCase() ?? null;
	if (!key) return null;
	try {
		return await options.issues.fetchIssue(key);
	} catch (error) {
		logger.warn("review.layers.jira-failed", { key, error });
		return null;
	}
}

export async function buildLayerInput(
	options: BuildLayerInputOptions,
): Promise<LayerInput> {
	const commits =
		options.commits ??
		(await options.vcs?.log({
			base: options.state.revision.mergeBaseSha,
			head: options.state.revision.headSha,
			cwd: options.state.worktreePath,
		})) ??
		[];
	const files = fileStats(options.diff, options.parsedDiff);
	const changedFiles = [...filePathSet(options.diff, options.parsedDiff)];
	return {
		mr: metadata(options.state, options.mr),
		commits,
		files,
		changedFiles,
		discussions: await fetchDiscussions(options),
		jira: await fetchJiraIssue(options, options.state),
		outputPath: options.outputPath ?? "",
	};
}

function outputPaths(
	options: LayerGenerationOptions,
	runId: string,
): {
	layersDir: string;
	promptDir: string;
	layerPath: string;
	promptPath: string;
} {
	const fallback =
		options.outputDir ??
		join(dirname(options.state.worktreePath), "review-layers");
	const layersDir = options.paths?.layersDir ?? join(fallback, "layers");
	const promptDir = options.paths?.promptDir ?? join(fallback, "prompt");
	return {
		layersDir,
		promptDir,
		layerPath:
			options.paths?.layerPath?.(runId) ?? join(layersDir, `${runId}.json`),
		promptPath:
			options.paths?.promptPath?.(`${runId}-layers`) ??
			join(promptDir, `${runId}-layers.md`),
	};
}

async function notify(
	callback: LayerGenerationOptions["onStatus"],
	status: LayerGenerationStatus,
): Promise<void> {
	if (!callback) return;
	try {
		await callback(status);
	} catch {
		// Status reporting must not turn a completed layer run into a failure.
	}
}

async function persist(
	options: LayerGenerationOptions,
	state: ReviewState,
): Promise<ReviewState> {
	const validated = ReviewStateSchema.parse(state);
	const runRevision = options.state.revision;
	const sameRevision = (current: ReviewState): boolean =>
		current.revision.headSha === runRevision.headSha &&
		current.revision.mergeBaseSha === runRevision.mergeBaseSha &&
		current.revision.diffRefs.baseSha === runRevision.diffRefs.baseSha &&
		current.revision.diffRefs.startSha === runRevision.diffRefs.startSha &&
		current.revision.diffRefs.headSha === runRevision.diffRefs.headSha;
	const persisted = options.store
		? await options.store.mutate((current) => {
				// A sync may complete while an older layer agent is still running.
				// Keep the synced revision authoritative and its layers stale.
				if (current && !sameRevision(current)) return current;
				const next = {
					...(current ?? validated),
					layerStatus: validated.layerStatus,
					layerError: validated.layerError,
				};
				if (validated.layerStatus === "ready") {
					next.layers = validated.layers;
				}
				return next;
			})
		: validated;
	try {
		await options.onState?.(persisted);
	} catch {
		// A route observer cannot invalidate persisted review state.
	}
	return persisted;
}

function layerDocWithIds(
	doc: LayerDoc,
	runId: string,
	knownFiles: Set<string>,
) {
	return doc.layers
		.map((layer, index) => {
			const files = layer.files.filter((path) => {
				if (knownFiles.has(path)) return true;
				logger.warn("review.layers.unknown-file", { path });
				return false;
			});
			if (files.length === 0) return null;
			return {
				...LayerSchema.parse({ ...layer, files }),
				id: `${runId}-${index + 1}`,
				done: false,
				stale: false,
			};
		})
		.filter((layer): layer is NonNullable<typeof layer> => layer !== null);
}

function layerTimeoutSeconds(config: LayerGenerationOptions["config"]): number {
	const configured = config?.review?.layerTimeoutSeconds;
	return typeof configured === "number" &&
		Number.isFinite(configured) &&
		configured > 0
		? configured
		: 600;
}
export function reviewLayerPromptName(mode: ReviewState["mode"]): PromptName {
	return mode === "plan" ? "review-layers-plan" : "review-layers-code";
}

async function runAttempt(
	options: LayerGenerationOptions,
	message: string,
	outputPath: string,
	promptPath: string,
	writeDir: string,
): Promise<LayerAttempt> {
	await rm(outputPath, { force: true });
	const controller = new AbortController();
	const timeoutSeconds = layerTimeoutSeconds(options.config);
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let agentError: string | null = null;
	try {
		const iterable = options.agent.run({
			cwd: options.state.worktreePath,
			systemPromptFile: promptPath,
			message,
			writeDir,
			signal: controller.signal,
		});
		const iterator = iterable[Symbol.asyncIterator]();
		const consume = (async (): Promise<LayerAttemptFailure | null> => {
			try {
				while (true) {
					const result = await iterator.next();
					if (result.done) return null;
					if (result.value.kind === "error") agentError = result.value.message;
				}
			} catch (error) {
				return { ok: false, kind: "agent", error: errorMessage(error) };
			}
		})();
		const timedOut = new Promise<"timeout">((resolve) => {
			timeoutId = setTimeout(() => {
				controller.abort();
				resolve("timeout");
			}, timeoutSeconds * 1000);
		});
		const outcome = await Promise.race<LayerAttemptFailure | null | "timeout">([
			consume,
			timedOut,
		]);
		if (outcome === "timeout") {
			try {
				void Promise.resolve(iterator.return?.()).catch(() => undefined);
			} catch {
				// Iterator cleanup must not delay retryable failure persistence.
			}
			return {
				ok: false,
				kind: "agent",
				error: `Layer agent timed out after ${timeoutSeconds} seconds`,
			};
		}
		if (outcome) return outcome;
	} catch (error) {
		return { ok: false, kind: "agent", error: errorMessage(error) };
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
	if (agentError) return { ok: false, kind: "agent", error: agentError };

	const file = Bun.file(outputPath);
	if (!(await file.exists())) {
		return {
			ok: false,
			kind: "output",
			error: `Layer agent did not write output file: ${outputPath}`,
		};
	}
	let raw: unknown;
	try {
		raw = JSON.parse(await file.text());
	} catch (error) {
		return {
			ok: false,
			kind: "output",
			error: `Layer output is not valid JSON: ${errorMessage(error)}`,
		};
	}
	const parsed = LayerDocSchema.safeParse(raw);
	if (!parsed.success) {
		return {
			ok: false,
			kind: "output",
			error: `Layer output failed schema validation: ${parsed.error.message}`,
		};
	}
	return { ok: true, doc: parsed.data };
}

async function failedResult(
	options: LayerGenerationOptions,
	state: ReviewState,
	runId: string,
	attempts: number,
	error: string,
): Promise<LayerGenerationResult> {
	const failedState = await persist(options, {
		...state,
		layerStatus: "failed",
		layerError: error,
	});
	await notify(options.onStatus, {
		status: "failed",
		state: failedState,
		attempt: attempts,
		error,
	});
	return { state: failedState, doc: null, runId, attempts };
}

/** Build, validate, cache, and retry one review-layer document. */
export async function generateLayers(
	options: LayerGenerationOptions,
): Promise<LayerGenerationResult> {
	const runId = options.runId ?? crypto.randomUUID();
	const paths = outputPaths(options, runId);
	let state = ReviewStateSchema.parse(options.state);
	let attempts = 0;
	try {
		await mkdir(paths.layersDir, { recursive: true });
		await mkdir(paths.promptDir, { recursive: true });
		state = await persist(options, {
			...state,
			layerStatus: "running",
			layerError: null,
		});
		await notify(options.onStatus, { status: "running", state, attempt: 1 });
		await options.agent.preflight();

		const input = await buildLayerInput({
			...options,
			state,
			outputPath: paths.layerPath,
		});
		const promptName = reviewLayerPromptName(state.mode);
		const basePrompt =
			options.promptText ??
			(await loadPrompt(promptName, options.promptSourceDir));
		const maxPromptBytes = maxLayerPromptBytes(options.config);
		const compactedInput = compactLayerInput(input);
		let compacted = compactedInput.compacted;
		let serializedInput = JSON.stringify(compactedInput.value, null, "\t");
		const buildMessage = () =>
			[
				`Write LayerDoc JSON to this absolute path: ${paths.layerPath}`,
				"Reply with only that absolute path after writing the file.",
				"Use the compact review input below as source context.",
				"The full unified diff is not inlined. Use mr.mergeBaseSha and mr.headSha to inspect supplied changedFiles; treat the supplied changed-file list as authoritative and do not broaden scope.",
				"Inspect the worktree and changed files with read, grep, glob, and bash tools when needed.",
				"Use bash only for read-only inspection commands; never modify the worktree.",
				...(compacted ? [COMPACT_CONTEXT_NOTE] : []),
				serializedInput,
			].join("\n\n");
		let firstMessage = buildMessage();
		while (layerPromptSizeError(basePrompt, firstMessage, maxPromptBytes)) {
			if (!trimCompactLayerInput(compactedInput.value)) break;
			compacted = true;
			serializedInput = JSON.stringify(compactedInput.value, null, "\t");
			firstMessage = buildMessage();
		}
		await Bun.write(paths.promptPath, `${basePrompt}\n`);
		const promptSizeError = layerPromptSizeError(
			basePrompt,
			firstMessage,
			maxPromptBytes,
		);
		if (promptSizeError) throw new Error(promptSizeError);
		let attempt = await runAttempt(
			{ ...options, state, runId },
			firstMessage,
			paths.layerPath,
			paths.promptPath,
			paths.layersDir,
		);
		attempts = 1;
		if (!attempt.ok && attempt.kind === "output") {
			const retryMessage = `${firstMessage}\n\nPrevious output validation failed. Correct it and write a complete replacement file.\n${attempt.error}`;
			const retryPromptSizeError = layerPromptSizeError(
				basePrompt,
				retryMessage,
				maxPromptBytes,
			);
			if (retryPromptSizeError) {
				return await failedResult(
					options,
					state,
					runId,
					attempts,
					retryPromptSizeError,
				);
			}
			attempt = await runAttempt(
				{ ...options, state, runId },
				retryMessage,
				paths.layerPath,
				paths.promptPath,
				paths.layersDir,
			);
			attempts = 2;
		}
		if (!attempt.ok) {
			return await failedResult(options, state, runId, attempts, attempt.error);
		}

		const layers = layerDocWithIds(
			attempt.doc,
			runId,
			filePathSet(options.diff, options.parsedDiff),
		);
		const readyState = await persist(options, {
			...state,
			layerStatus: "ready",
			layerError: null,
			layers,
		});
		await notify(options.onStatus, {
			status: "ready",
			state: readyState,
			attempt: attempts,
		});
		return { state: readyState, doc: attempt.doc, runId, attempts };
	} catch (error) {
		return await failedResult(
			options,
			state,
			runId,
			attempts,
			errorMessage(error),
		);
	} finally {
		await rm(paths.promptPath, { force: true });
	}
}

export const runLayerGeneration = generateLayers;
export const createLayerInput = buildLayerInput;
