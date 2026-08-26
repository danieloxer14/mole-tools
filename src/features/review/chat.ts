import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_PROMPTS } from "../../adapters/prompts/defaults";
import { loadPrompt } from "../../adapters/prompts/loader";
import type { AgentEvent, ReviewAgent } from "../../ports/review-agent";
import type { ReviewPaths } from "./paths";
import { ensureChats, type ReviewState, ReviewStateSchema } from "./state";
import {
	type ChatEntry,
	type ChatTag,
	ChatTagSchema,
	type ReviewStore,
} from "./store";

/**
 * Context that is safe to hand to a chat agent. The worktree itself is never
 * copied into this object; the agent is expected to inspect it with read-only
 * tools when it needs more detail.
 */
export interface ChatPromptContext {
	mr: ChatMrMetadata;
	guide: unknown;
	changedFiles: readonly string[];
}

export interface ChatMrMetadata {
	host: string;
	projectPath: string;
	iid: number;
	webUrl: string;
	title: string;
	sourceBranch: string;
	targetBranch: string;
	[key: string]: unknown;
}

export interface ChatPromptInput {
	/** Prompt supplied by the configurable review-chat prompt. */
	basePrompt?: string;
	/** Set explicitly by the caller; otherwise turn === 1 is used. */
	firstTurn?: boolean;
	turn?: number;
	context?: Partial<ChatPromptContext>;
	mr?: ChatMrMetadata;
	guide?: unknown;
	layerGuide?: unknown;
	layers?: unknown;
	changedFiles?: readonly string[];
	message?: string;
	tags?: readonly unknown[];
	newTags?: readonly unknown[];
	openFile?: string | null;
	currentFile?: string | null;
	/** Absolute path of the pinned review worktree; enforced only by prompt policy. */
	worktreePath: string;
}

export interface ChatPromptPaths {
	promptDir?: string;
	promptPath?: (turnId: string) => string;
}

export interface ChatTurnOptions {
	agent: ReviewAgent;
	store: ReviewStore;
	state: ReviewState;
	chatId: string;
	paths?: Pick<ReviewPaths, "promptDir" | "promptPath"> & ChatPromptPaths;
	promptDir?: string;
	promptPath?: (turnId: string) => string;
	promptSourceDir?: string;
	promptText?: string;
	turnId?: string;
	context?: ChatPromptContext;
	mr?: ChatMrMetadata;
	guide?: unknown;
	layerGuide?: unknown;
	layers?: unknown;
	changedFiles?: readonly string[];
	message: string;
	tags?: readonly unknown[];
	openFile?: string | null;
	currentFile?: string | null;
	signal?: AbortSignal;
	onEvent?: (event: AgentEvent) => void | Promise<void>;
}

export interface ChatTurnResult {
	state: ReviewState;
	turnId: string;
	promptPath: string;
	events: AgentEvent[];
	text: string;
	assistantText: string;
	sessionId: string | null;
	error: string | null;
}

/**
 * Explicit policy included in every chat prompt. The underlying tool runtime
 * does not sandbox read/grep/glob/bash to a directory, so this is enforced by
 * instruction only: name the exact boundary and forbid wandering outside it.
 */
export function readOnlyWorktreeContext(worktreePath: string): string {
	return `The review worktree is read-only and pinned at the absolute path ${worktreePath}. Use only read, grep, glob, and bash tools, scoped to files inside that path. Use bash only for read-only inspection commands. Never invoke write or edit tools, never run commands that modify files, and never modify files; if asked to change the worktree, refuse and explain that chat review is read-only. Do not read, grep, or glob anything outside the worktree for any reason, including this application's own configuration, session, or review-data directories, or any other project's files on this machine, even though the tools are not sandboxed and would technically allow it. If the worktree does not contain enough information to answer, say so explicitly instead of guessing or reporting an unrelated file path as the answer.`;
}

export type LineTag = ChatTag;
export { ChatTagSchema };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function json(value: unknown): string {
	return JSON.stringify(value, null, "\t");
}

/** Validate and clone line tags before they reach the prompt or transcript. */
export function validateChatTags(value: unknown): ChatTag[] {
	if (!Array.isArray(value)) throw new Error("Chat tags must be an array");
	return value.map((tag, index) => {
		const parsed = ChatTagSchema.safeParse(tag);
		if (!parsed.success) {
			throw new Error(
				`Invalid chat tag at index ${index}: ${parsed.error.message}`,
			);
		}
		return parsed.data;
	});
}

export const validateLineTags = validateChatTags;

function normalizedMessage(message: unknown): string {
	if (typeof message !== "string" || message.trim().length === 0) {
		throw new Error("Chat message must not be empty");
	}
	return message;
}

function normalizedOpenFile(value: unknown): string | null {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string")
		throw new Error("Current file must be a string");
	if (value.includes("\0")) throw new Error("Current file contains a NUL byte");
	return value;
}

function normalizedWorktreePath(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("Chat prompt requires the worktree's absolute path");
	}
	return value;
}

function contextFromInput(input: ChatPromptInput): Partial<ChatPromptContext> {
	return {
		mr: input.context?.mr ?? input.mr,
		guide:
			input.context?.guide ?? input.guide ?? input.layerGuide ?? input.layers,
		changedFiles: input.context?.changedFiles ?? input.changedFiles,
	};
}

function isFirstTurn(input: ChatPromptInput): boolean {
	if (input.firstTurn !== undefined) return input.firstTurn;
	if (input.turn !== undefined) return input.turn === 1;
	return input.context !== undefined;
}

function requireFirstContext(
	context: Partial<ChatPromptContext>,
): ChatPromptContext {
	if (!context.mr) throw new Error("First chat turn requires MR metadata");
	if (context.guide === undefined)
		throw new Error("First chat turn requires a layer guide");
	if (!context.changedFiles) {
		throw new Error("First chat turn requires a changed-file list");
	}
	return {
		mr: context.mr,
		guide: context.guide,
		changedFiles: [...context.changedFiles],
	};
}

/** Render user-visible turn data. Later turns contain only this delta. */
export function buildChatMessage(input: {
	message: string;
	tags?: readonly unknown[];
	newTags?: readonly unknown[];
	openFile?: string | null;
	currentFile?: string | null;
}): string {
	const message = normalizedMessage(input.message);
	const tags = validateChatTags(input.tags ?? input.newTags ?? []);
	const openFile = normalizedOpenFile(input.openFile ?? input.currentFile);
	return [
		"Reviewer message:",
		message,
		"New line tags:",
		json(tags),
		"Current file:",
		openFile ?? "(none)",
	].join("\n\n");
}

/**
 * Build one system-prompt file. Turn one contains the immutable MR context;
 * subsequent turns intentionally omit it and rely on the resumed session.
 */
export function buildChatPrompt(input: ChatPromptInput): string {
	const first = isFirstTurn(input);
	const context = contextFromInput(input);
	const tags = validateChatTags(input.tags ?? input.newTags ?? []);
	const message = normalizedMessage(
		input.message ?? "Review the merge request.",
	);
	const openFile = normalizedOpenFile(input.openFile ?? input.currentFile);
	const base = input.basePrompt ?? DEFAULT_PROMPTS["review-chat"];
	const worktreePath = normalizedWorktreePath(input.worktreePath);
	const sections = [base.trim(), readOnlyWorktreeContext(worktreePath)];

	if (first) {
		const firstContext = requireFirstContext(context);
		sections.push(
			`Merge request metadata:\n${json(firstContext.mr)}`,
			`Layer guide:\n${json(firstContext.guide)}`,
			`Changed files:\n${json(firstContext.changedFiles)}`,
		);
	}

	sections.push(
		"Current turn:\n" +
			json({
				message,
				newTags: tags,
				currentFile: openFile,
			}),
		`Current file:\n${openFile ?? "(none)"}`,
	);
	return `${sections.join("\n\n")}\n`;
}

export const createChatPrompt = buildChatPrompt;

function stateContext(
	state: ReviewState,
	options: ChatTurnOptions,
): ChatPromptContext {
	const changedFiles =
		options.changedFiles ?? state.layers.flatMap((layer) => layer.files);
	const guide =
		options.guide ?? options.layerGuide ?? options.layers ?? state.layers;
	return {
		mr: options.mr ?? {
			...state.mr,
			headSha: state.revision.headSha,
			mergeBaseSha: state.revision.mergeBaseSha,
			diffRefs: state.revision.diffRefs,
		},
		guide,
		changedFiles: [...new Set(changedFiles)],
	};
}

function promptPaths(
	state: ReviewState,
	options: ChatTurnOptions,
	turnId: string,
): { promptDir: string; promptPath: string } {
	const configuredDir = options.paths?.promptDir ?? options.promptDir;
	const promptDir =
		configuredDir ?? join(dirname(state.worktreePath), "prompt");
	const pathBuilder =
		options.paths?.promptPath ??
		options.promptPath ??
		((id: string) => join(promptDir, `${id}.md`));
	return { promptDir, promptPath: pathBuilder(turnId) };
}

async function notify(
	callback: ChatTurnOptions["onEvent"],
	event: AgentEvent,
): Promise<void> {
	if (!callback) return;
	try {
		await callback(event);
	} catch {
		// Observers must not prevent transcript persistence.
	}
}

async function persistSession(
	store: ReviewStore,
	state: ReviewState,
	chatId: string,
	sessionId: string,
): Promise<ReviewState> {
	return store.mutate((current) => {
		const base = current ?? state;
		return {
			...base,
			chats: base.chats.map((chat) =>
				chat.id === chatId ? { ...chat, sessionId } : chat,
			),
		};
	});
}

function latestSession(entries: ChatEntry[]): string | null {
	for (let index = entries.length - 1; index >= 0; index--) {
		const sessionId = entries[index]?.sessionId;
		if (sessionId) return sessionId;
	}
	return null;
}

/** Run one persistent, read-only chat turn and retain partial assistant text. */
export async function runChatTurn(
	options: ChatTurnOptions,
): Promise<ChatTurnResult> {
	let state = ensureChats(
		ReviewStateSchema.parse((await options.store.read()) ?? options.state),
	);
	const chat = state.chats.find((entry) => entry.id === options.chatId);
	if (!chat) throw new Error(`Unknown chat: ${options.chatId}`);

	const transcript = await options.store.readChat(options.chatId);
	const sessionIdFromState = chat.sessionId ?? latestSession(transcript);
	if (sessionIdFromState && chat.sessionId !== sessionIdFromState) {
		state = await persistSession(
			options.store,
			state,
			options.chatId,
			sessionIdFromState,
		);
	}

	const tags = validateChatTags(options.tags ?? []);
	const openFile = normalizedOpenFile(options.openFile ?? options.currentFile);
	const message = normalizedMessage(options.message);
	const turnId = options.turnId ?? crypto.randomUUID();
	const firstTurn = transcript.length === 0 && sessionIdFromState === null;
	const context = options.context ?? stateContext(state, options);
	const paths = promptPaths(state, options, turnId);
	const basePrompt =
		options.promptText ??
		(await loadPrompt("review-chat", options.promptSourceDir));
	const prompt = buildChatPrompt({
		basePrompt,
		firstTurn,
		context,
		message,
		tags,
		openFile,
		worktreePath: state.worktreePath,
	});

	await mkdir(paths.promptDir, { recursive: true });
	await Bun.write(paths.promptPath, prompt);
	await options.store.appendChat(options.chatId, {
		role: "user",
		text: message,
		tags,
		sessionId: sessionIdFromState,
	});

	const events: AgentEvent[] = [];
	let assistantText = "";
	let sessionId = sessionIdFromState;
	let failure: string | null = null;
	const turn = {
		cwd: state.worktreePath,
		sessionId: sessionIdFromState ?? undefined,
		systemPromptFile: paths.promptPath,
		message: buildChatMessage({ message, tags, openFile }),
		signal: options.signal,
	};

	try {
		for await (const event of options.agent.run(turn)) {
			events.push(event);
			await notify(options.onEvent, event);
			if (event.kind === "session") {
				sessionId = event.sessionId;
				try {
					state = await persistSession(
						options.store,
						state,
						options.chatId,
						event.sessionId,
					);
				} catch (error) {
					failure ??= `Unable to persist chat session: ${errorMessage(error)}`;
				}
			}
			if (event.kind === "text") assistantText += event.delta;
			if (event.kind === "error") failure ??= event.message;
		}
	} catch (error) {
		failure ??= errorMessage(error);
		const event: AgentEvent = { kind: "error", message: failure };
		events.push(event);
		await notify(options.onEvent, event);
	} finally {
		await options.store.appendChat(options.chatId, {
			role: "assistant",
			text: assistantText,
			tags: [],
			sessionId,
		});
	}

	return {
		state,
		turnId,
		promptPath: paths.promptPath,
		events,
		text: assistantText,
		assistantText,
		sessionId,
		error: failure,
	};
}

export const sendChatMessage = runChatTurn;
export const runChat = runChatTurn;
