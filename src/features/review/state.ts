import { z } from "zod";
import {
	type AgentEffort,
	AgentEffortSchema,
} from "../../adapters/agent/effort";
import {
	PROMPT_AGENT_NAMES,
	type PromptAgentName,
} from "../../adapters/prompts/frontmatter";

export const CHAT_TITLE_MAX = 48;

/**
 * Chat ids reach the filesystem as `chats/<id>.ndjson`, so the character set is
 * deliberately narrow: no dot, no slash, therefore no traversal.
 */
export const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Id given to the conversation adopted from a pre-multi-chat review. */
export const LEGACY_CHAT_ID = "legacy";

export const CHAT_KINDS = ["review", "one-pager"] as const;
export const ChatKindSchema = z.enum(CHAT_KINDS);
export type ChatKind = z.infer<typeof ChatKindSchema>;

export const ChatMetaSchema = z.object({
	id: z.string().regex(CHAT_ID_PATTERN),
	title: z.string().default(""),
	sessionId: z.string().min(1).nullable().default(null),
	createdAt: z.string().min(1),
	agent: z.enum(PROMPT_AGENT_NAMES).nullable().default(null),
	model: z.string().min(1).nullable().default(null),
	effort: AgentEffortSchema.nullable().default(null),
	kind: ChatKindSchema.default("review"),
});
export type ChatMeta = z.infer<typeof ChatMetaSchema>;

export const LineSelectionSchema = z.object({
	path: z.string().min(1),
	side: z.enum(["new", "old"]),
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive(),
});
export type LineSelection = z.infer<typeof LineSelectionSchema>;

/**
 * Selection for a comment/tag anchored to a rendered-markdown block rather
 * than a diff line. Rendered blocks have no diff side/hunk to anchor to, so
 * this carries the source line range plus the quoted block text instead.
 */
export const MarkdownSelectionSchema = z
	.object({
		kind: z.literal("markdown"),
		path: z.string().min(1),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
		quote: z.string(),
	})
	.strict()
	.refine((selection) => selection.endLine >= selection.startLine, {
		message: "endLine must be greater than or equal to startLine",
		path: ["endLine"],
	});
export type MarkdownSelection = z.infer<typeof MarkdownSelectionSchema>;

export const DraftSelectionSchema = z.union([
	LineSelectionSchema,
	MarkdownSelectionSchema,
]);
export type DraftSelection = z.infer<typeof DraftSelectionSchema>;

export function isMarkdownSelection(
	selection: DraftSelection,
): selection is MarkdownSelection {
	return "kind" in selection && selection.kind === "markdown";
}

export const LayerSchema = z.object({
	title: z.string().min(1),
	tldr: z.string().min(1),
	files: z.array(z.string().min(1)).min(1),
});
export type Layer = z.infer<typeof LayerSchema>;

export const LayerDocSchema = z.object({
	version: z.literal(1),
	layers: z.array(LayerSchema).min(1),
});
export type LayerDoc = z.infer<typeof LayerDocSchema>;

export const DraftSchema = z.object({
	id: z.string(),
	body: z.string(),
	selection: DraftSelectionSchema,
	filePath: z.string(),
	status: z.enum(["draft", "sending", "posted", "failed"]),
	error: z.string().nullable().default(null),
	postedDiscussionId: z.string().nullable().default(null),
	staleSince: z.string().nullable().default(null),
});
export type Draft = z.infer<typeof DraftSchema>;

export const LegacyChatSessionSchema = z.string().nullable().default(null);

export const ReviewStateSchema = z.object({
	version: z.literal(1),
	mode: z.enum(["code", "plan"]),
	showWhitespaceChanges: z.boolean().default(true),
	mr: z.object({
		host: z.string(),
		projectPath: z.string(),
		iid: z.number().int().positive(),
		webUrl: z.string(),
		title: z.string(),
		description: z.string().default(""),
		sourceBranch: z.string(),
		targetBranch: z.string(),
	}),
	revision: z.object({
		headSha: z.string(),
		mergeBaseSha: z.string(),
		diffRefs: z.object({
			baseSha: z.string(),
			startSha: z.string(),
			headSha: z.string(),
		}),
		syncedAt: z.string(),
	}),
	worktreePath: z.string(),
	repoRoot: z.string(),
	layerStatus: z.enum(["pending", "running", "ready", "failed"]),
	layerError: z.string().nullable(),
	layers: z.array(
		LayerSchema.extend({
			id: z.string(),
			done: z.boolean().default(false),
			stale: z.boolean().default(false),
		}),
	),
	viewedFiles: z.array(z.string()).default([]),
	collapsedDiscussionIds: z.array(z.string()).default([]),
	/**
	 * Legacy single-conversation session id, kept only so v1 state files written
	 * before multiple chats still parse. The legacy `chatSessionId` is consumed
	 * by file-boundary migration and every write afterwards stores null.
	 */
	chatSessionId: LegacyChatSessionSchema,
	chats: z.array(ChatMetaSchema).default([]),
	activeChatId: z.string().nullable().default(null),
	activeOnePagerChatId: z.string().nullable().default(null),
	drafts: z.array(DraftSchema).default([]),
});

export function deriveChatTitle(message: string): string {
	const collapsed = message.replace(/\s+/g, " ").trim();
	if (collapsed.length <= CHAT_TITLE_MAX) return collapsed;
	return `${collapsed.slice(0, CHAT_TITLE_MAX).trimEnd()}…`;
}

export function createChatMeta(
	now: string = new Date().toISOString(),
	binding: {
		agent: PromptAgentName | null;
		model: string | null;
		effort: AgentEffort | null;
	} = { agent: null, model: null, effort: null },
	kind: ChatKind = "review",
): ChatMeta {
	return {
		id: crypto.randomUUID(),
		title: "",
		sessionId: null,
		createdAt: now,
		agent: binding.agent,
		model: binding.model,
		effort: binding.effort,
		kind,
	};
}

/**
 * Normalize the multi-chat fields of a v1 state document.
 *
 * Deterministic and idempotent — it never mints a random id, so it is safe to
 * run on every read without persisting. Guarantees at least one review chat
 * and valid active-chat pointers. A legacy session id supplied by the
 * file-boundary migration is assigned to the adopted chat.
 */
export function ensureChats(
	state: ReviewState,
	legacySessionId: string | null = null,
): ReviewState {
	let chats = state.chats;
	let reviewChats = chats.filter((chat) => chat.kind === "review");
	if (reviewChats.length === 0) {
		const legacyChat: ChatMeta = {
			id: LEGACY_CHAT_ID,
			title: "",
			sessionId: legacySessionId,
			createdAt: state.revision.syncedAt,
			agent: null,
			model: null,
			effort: null,
			kind: "review",
		};
		chats = [legacyChat, ...chats];
		reviewChats = [legacyChat];
	}

	const activeChatId = reviewChats.some(
		(chat) => chat.id === state.activeChatId,
	)
		? state.activeChatId
		: (reviewChats[0]?.id ?? null);
	const onePagerChats = chats.filter((chat) => chat.kind === "one-pager");
	const activeOnePagerChatId = onePagerChats.some(
		(chat) => chat.id === state.activeOnePagerChatId,
	)
		? state.activeOnePagerChatId
		: (onePagerChats.at(-1)?.id ?? null);
	if (
		chats === state.chats &&
		activeChatId === state.activeChatId &&
		activeOnePagerChatId === state.activeOnePagerChatId
	) {
		return state;
	}
	return { ...state, chats, activeChatId, activeOnePagerChatId };
}
export type ReviewState = z.infer<typeof ReviewStateSchema>;
