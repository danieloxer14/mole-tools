import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../../adapters/config/schema";
import {
	DEFAULT_PROMPTS,
	PROMPT_NAMES,
	PresetNameSchema,
	type PromptName,
	PromptNameSchema,
} from "../../adapters/prompts/defaults";
import {
	listPresets,
	listVersions,
	loadPrompt,
	promptsDir,
	readPrompt,
	savePrompt,
} from "../../adapters/prompts/loader";
import { PortError } from "../../core/errors";
import type {
	CreateDiscussionInput,
	GitHost,
	GitLabPositionPayload,
	HostDiscussion,
	MrApprovalState,
} from "../../ports/git-host";
import type { IssueTracker } from "../../ports/issue-tracker";
import type { AgentEvent, ReviewAgent } from "../../ports/review-agent";
import type { FileDiff, Vcs } from "../../ports/vcs";
import { filterDiff } from "../../shared/diff";
import { type ParsedFileDiff, parseFileDiffs } from "../../shared/diff-parse";
import { buildPosition } from "../../shared/gitlab-position";
import type { MrRef } from "../../shared/mr-url";
import { runChatTurn, validateChatTags } from "./chat";
import type { ChatTag } from "./chat-tags";
import { buildExplainMessage, explainChatTitle } from "./explain";
import {
	generateLayers,
	type LayerGenerationResult,
	type LayerMergeRequest,
	type ReviewLayerConfig,
	reviewLayerPromptName,
} from "./layers";
import type { ReviewPaths } from "./paths";
import {
	compareReviewHead,
	type ReviewMergeRequest,
	syncReview,
} from "./setup";
import { type SseFrame, sseResponse } from "./sse";
import {
	CHAT_ID_PATTERN,
	type ChatMeta,
	createChatMeta,
	type Draft,
	type DraftSelection,
	DraftSelectionSchema,
	deriveChatTitle,
	isMarkdownSelection,
	type MarkdownSelection,
	type ReviewState,
	ReviewStateSchema,
} from "./state";
import type { ReviewStore } from "./store";

const DEFAULT_LARGE_FILE_LINE_THRESHOLD = 800;

export type ReviewFileSide = "new" | "old";

export interface ReviewFileRequest {
	path: string;
	side: ReviewFileSide;
	revision: string;
}

export interface ReviewRoutesOptions {
	token: string;
	state?: ReviewState;
	store?: ReviewStore;
	paths?: Pick<
		ReviewPaths,
		"layersDir" | "promptDir" | "layerPath" | "promptPath"
	>;
	discussions?: HostDiscussion[];
	diff?: ParsedFileDiff[];
	layerDiff?: FileDiff[];
	expandedDiff?: ParsedFileDiff[];
	getDiscussions?: () => Promise<HostDiscussion[]>;
	ref?: MrRef;
	fetchMr?: (ref: MrRef) => Promise<ReviewMergeRequest>;
	gitHost?: Partial<
		Pick<
			GitHost,
			| "fetchMr"
			| "createDiscussion"
			| "listDiscussions"
			| "fetchApprovalState"
			| "approveMr"
			| "unapproveMr"
		>
	>;
	getFileContents?: (request: ReviewFileRequest) => Promise<string | null>;
	worktreePath?: string;
	largeFileLineThreshold?: number;
	reviewAgent?: ReviewAgent;
	layerAgent?: ReviewAgent;
	vcs?: Vcs;
	issues?: IssueTracker | null;
	config?:
		| (Pick<Config, "jira"> &
				Partial<Pick<Config, "review" | "prompts" | "diff">>)
		| {
				diff?: { ignore?: string[] };
				jira?: { enabled?: boolean; branchPattern?: string };
				review?: ReviewLayerConfig & {
					largeFileLineThreshold?: number;
					agent?: "omp" | "claude";
					model?: string;
				};
				prompts?: Record<string, string>;
		  };
	mr?: LayerMergeRequest;
	promptSourceDir?: string;
	promptText?: string;
	explainPromptText?: string;
	persistConfig?: (partial: Partial<Config>) => Promise<void>;
	createReviewAgent?: (override?: {
		agent?: "omp" | "claude";
		model?: string;
	}) => ReviewAgent;
}

export interface ReviewApiState extends ReviewState {
	diff: ParsedFileDiff[];
	discussions: HostDiscussion[];
	approval: MrApprovalState | null;
	largeFileLineThreshold: number;
	/** Chats with a turn running on the server right now. */
	busyChatIds: string[];
}
interface DisplayDiffVariants {
	display: ParsedFileDiff[];
	full: ParsedFileDiff[];
}

/** State changed by the lightweight progress endpoint. */
export type ReviewProgressResponse = Pick<
	ReviewApiState,
	"layers" | "viewedFiles"
>;

export type ReviewRouteHandler = (request: Request) => Promise<Response>;

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

function emptyResponse(status: number): Response {
	return new Response(null, { status });
}

function hasToken(request: Request, token: string): boolean {
	const url = new URL(request.url);
	return (
		url.searchParams.get("t") === token ||
		request.headers.get("x-mole-token") === token
	);
}

async function parseBody(
	request: Request,
): Promise<Record<string, unknown> | null> {
	try {
		const value: unknown = await request.json();
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function isPathInside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return (
		rel !== "" &&
		rel !== ".." &&
		!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
		!isAbsolute(rel)
	);
}

function validateReviewPath(root: string, requestedPath: string): string {
	if (
		!requestedPath ||
		requestedPath.includes("\0") ||
		isAbsolute(requestedPath)
	) {
		throw new Error("Invalid file path");
	}
	const candidate = resolve(root, requestedPath);
	if (!isPathInside(root, candidate))
		throw new Error("File path escapes worktree");
	return candidate;
}

async function ensureReviewPathInside(
	root: string,
	candidate: string,
): Promise<void> {
	try {
		const resolved = await realpath(candidate);
		if (!isPathInside(root, resolved))
			throw new Error("File path escapes worktree");
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	let parent = dirname(candidate);
	while (true) {
		try {
			const resolved = await realpath(parent);
			if (resolved !== root && !isPathInside(root, resolved))
				throw new Error("File path escapes worktree");
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const next = dirname(parent);
			if (next === parent) throw error;
			parent = next;
		}
	}
}

/** Resolve a browser-supplied path without allowing traversal outside worktree. */
export async function resolveReviewFilePath(
	worktreePath: string,
	requestedPath: string,
): Promise<string> {
	const root = await realpath(worktreePath);
	const candidate = validateReviewPath(root, requestedPath);
	const resolved = await realpath(candidate);
	if (!isPathInside(root, resolved))
		throw new Error("File path escapes worktree");
	return resolved;
}

function countLines(file: ParsedFileDiff): number {
	return file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

export function isLargeDiff(file: ParsedFileDiff, threshold: number): boolean {
	return countLines(file) > threshold;
}

interface ChatRequestPayload {
	chatId: string;
	message: string;
	tags: ChatTag[];
	openFile: string | null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function promptErrorResponse(error: unknown): Response {
	if (error instanceof PortError || error instanceof z.ZodError) {
		return jsonResponse({ error: errorMessage(error) }, 400);
	}
	return jsonResponse({ error: errorMessage(error) }, 500);
}

function sameRevision(
	left: ReviewState["revision"],
	right: ReviewState["revision"],
): boolean {
	return (
		left.headSha === right.headSha &&
		left.mergeBaseSha === right.mergeBaseSha &&
		left.diffRefs.baseSha === right.diffRefs.baseSha &&
		left.diffRefs.startSha === right.diffRefs.startSha &&
		left.diffRefs.headSha === right.diffRefs.headSha
	);
}
function validateChatRequest(
	body: Record<string, unknown> | null,
): ChatRequestPayload | string {
	if (!body) return "Expected a JSON object";

	if (typeof body.chatId !== "string" || !CHAT_ID_PATTERN.test(body.chatId)) {
		return "Chat id is invalid";
	}

	if (typeof body.message !== "string" || body.message.trim().length === 0) {
		return "Chat message must not be empty";
	}

	let tags: ChatTag[];
	try {
		tags = validateChatTags(body.tags === undefined ? [] : body.tags);
	} catch (error) {
		return errorMessage(error);
	}

	let openFile: string | null = null;
	if (body.openFile !== undefined && body.openFile !== null) {
		if (typeof body.openFile !== "string")
			return "Current file must be a string";
		if (body.openFile.includes("\0")) return "Current file contains a NUL byte";
		if (body.openFile.length > 0) openFile = body.openFile;
	}

	return { chatId: body.chatId, message: body.message, tags, openFile };
}

interface ExplainRequestPayload {
	discussionId: string;
}

function validateExplainRequest(
	body: Record<string, unknown> | null,
): ExplainRequestPayload | string {
	if (!body) return "Expected a JSON object";
	if (
		typeof body.discussionId !== "string" ||
		body.discussionId.trim().length === 0
	) {
		return "Discussion id is invalid";
	}
	return { discussionId: body.discussionId };
}

function chatEventFrame(event: AgentEvent): SseFrame | null {
	switch (event.kind) {
		case "text":
			return { event: "text", data: { text: event.delta } };
		case "tool":
			return {
				event: "tool",
				data: { name: event.name, phase: event.phase },
			};
		case "error":
			return { event: "error", data: { message: event.message } };
		case "diagnostic":
			return {
				event: "error",
				data: {
					code: event.code,
					eventType: event.eventType,
					message: event.message,
				},
			};
		case "session":
		case "turn_end":
			return null;
	}
	return null;
}

function chatErrorStream(message: string): Response {
	async function* frames(): AsyncIterable<SseFrame> {
		yield { event: "error", data: { message } };
	}
	return sseResponse(frames());
}

function sseResponseWithStatus(
	source: AsyncIterable<SseFrame>,
	status: number,
): Response {
	const response = sseResponse(source);
	if (response.status === status) return response;
	return new Response(response.body, {
		status,
		headers: response.headers,
	});
}

function commentSseResponse(
	status: number,
	frames: readonly SseFrame[],
): Response {
	async function* source(): AsyncIterable<SseFrame> {
		for (const frame of frames) yield frame;
	}
	return sseResponseWithStatus(source(), status);
}

function commentSseError(message: string, status: number): Response {
	return commentSseResponse(status, [
		{ event: "error", data: { message } },
		{ event: "done", data: { status: "failed", error: message } },
	]);
}

interface CommentDraftRequestPayload {
	selection: DraftSelection;
	filePath: string;
}

function validateCommentDraftRequest(
	body: Record<string, unknown> | null,
): CommentDraftRequestPayload | string {
	if (!body) return "Expected a JSON object";
	const selection = DraftSelectionSchema.safeParse(body.selection);
	if (!selection.success)
		return `Invalid comment selection: ${selection.error.message}`;
	if (selection.data.endLine < selection.data.startLine)
		return "Comment selection range is reversed";
	if (typeof body.filePath !== "string" || body.filePath.length === 0)
		return "Comment file path must not be empty";
	if (body.filePath.includes("\0"))
		return "Comment file path contains a NUL byte";
	if (body.filePath !== selection.data.path)
		return "Comment file path must match selection path";
	return {
		selection: selection.data,
		filePath: body.filePath,
	};
}

interface SseFrameQueue {
	push(frame: SseFrame): void;
	close(): void;
	frames(): AsyncIterable<SseFrame>;
}

function createSseFrameQueue(): SseFrameQueue {
	const pending: SseFrame[] = [];
	let closed = false;
	let wake: (() => void) | null = null;

	function push(frame: SseFrame): void {
		if (closed) return;
		pending.push(frame);
		wake?.();
		wake = null;
	}

	function close(): void {
		closed = true;
		wake?.();
		wake = null;
	}

	async function* frames(): AsyncIterable<SseFrame> {
		while (true) {
			const frame = pending.shift();
			if (frame) {
				yield frame;
				continue;
			}
			if (closed) return;
			await new Promise<void>((resolve) => {
				wake = resolve;
			});
		}
	}

	return { push, close, frames };
}

export function createReviewRoutes(
	options: ReviewRoutesOptions,
): ReviewRouteHandler {
	let fallbackState = options.state
		? ReviewStateSchema.parse(options.state)
		: null;
	let currentDiff = options.diff ?? [];
	let hiddenSnapshot: {
		key: string;
		promise: Promise<DisplayDiffVariants>;
	} | null = null;
	let displayMutationQueue = Promise.resolve();
	function serializeDisplayMutation<T>(
		operation: () => Promise<T>,
	): Promise<T> {
		const run = displayMutationQueue.then(operation, operation);
		displayMutationQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
	let currentLayerDiff = options.layerDiff;
	let currentExpandedDiff = options.expandedDiff;
	let currentMr = options.mr;
	let initialLayerRunAllowed = true;
	let fallbackDiscussions = [...(options.discussions ?? [])];
	const threshold =
		options.largeFileLineThreshold ??
		options.config?.review?.largeFileLineThreshold ??
		DEFAULT_LARGE_FILE_LINE_THRESHOLD;

	const settings = {
		prompts: {
			...((
				options.config as
					| { prompts?: Partial<Record<PromptName, string>> }
					| undefined
			)?.prompts ?? {}),
		} as Partial<Record<PromptName, string>>,
		review: {
			agent:
				(
					options.config as
						| { review?: { agent?: "omp" | "claude" } }
						| undefined
				)?.review?.agent ?? "claude",
			model: (options.config as { review?: { model?: string } } | undefined)
				?.review?.model,
		},
	};
	let layerAgent = options.layerAgent ?? options.reviewAgent;
	let chatAgent = options.reviewAgent;
	function presetFor(slot: PromptName): string {
		return settings.prompts[slot] ?? "default";
	}

	function promptDirOption(): string {
		return options.promptSourceDir ?? promptsDir();
	}

	function parseSlot(value: string): PromptName | null {
		const parsed = PromptNameSchema.safeParse(value);
		return parsed.success ? parsed.data : null;
	}

	async function latestVersion(
		slot: PromptName,
		preset: string,
	): Promise<number> {
		const versions = await listVersions(slot, preset, promptDirOption());
		return versions.at(-1) ?? 1;
	}

	async function settingsSnapshot(): Promise<Response> {
		try {
			const slots = await Promise.all(
				PROMPT_NAMES.map(async (slot) => {
					const activePreset = settings.prompts[slot] ?? "default";
					const presets = await listPresets(slot, promptDirOption());
					return {
						slot,
						activePreset,
						presets: await Promise.all(
							presets.map(async (name) => ({
								name,
								latest: await latestVersion(slot, name),
							})),
						),
					};
				}),
			);
			return jsonResponse({
				slots,
				review: {
					agent: settings.review.agent,
					model: settings.review.model,
					agents: ["omp", "claude"],
				},
			});
		} catch (error) {
			return promptErrorResponse(error);
		}
	}

	async function updateReviewSettings(request: Request): Promise<Response> {
		const factory = options.createReviewAgent;
		if (!factory)
			return jsonResponse(
				{ error: "Review agent selection is unavailable" },
				501,
			);

		const parsed = z
			.object({
				agent: z.enum(["omp", "claude"]),
				model: z.string().optional(),
			})
			.safeParse(await parseBody(request));
		if (!parsed.success)
			return jsonResponse({ error: parsed.error.message }, 400);

		const model = parsed.data.model?.trim() || undefined;
		settings.review = { agent: parsed.data.agent, model };

		const { model: _existingModel, ...existingReview } =
			options.config?.review ?? {};
		const review = {
			...existingReview,
			agent: parsed.data.agent,
			...(model === undefined ? {} : { model }),
		};
		await options.persistConfig?.({ review: review as Config["review"] });

		const next = factory({ agent: parsed.data.agent, model });
		layerAgent = next;
		chatAgent = next;
		return jsonResponse({ agent: parsed.data.agent, model });
	}

	async function promptRead(url: URL, slot: PromptName): Promise<Response> {
		try {
			const preset =
				url.searchParams.get("preset") ?? settings.prompts[slot] ?? "default";
			PresetNameSchema.parse(preset);

			const rawRevision = url.searchParams.get("rev");
			let version: number | undefined;
			if (rawRevision !== null) {
				if (!/^[1-9]\d*$/.test(rawRevision)) {
					throw new PortError("Invalid prompt revision");
				}
				version = Number(rawRevision);
				if (!Number.isSafeInteger(version)) {
					throw new PortError("Invalid prompt revision");
				}
			}

			const prompt = await readPrompt(slot, {
				preset,
				version,
				dir: promptDirOption(),
			});
			const versions = await listVersions(slot, preset, promptDirOption());
			return jsonResponse({
				text: prompt.text,
				preset: prompt.preset,
				version: prompt.version,
				versions,
			});
		} catch (error) {
			return promptErrorResponse(error);
		}
	}

	async function promptSave(
		request: Request,
		slot: PromptName,
	): Promise<Response> {
		try {
			const body = await parseBody(request);
			if (!body) throw new PortError("Expected a JSON object");
			if (typeof body.text !== "string")
				throw new PortError("Prompt text must be a string");

			const presetValue =
				body.preset === undefined ? presetFor(slot) : body.preset;
			if (typeof presetValue !== "string" || presetValue.length === 0)
				throw new PortError("Prompt preset must be a non-empty string");
			const preset = PresetNameSchema.parse(presetValue);
			const latest = await readPrompt(slot, {
				preset,
				dir: promptDirOption(),
			});
			if (body.text.trim() === latest.text.trim())
				return jsonResponse({ version: latest.version, saved: false });

			const version = await savePrompt(slot, {
				preset,
				text: body.text,
				dir: promptDirOption(),
			});
			return jsonResponse({ version, saved: true });
		} catch (error) {
			return promptErrorResponse(error);
		}
	}

	async function promptCreatePreset(
		request: Request,
		slot: PromptName,
	): Promise<Response> {
		try {
			const body = await parseBody(request);
			if (!body) throw new PortError("Expected a JSON object");

			const parsedName = PresetNameSchema.safeParse(body.name);
			if (!parsedName.success)
				return jsonResponse({ error: errorMessage(parsedName.error) }, 400);

			const name = parsedName.data;
			const dir = promptDirOption();
			const presets = await listPresets(slot, dir);
			if (presets.includes(name)) return jsonResponse({ presets }, 409);

			const source = body.from ?? settings.prompts[slot] ?? "default";
			if (typeof source !== "string")
				throw new PortError("Prompt preset must be a string");
			const { text } = await readPrompt(slot, { preset: source, dir });
			await savePrompt(slot, { preset: name, text, dir });
			return jsonResponse({ presets: await listPresets(slot, dir) });
		} catch (error) {
			return promptErrorResponse(error);
		}
	}

	async function promptSetActive(
		request: Request,
		slot: PromptName,
	): Promise<Response> {
		try {
			const body = await parseBody(request);
			const preset = body?.preset;
			const notFound = `Prompt preset '${String(preset)}' not found for ${slot}`;
			if (typeof preset !== "string" || preset.length === 0)
				return jsonResponse({ error: notFound }, 400);
			if (!PresetNameSchema.safeParse(preset).success)
				return jsonResponse({ error: notFound }, 400);

			const dir = promptDirOption();
			if (!(await listPresets(slot, dir)).includes(preset))
				return jsonResponse({ error: notFound }, 400);

			settings.prompts[slot] = preset;
			await options.persistConfig?.({ prompts: { ...settings.prompts } });
			return jsonResponse({ activePreset: preset });
		} catch (error) {
			return promptErrorResponse(error);
		}
	}

	async function promptRollback(
		request: Request,
		slot: PromptName,
	): Promise<Response> {
		try {
			const body = await parseBody(request);
			if (!body) throw new PortError("Expected a JSON object");
			if (typeof body.preset !== "string" || body.preset.length === 0)
				throw new PortError("Prompt preset must be a non-empty string");
			const preset = PresetNameSchema.parse(body.preset);
			const rev = body.rev;
			if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev <= 0) {
				throw new PortError("Invalid prompt revision");
			}

			const prompt = await readPrompt(slot, {
				preset,
				version: rev,
				dir: promptDirOption(),
			});
			const version = await savePrompt(slot, {
				preset,
				text: prompt.text,
				dir: promptDirOption(),
			});
			return jsonResponse({ version });
		} catch (error) {
			return promptErrorResponse(error);
		}
	}

	async function promptReset(
		request: Request,
		slot: PromptName,
	): Promise<Response> {
		try {
			const body = await parseBody(request);
			if (!body) throw new PortError("Expected a JSON object");
			if (typeof body.preset !== "string" || body.preset.length === 0)
				throw new PortError("Prompt preset must be a non-empty string");
			const preset = PresetNameSchema.parse(body.preset);
			await readPrompt(slot, { preset, dir: promptDirOption() });
			const version = await savePrompt(slot, {
				preset,
				text: DEFAULT_PROMPTS[slot],
				dir: promptDirOption(),
			});
			return jsonResponse({ version });
		} catch (error) {
			return promptErrorResponse(error);
		}
	}
	function hiddenRevisionKey(state: ReviewState): string {
		return `${state.revision.mergeBaseSha}\u0000${state.revision.headSha}`;
	}

	async function hiddenDiffVariants(
		state: ReviewState,
	): Promise<DisplayDiffVariants> {
		const key = hiddenRevisionKey(state);
		if (hiddenSnapshot?.key === key) return hiddenSnapshot.promise;
		if (!options.vcs) throw new Error("Whitespace diff is unavailable");

		const load = options.vcs
			.diffRange(
				state.repoRoot,
				state.revision.mergeBaseSha,
				state.revision.headSha,
				{ ignoreWhitespace: true },
			)
			.then((fullDiff) => ({
				display: parseFileDiffs(
					filterDiff(fullDiff, options.config?.diff?.ignore ?? []),
				),
				full: parseFileDiffs(fullDiff),
			}));
		const tracked = load.catch((error) => {
			if (hiddenSnapshot?.promise === tracked) hiddenSnapshot = null;
			throw error;
		});
		hiddenSnapshot = { key, promise: tracked };
		return tracked;
	}

	async function diffVariants(
		state: ReviewState,
	): Promise<DisplayDiffVariants> {
		if (state.showWhitespaceChanges) {
			return {
				display: currentDiff,
				full: currentExpandedDiff ?? currentDiff,
			};
		}
		return hiddenDiffVariants(state);
	}

	let layerRun: Promise<LayerGenerationResult> | null = null;

	function recoverOrphanedLayerRun(state: ReviewState): ReviewState {
		if (state.layerStatus !== "running" || layerRun) return state;
		return { ...state, layerStatus: "pending", layerError: null };
	}

	async function currentState(): Promise<ReviewState> {
		const state = await options.store?.read();
		if (state) {
			const recovered = recoverOrphanedLayerRun(state);
			if (recovered === state || !options.store) {
				fallbackState = recovered;
				return fallbackState;
			}
			fallbackState = await options.store.mutate((current) =>
				recoverOrphanedLayerRun(current ?? state),
			);
			return fallbackState;
		}
		if (!fallbackState) throw new Error("Review state is unavailable");
		fallbackState = recoverOrphanedLayerRun(fallbackState);
		return fallbackState;
	}

	async function saveState(next: ReviewState): Promise<void> {
		const validated = ReviewStateSchema.parse(next);
		if (options.store) {
			fallbackState = await options.store.mutate((current) => ({
				...(current ?? validated),
				layers: validated.layers,
				viewedFiles: validated.viewedFiles,
			}));
			return;
		}
		fallbackState = validated;
	}

	/** One in-flight turn per chat. Different chats stream in parallel. */
	const activeTurns = new Map<string, AbortController>();

	async function mutateDrafts(
		mutator: (drafts: Draft[]) => Draft[],
	): Promise<ReviewState> {
		const base = await currentState();
		const apply = (current: ReviewState | null): ReviewState => {
			const source = current ?? base;
			return ReviewStateSchema.parse({
				...source,
				drafts: mutator(source.drafts.map((draft) => ({ ...draft }))),
			});
		};
		const next = options.store
			? await options.store.mutate((current) => apply(current))
			: apply(base);
		fallbackState = next;
		return next;
	}

	async function mutateState(
		mutator: (state: ReviewState) => ReviewState,
	): Promise<ReviewState> {
		const base = await currentState();
		const apply = (current: ReviewState | null): ReviewState =>
			ReviewStateSchema.parse(mutator(current ?? base));
		const next = options.store
			? await options.store.mutate((current) => apply(current))
			: apply(base);
		fallbackState = next;
		return next;
	}

	function requireChat(state: ReviewState, chatId: string): ChatMeta | null {
		return state.chats.find((chat) => chat.id === chatId) ?? null;
	}

	function diffForDraft(draft: Draft): ParsedFileDiff | null {
		const selection = draft.selection;
		if (draft.filePath !== selection.path) return null;
		if (isMarkdownSelection(selection)) return null;
		return (
			currentDiff.find((file) => {
				const path = selection.side === "new" ? file.newPath : file.oldPath;
				return path === draft.filePath;
			}) ?? null
		);
	}

	function reviewRef(state: ReviewState): MrRef {
		return (
			options.ref ?? {
				host: state.mr.host,
				projectPath: state.mr.projectPath,
				iid: state.mr.iid,
			}
		);
	}

	async function refreshDiscussions(): Promise<void> {
		const host = options.gitHost;
		const current = await currentState();
		const ref = reviewRef(current);
		const fetcher: (() => Promise<HostDiscussion[]>) | null =
			options.getDiscussions ??
			(host?.listDiscussions
				? () => host.listDiscussions?.(ref) ?? Promise.resolve([])
				: null);
		if (!fetcher) return;
		try {
			fallbackDiscussions = await fetcher();
		} catch {
			// A successful post remains authoritative if refresh is temporarily unavailable.
		}
	}

	function approvalFetcher():
		| ((ref: MrRef) => Promise<MrApprovalState>)
		| null {
		const fetcher = options.gitHost?.fetchApprovalState;
		return fetcher
			? (fetcher.bind(options.gitHost) as (
					ref: MrRef,
				) => Promise<MrApprovalState>)
			: null;
	}

	async function refreshApproval(): Promise<MrApprovalState | null> {
		const fetcher = approvalFetcher();
		if (!fetcher) return null;
		try {
			return await fetcher(reviewRef(await currentState()));
		} catch {
			return null;
		}
	}

	async function approval(request: Request): Promise<Response> {
		const state = await currentState();
		const ref = reviewRef(state);
		if (request.method === "GET") {
			const fetcher = approvalFetcher();
			if (!fetcher)
				return jsonResponse(
					{ error: "GitLab approval host is unavailable" },
					503,
				);
			try {
				return jsonResponse(await fetcher(ref));
			} catch (error) {
				return jsonResponse({ error: errorMessage(error) }, 502);
			}
		}

		const body = await parseBody(request);
		if (!body) return jsonResponse({ error: "Expected a JSON object" }, 400);
		const action = body.action;
		if (action !== "approve" && action !== "unapprove") {
			return jsonResponse(
				{ error: 'Action must be "approve" or "unapprove"' },
				400,
			);
		}
		const mutate =
			action === "approve"
				? options.gitHost?.approveMr
				: options.gitHost?.unapproveMr;
		if (!mutate)
			return jsonResponse(
				{ error: "GitLab approval host is unavailable" },
				503,
			);
		try {
			return jsonResponse(await mutate.call(options.gitHost, ref));
		} catch (error) {
			return jsonResponse({ error: errorMessage(error) }, 502);
		}
	}

	function reviewMrFetcher():
		| ((ref: MrRef) => Promise<ReviewMergeRequest>)
		| null {
		if (options.fetchMr) return options.fetchMr;
		const fetcher = options.gitHost?.fetchMr;
		return fetcher
			? (fetcher.bind(options.gitHost) as (
					ref: MrRef,
				) => Promise<ReviewMergeRequest>)
			: null;
	}

	async function refreshHead(): Promise<Response> {
		const state = await currentState();
		const fetcher = reviewMrFetcher();
		if (!options.vcs || !fetcher)
			return jsonResponse({ error: "MR refresh is unavailable" }, 503);
		const mr = await fetcher(reviewRef(state));
		const freshness = await compareReviewHead({
			vcs: options.vcs,
			state,
			mr,
		});
		return jsonResponse({
			...freshness,
			currentHeadSha: state.revision.headSha,
			newCommits: freshness.newCommitCount,
		});
	}
	async function syncInternal(): Promise<Response> {
		const state = await currentState();
		const fetcher = reviewMrFetcher();
		if (!options.vcs || !fetcher)
			return jsonResponse({ error: "MR sync is unavailable" }, 503);
		const ref = reviewRef(state);
		const mr = await fetcher(ref);
		const previousDiff = currentLayerDiff;
		const result = await syncReview({
			vcs: options.vcs,
			ref,
			mr,
			state,
			previousDiff,
			store: options.store,
			repoRoot: state.repoRoot,
			worktreePath: state.worktreePath,
			config: options.config,
		});
		currentDiff = parseFileDiffs(result.diff);
		currentLayerDiff = result.diff;
		currentExpandedDiff = parseFileDiffs(result.fullDiff);
		hiddenSnapshot = null;
		currentMr = mr;
		fallbackState = result.state;
		initialLayerRunAllowed = false;
		await refreshDiscussions();
		return jsonResponse(await apiState());
	}
	async function sync(): Promise<Response> {
		return serializeDisplayMutation(syncInternal);
	}

	function startLayerGeneration(
		force: boolean,
	): Promise<LayerGenerationResult> | null {
		const runAgent = layerAgent;
		if (!runAgent) return null;
		if (layerRun) return layerRun;
		const run = (async (): Promise<LayerGenerationResult> => {
			const state = await currentState();
			if (!force && state.layerStatus !== "pending") {
				return { state, doc: null, runId: "cached", attempts: 0 };
			}
			const generationRevision = state.revision;
			const result = await generateLayers({
				agent: runAgent,
				state,
				store: options.store,
				paths: options.paths,
				diff: currentLayerDiff,
				parsedDiff: currentDiff,
				getDiscussions: options.getDiscussions,
				discussions: fallbackDiscussions,
				vcs: options.vcs,
				issues: options.issues,
				config: options.config,
				mr: currentMr,
				promptSourceDir: options.promptSourceDir,
				promptText: options.promptText,
				promptPreset: presetFor(reviewLayerPromptName(state.mode)),
				onState: (next) => {
					// Without a store, prevent an old run's observer callback from
					// replacing the in-memory state after sync.
					if (
						!fallbackState ||
						sameRevision(fallbackState.revision, generationRevision)
					) {
						fallbackState = next;
					}
				},
			});
			const latest = await currentState();
			if (!sameRevision(latest.revision, generationRevision)) {
				return { ...result, state: latest, doc: null };
			}
			return result;
		})();
		let tracked: Promise<LayerGenerationResult>;
		tracked = run.finally(() => {
			if (layerRun === tracked) layerRun = null;
		});
		layerRun = tracked;
		return tracked;
	}

	async function layerStream(force: boolean): Promise<Response> {
		async function* frames(): AsyncIterable<SseFrame> {
			if (!layerAgent) {
				yield {
					event: "status",
					data: { status: "unavailable" },
				};
				yield {
					event: "error",
					data: { message: "Review layer agent is unavailable" },
				};
				yield { event: "done", data: { status: "failed" } };
				return;
			}
			yield { event: "status", data: { status: "running" } };
			try {
				const result = await startLayerGeneration(force);
				if (!result) {
					yield {
						event: "error",
						data: { message: "Review layer agent is unavailable" },
					};
					yield { event: "done", data: { status: "failed" } };
					return;
				}
				yield {
					event: "status",
					data: {
						status: result.state.layerStatus,
						error: result.state.layerError,
						layers: result.state.layers,
					},
				};
				if (result.state.layerStatus === "failed") {
					yield {
						event: "error",
						data: { message: result.state.layerError },
					};
				}
				yield {
					event: "done",
					data: {
						status: result.state.layerStatus,
						layers: result.state.layers,
					},
				};
			} catch (error) {
				yield {
					event: "error",
					data: {
						message: error instanceof Error ? error.message : String(error),
					},
				};
				yield { event: "done", data: { status: "failed" } };
			}
		}
		return sseResponse(frames());
	}

	async function chat(request: Request): Promise<Response> {
		const input = validateChatRequest(await parseBody(request));
		if (typeof input === "string") return chatErrorStream(input);

		const store = options.store;
		if (!store) return chatErrorStream("Review store is unavailable");
		const agent = chatAgent;
		if (!agent) return chatErrorStream("Review chat agent is unavailable");
		if (activeTurns.has(input.chatId))
			return chatErrorStream("Chat turn already in progress");

		const controller = new AbortController();
		activeTurns.set(input.chatId, controller);
		const release = () => {
			if (activeTurns.get(input.chatId) === controller)
				activeTurns.delete(input.chatId);
		};

		let chatState: ReviewState;
		try {
			chatState = await currentState();
			const chat = requireChat(chatState, input.chatId);
			if (!chat) {
				release();
				return chatErrorStream(`Unknown chat: ${input.chatId}`);
			}
			if (chat.title === "") {
				const title = deriveChatTitle(input.message);
				chatState = await mutateState((base) => ({
					...base,
					chats: base.chats.map((entry) =>
						entry.id === input.chatId ? { ...entry, title } : entry,
					),
				}));
			}
		} catch (error) {
			release();
			return chatErrorStream(errorMessage(error));
		}

		const queue = createSseFrameQueue();
		const run = runChatTurn({
			agent,
			store,
			state: chatState,
			chatId: input.chatId,
			paths: options.paths,
			promptSourceDir: options.promptSourceDir,
			promptText: options.promptText,
			promptPreset: presetFor("review-chat"),
			message: input.message,
			tags: input.tags,
			openFile: input.openFile,
			discussions: fallbackDiscussions,
			signal: controller.signal,
			onEvent: (event) => {
				const frame = chatEventFrame(event);
				if (frame) queue.push(frame);
			},
		});
		const finish = () => {
			release();
			queue.close();
		};
		void run.then(
			(result) => {
				if (
					result.error &&
					!result.events.some((event) => event.kind === "error")
				) {
					queue.push({
						event: "error",
						data: { message: result.error },
					});
				}
				finish();
			},
			(error) => {
				queue.push({
					event: "error",
					data: { message: errorMessage(error) },
				});
				finish();
			},
		);

		async function* frames(): AsyncIterable<SseFrame> {
			for await (const frame of queue.frames()) yield frame;
		}
		return sseResponse(frames());
	}

	async function cancelChat(request: Request): Promise<Response> {
		const body = await parseBody(request);
		const chatId = body?.chatId;
		if (typeof chatId !== "string" || !CHAT_ID_PATTERN.test(chatId))
			return jsonResponse({ error: "Chat id is invalid" }, 400);
		activeTurns.get(chatId)?.abort();
		return emptyResponse(204);
	}

	async function chatHistory(url: URL): Promise<Response> {
		const chatId = url.searchParams.get("chatId");
		if (!chatId || !CHAT_ID_PATTERN.test(chatId))
			return jsonResponse({ error: "Chat id is invalid" }, 400);
		const state = await currentState();
		if (!requireChat(state, chatId))
			return jsonResponse({ error: `Unknown chat: ${chatId}` }, 404);
		return jsonResponse(
			options.store ? await options.store.readChat(chatId) : [],
		);
	}

	async function createChat(): Promise<Response> {
		const chat = createChatMeta();
		const next = await mutateState((base) => ({
			...base,
			chats: [...base.chats, chat],
			activeChatId: chat.id,
		}));
		return jsonResponse(
			{ chats: next.chats, activeChatId: next.activeChatId },
			201,
		);
	}

	async function explainComment(request: Request): Promise<Response> {
		const input = validateExplainRequest(await parseBody(request));
		if (typeof input === "string") return jsonResponse({ error: input }, 400);
		const discussion = fallbackDiscussions.find(
			(entry) => entry.id === input.discussionId,
		);
		if (!discussion) {
			return jsonResponse(
				{ error: `Unknown discussion: ${input.discussionId}` },
				404,
			);
		}
		try {
			const prefix =
				options.explainPromptText ??
				(await loadPrompt("review-explain-comment", {
					preset: presetFor("review-explain-comment"),
					dir: options.promptSourceDir,
				}));
			const diffs = [currentExpandedDiff ?? [], currentDiff];
			const message = buildExplainMessage({ prefix, discussion, diffs });
			const chat: ChatMeta = {
				...createChatMeta(),
				title: explainChatTitle(discussion),
			};
			const next = await mutateState((base) => ({
				...base,
				chats: [...base.chats, chat],
				activeChatId: chat.id,
			}));
			return jsonResponse(
				{
					chatId: chat.id,
					chats: next.chats,
					activeChatId: next.activeChatId,
					message,
				},
				201,
			);
		} catch (error) {
			return jsonResponse({ error: errorMessage(error) }, 500);
		}
	}

	async function selectChat(request: Request): Promise<Response> {
		const body = await parseBody(request);
		const chatId = body?.chatId;
		if (typeof chatId !== "string" || !CHAT_ID_PATTERN.test(chatId))
			return jsonResponse({ error: "Chat id is invalid" }, 400);
		const state = await currentState();
		if (!requireChat(state, chatId))
			return jsonResponse({ error: `Unknown chat: ${chatId}` }, 404);
		await mutateState((base) => ({ ...base, activeChatId: chatId }));
		return emptyResponse(204);
	}

	async function commentDraft(request: Request): Promise<Response> {
		const input = validateCommentDraftRequest(await parseBody(request));
		if (typeof input === "string") return jsonResponse({ error: input }, 400);

		const draft: Draft = {
			id: crypto.randomUUID(),
			body: "",
			selection: input.selection,
			filePath: input.filePath,
			status: "draft",
			error: null,
			postedDiscussionId: null,
			staleSince: null,
		};
		try {
			await mutateDrafts((drafts) => [...drafts, draft]);
			return jsonResponse(draft, 201);
		} catch (error) {
			return jsonResponse({ error: errorMessage(error) }, 500);
		}
	}

	async function updateComment(
		request: Request,
		draftId: string,
	): Promise<Response> {
		const body = await parseBody(request);
		if (!body || typeof body.body !== "string" || body.body.trim().length === 0)
			return jsonResponse({ error: "Comment body must not be empty" }, 400);
		const state = await currentState();
		const existing = state.drafts.find((draft) => draft.id === draftId);
		if (!existing) return jsonResponse({ error: "Draft not found" }, 404);
		if (existing.status === "posted")
			return jsonResponse({ error: "Posted comments cannot be edited" }, 409);
		const next = await mutateDrafts((drafts) => {
			const index = drafts.findIndex((draft) => draft.id === draftId);
			if (index < 0) return drafts;
			const current = drafts[index];
			if (!current) return drafts;
			drafts[index] = {
				...current,
				body: body.body as string,
				status: "draft",
				error: null,
			};
			return drafts;
		});
		return jsonResponse(next.drafts.find((draft) => draft.id === draftId));
	}

	async function deleteComment(draftId: string): Promise<Response> {
		const state = await currentState();
		if (!state.drafts.some((draft) => draft.id === draftId))
			return jsonResponse({ error: "Draft not found" }, 404);
		await mutateDrafts((drafts) =>
			drafts.filter((draft) => draft.id !== draftId),
		);
		return emptyResponse(204);
	}

	function formatMarkdownCommentBody(
		draft: Draft,
		selection: MarkdownSelection,
	): string {
		const lineRange =
			selection.startLine === selection.endLine
				? `${selection.startLine}`
				: `${selection.startLine}-${selection.endLine}`;
		const quotedLines = selection.quote
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
		return `**${draft.filePath}:${lineRange}**\n\n${quotedLines}\n\n${draft.body}`;
	}

	async function sendComment(draftId: string): Promise<Response> {
		const fail = (message: string, status: number): Response =>
			commentSseError(message, status);

		const markFailed = async (message: string): Promise<void> => {
			await mutateDrafts((drafts) =>
				drafts.map((candidate) =>
					candidate.id === draftId
						? { ...candidate, status: "failed", error: message }
						: candidate,
				),
			);
		};

		try {
			const state = await currentState();
			const draft = state.drafts.find((candidate) => candidate.id === draftId);
			if (!draft) return fail("Draft not found", 404);
			if (draft.status === "posted")
				return fail("Comment is already posted", 409);

			let discussionInput: CreateDiscussionInput;
			if (isMarkdownSelection(draft.selection)) {
				discussionInput = {
					ref: reviewRef(state),
					body: formatMarkdownCommentBody(draft, draft.selection),
				};
			} else {
				const file = diffForDraft(draft);
				if (!file) {
					const message = "Draft position does not match the current diff";
					await markFailed(message);
					return fail(message, 400);
				}
				let position: GitLabPositionPayload;
				try {
					position = buildPosition(
						draft.selection,
						file,
						state.revision.diffRefs,
					);
				} catch (error) {
					const message = errorMessage(error);
					await markFailed(message);
					return fail(message, 400);
				}
				discussionInput = {
					ref: reviewRef(state),
					body: draft.body,
					position,
					parsedDiff: file,
					diffRefs: state.revision.diffRefs,
				};
			}

			if (!options.gitHost?.createDiscussion) {
				const message = "GitLab discussion host is unavailable";
				await markFailed(message);
				return fail(message, 503);
			}

			await mutateDrafts((drafts) =>
				drafts.map((candidate) =>
					candidate.id === draftId
						? { ...candidate, status: "sending", error: null }
						: candidate,
				),
			);

			let discussion: HostDiscussion;
			try {
				discussion = await options.gitHost.createDiscussion(discussionInput);
			} catch (error) {
				const message = errorMessage(error);
				await markFailed(message);
				return fail(message, 502);
			}

			await refreshDiscussions();
			await mutateDrafts((drafts) =>
				drafts.map((candidate) =>
					candidate.id === draftId
						? {
								...candidate,
								status: "posted",
								error: null,
								postedDiscussionId: discussion.id,
							}
						: candidate,
				),
			);
			return commentSseResponse(200, [{ event: "done", data: { discussion } }]);
		} catch (error) {
			return fail(errorMessage(error), 500);
		}
	}

	async function whitespaceInternal(request: Request): Promise<Response> {
		const parsed = z
			.object({ showWhitespaceChanges: z.boolean() })
			.safeParse(await parseBody(request));
		if (!parsed.success)
			return jsonResponse({ error: parsed.error.message }, 400);

		const showWhitespaceChanges = parsed.data.showWhitespaceChanges;
		const state = await currentState();
		if (!showWhitespaceChanges && !options.vcs)
			return jsonResponse({ error: "Whitespace diff is unavailable" }, 503);
		if (!showWhitespaceChanges) await hiddenDiffVariants(state);
		const next = await mutateState((current) => ({
			...current,
			showWhitespaceChanges,
		}));
		const variants = await diffVariants(next);
		return jsonResponse({
			showWhitespaceChanges: next.showWhitespaceChanges,
			diff: variants.display,
		});
	}

	async function whitespace(request: Request): Promise<Response> {
		return serializeDisplayMutation(() => whitespaceInternal(request));
	}

	async function apiState(): Promise<ReviewApiState> {
		const state = await currentState();
		const variants = await diffVariants(state);
		if (
			initialLayerRunAllowed &&
			state.layerStatus === "pending" &&
			layerAgent &&
			!layerRun
		) {
			initialLayerRunAllowed = false;
			void startLayerGeneration(false)?.catch(() => undefined);
		}
		if (options.getDiscussions) {
			try {
				fallbackDiscussions = await options.getDiscussions();
			} catch {
				// Discussions are supplementary; a host outage must not hide the diff.
			}
		}
		const approvalState = await refreshApproval();
		return {
			...state,
			diff: variants.display,
			discussions: fallbackDiscussions,
			approval: approvalState,
			largeFileLineThreshold: threshold,
			busyChatIds: [...activeTurns.keys()],
		};
	}

	async function progress(request: Request): Promise<Response> {
		const body = await parseBody(request);
		if (!body) return jsonResponse({ error: "Expected a JSON object" }, 400);
		const state = await currentState();

		const applyProgress = (base: ReviewState): ReviewState => {
			const next: ReviewState = {
				...base,
				layers: base.layers.map((layer) => ({ ...layer })),
				viewedFiles: [...base.viewedFiles],
			};

			const layerId = typeof body.layerId === "string" ? body.layerId : null;
			if (layerId !== null && typeof body.done === "boolean") {
				const layer = next.layers.find((candidate) => candidate.id === layerId);
				if (!layer) throw new Error("Unknown layer");
				layer.done = body.done;
			}

			if (typeof body.viewedFile === "string" && body.viewedFile.length > 0) {
				if (!next.viewedFiles.includes(body.viewedFile))
					next.viewedFiles.push(body.viewedFile);
			}
			if (body.viewedFile && typeof body.viewedFile === "object") {
				const viewed = body.viewedFile as Record<string, unknown>;
				const path = typeof viewed.path === "string" ? viewed.path : null;
				if (path && viewed.viewed === false) {
					next.viewedFiles = next.viewedFiles.filter((item) => item !== path);
				} else if (path && !next.viewedFiles.includes(path)) {
					next.viewedFiles.push(path);
				}
			}
			return next;
		};

		let next: ReviewState;
		if (options.store) {
			try {
				next = await options.store.mutate((current) =>
					applyProgress(current ?? state),
				);
			} catch (error) {
				if (error instanceof Error && error.message === "Unknown layer")
					return jsonResponse({ error: error.message }, 404);
				throw error;
			}
		} else {
			next = applyProgress(state);
			await saveState(next);
		}
		return jsonResponse({
			layers: next.layers,
			viewedFiles: next.viewedFiles,
		});
	}

	async function file(request: Request): Promise<Response> {
		if (!options.worktreePath)
			return jsonResponse({ error: "Worktree unavailable" }, 503);
		const url = new URL(request.url);
		const requestedPath = url.searchParams.get("path");
		if (!requestedPath) return jsonResponse({ error: "Missing path" }, 400);
		const side: ReviewFileSide =
			url.searchParams.get("side") === "old" ? "old" : "new";
		try {
			if (side === "old" && options.getFileContents) {
				const root = await realpath(options.worktreePath);
				const candidate = validateReviewPath(root, requestedPath);
				await ensureReviewPathInside(root, candidate);
				const state = await currentState();
				const contents = await options.getFileContents({
					path: requestedPath,
					side,
					revision: state.revision.mergeBaseSha,
				});
				if (contents === null)
					return jsonResponse({ error: "File not found" }, 404);
				return new Response(contents, {
					headers: {
						"content-type": "text/plain; charset=utf-8",
						"cache-control": "no-store",
					},
				});
			}
			const path = await resolveReviewFilePath(
				options.worktreePath,
				requestedPath,
			);
			const contents = await readFile(path, "utf8");
			return new Response(contents, {
				headers: {
					"content-type": "text/plain; charset=utf-8",
					"cache-control": "no-store",
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (
				message.includes("escapes worktree") ||
				message === "Invalid file path"
			) {
				return jsonResponse({ error: message }, 400);
			}
			return jsonResponse({ error: "File not found" }, 404);
		}
	}

	async function expandedFile(request: Request): Promise<Response> {
		const requestedPath = new URL(request.url).searchParams.get("path");
		if (!requestedPath) return jsonResponse({ error: "Missing path" }, 400);
		const state = await currentState();
		const variants = await diffVariants(state);
		const known = variants.display.find(
			(candidate) =>
				candidate.oldPath === requestedPath ||
				candidate.newPath === requestedPath,
		);
		if (!known) return jsonResponse({ error: "File not found" }, 404);
		const expanded = variants.full.find(
			(candidate) =>
				candidate.oldPath === requestedPath ||
				candidate.newPath === requestedPath,
		);
		return jsonResponse(expanded ?? known);
	}
	return async function reviewRoutes(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (
			(url.pathname === "/api" || url.pathname.startsWith("/api/")) &&
			!hasToken(request, options.token)
		) {
			return emptyResponse(401);
		}

		try {
			if (request.method === "GET" && url.pathname === "/api/state") {
				return jsonResponse(await apiState());
			}
			if (
				request.method === "POST" &&
				url.pathname === "/api/diff/whitespace"
			) {
				return await whitespace(request);
			}
			if (
				(request.method === "GET" || request.method === "POST") &&
				url.pathname === "/api/approval"
			) {
				return approval(request);
			}
			if (
				(request.method === "GET" || request.method === "POST") &&
				url.pathname === "/api/refresh"
			) {
				return refreshHead();
			}
			if (request.method === "POST" && url.pathname === "/api/sync") {
				return sync();
			}
			if (request.method === "POST" && url.pathname === "/api/progress") {
				return progress(request);
			}
			if (request.method === "GET" && url.pathname === "/api/file") {
				return file(request);
			}
			if (request.method === "GET" && url.pathname === "/api/diff") {
				return expandedFile(request);
			}
			if (
				request.method === "POST" &&
				(url.pathname === "/api/layers/regenerate" ||
					url.pathname === "/api/layers/retry")
			) {
				return layerStream(true);
			}
			if (request.method === "GET" && url.pathname === "/api/chat") {
				return chatHistory(url);
			}
			if (request.method === "POST" && url.pathname === "/api/chat/cancel") {
				return cancelChat(request);
			}
			if (request.method === "POST" && url.pathname === "/api/chat") {
				return chat(request);
			}
			if (request.method === "POST" && url.pathname === "/api/chats") {
				return createChat();
			}
			if (request.method === "POST" && url.pathname === "/api/chats/active") {
				return selectChat(request);
			}
			if (request.method === "POST" && url.pathname === "/api/comments/draft") {
				return commentDraft(request);
			}
			if (
				request.method === "POST" &&
				url.pathname === "/api/comments/explain"
			) {
				return explainComment(request);
			}
			if (url.pathname.startsWith("/api/comments/")) {
				const suffix = url.pathname.slice("/api/comments/".length);
				const [encodedId, action] = suffix.split("/");
				if (!encodedId || (action && action !== "send"))
					return emptyResponse(404);
				let draftId: string;
				try {
					draftId = decodeURIComponent(encodedId);
				} catch {
					if (action === "send" && request.method === "POST")
						return commentSseError("Invalid draft id", 400);
					return jsonResponse({ error: "Invalid draft id" }, 400);
				}
				if (action === "send" && request.method === "POST")
					return sendComment(draftId);
				if (!action && request.method === "PUT")
					return updateComment(request, draftId);
				if (!action && request.method === "DELETE")
					return deleteComment(draftId);
				return emptyResponse(404);
			}
			if (request.method === "GET" && url.pathname === "/api/settings") {
				return settingsSnapshot();
			}
			if (
				request.method === "POST" &&
				url.pathname === "/api/settings/review"
			) {
				return updateReviewSettings(request);
			}
			if (url.pathname.startsWith("/api/prompts/")) {
				const suffix = url.pathname.slice("/api/prompts/".length);
				const [rawSlot, action] = suffix.split("/");
				let slot: PromptName | null = null;
				try {
					slot = rawSlot ? parseSlot(decodeURIComponent(rawSlot)) : null;
				} catch {
					slot = null;
				}
				if (!slot) return jsonResponse({ error: "Unknown prompt slot" }, 404);
				if (!action && request.method === "GET") return promptRead(url, slot);
				if (!action && request.method === "POST")
					return promptSave(request, slot);
				if (action === "presets" && request.method === "POST")
					return promptCreatePreset(request, slot);
				if (action === "active" && request.method === "POST")
					return promptSetActive(request, slot);
				if (action === "rollback" && request.method === "POST")
					return promptRollback(request, slot);
				if (action === "reset" && request.method === "POST")
					return promptReset(request, slot);
				return emptyResponse(404);
			}

			if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
				return emptyResponse(404);
			}
			return emptyResponse(404);
		} catch (error) {
			if (
				request.method === "POST" &&
				url.pathname.startsWith("/api/comments/") &&
				url.pathname.endsWith("/send")
			) {
				return commentSseError(errorMessage(error), 500);
			}
			return jsonResponse({ error: errorMessage(error) }, 500);
		}
	};
}

export const createReviewRouter = createReviewRoutes;
export const reviewRoutes = createReviewRoutes;
