import { z } from "zod";

export const CHAT_TITLE_MAX = 48;

/**
 * Chat ids reach the filesystem as `chats/<id>.ndjson`, so the character set is
 * deliberately narrow: no dot, no slash, therefore no traversal.
 */
export const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Id given to the conversation adopted from a pre-multi-chat review. */
export const LEGACY_CHAT_ID = "legacy";

export const ChatMetaSchema = z.object({
	id: z.string().regex(CHAT_ID_PATTERN),
	title: z.string().default(""),
	sessionId: z.string().min(1).nullable().default(null),
	createdAt: z.string().min(1),
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
	bdd: z.array(z.string().min(1)).default([]),
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
	mr: z.object({
		host: z.string(),
		projectPath: z.string(),
		iid: z.number().int().positive(),
		webUrl: z.string(),
		title: z.string(),
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
	/**
	 * Legacy single-conversation session id, kept only so v1 state files written
	 * before multiple chats still parse. The legacy `chatSessionId` is consumed
	 * by file-boundary migration and every write afterwards stores null.
	 */
	chatSessionId: LegacyChatSessionSchema,
	chats: z.array(ChatMetaSchema).default([]),
	activeChatId: z.string().nullable().default(null),
	drafts: z.array(DraftSchema).default([]),
});

export function deriveChatTitle(message: string): string {
	const collapsed = message.replace(/\s+/g, " ").trim();
	if (collapsed.length <= CHAT_TITLE_MAX) return collapsed;
	return `${collapsed.slice(0, CHAT_TITLE_MAX).trimEnd()}…`;
}

export function createChatMeta(
	now: string = new Date().toISOString(),
): ChatMeta {
	return {
		id: crypto.randomUUID(),
		title: "",
		sessionId: null,
		createdAt: now,
	};
}

/**
 * Normalize the multi-chat fields of a v1 state document.
 *
 * Deterministic and idempotent — it never mints a random id, so it is safe to
 * run on every read without persisting. Guarantees `chats` holds at least one
 * entry and `activeChatId` names one of them, so every other caller may assume
 * both. A legacy session id supplied by the file-boundary migration is assigned
 * to the adopted chat.
 */
export function ensureChats(
	state: ReviewState,
	legacySessionId: string | null = null,
): ReviewState {
	const chats: ChatMeta[] =
		state.chats.length > 0
			? state.chats
			: [
					{
						id: LEGACY_CHAT_ID,
						title: "",
						sessionId: legacySessionId,
						createdAt: state.revision.syncedAt,
					},
				];
	const activeChatId = chats.some((chat) => chat.id === state.activeChatId)
		? state.activeChatId
		: (chats[0]?.id ?? null);
	if (chats === state.chats && activeChatId === state.activeChatId) {
		return state;
	}
	return { ...state, chats, activeChatId };
}
export type ReviewState = z.infer<typeof ReviewStateSchema>;
