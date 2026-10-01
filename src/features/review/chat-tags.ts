import { z } from "zod";

/**
 * Chat tag anchored to a diff line (side/hunk required). Kept dependency-free
 * (no Node builtins) so client bundles — `main.tsx`, `ChatPane.tsx` — can
 * import it directly without pulling in `store.ts`'s `node:fs`/`node:path`
 * imports.
 */
export const DiffChatTagSchema = z
	.object({
		path: z.string().min(1),
		side: z.enum(["new", "old"]),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
		hunk: z.string().min(1),
	})
	.strict()
	.refine((tag) => tag.endLine >= tag.startLine, {
		message: "endLine must be greater than or equal to startLine",
		path: ["endLine"],
	});
export type DiffChatTag = z.infer<typeof DiffChatTagSchema>;

/**
 * Chat tag anchored to a rendered-markdown block instead of a diff line.
 * Rendered blocks have no diff side/hunk, so this carries the source line
 * range plus an optional quote for display.
 */
export const MarkdownChatTagSchema = z
	.object({
		kind: z.literal("markdown"),
		path: z.string().min(1),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
		quote: z.string().optional(),
	})
	.strict()
	.refine((tag) => tag.endLine >= tag.startLine, {
		message: "endLine must be greater than or equal to startLine",
		path: ["endLine"],
	});
export type MarkdownChatTag = z.infer<typeof MarkdownChatTagSchema>;

/**
 * Path-only chat tag asking the agent to inspect an entire file. Deliberately
 * has no line range: binary, collapsed, renamed, deleted, or stat-only files
 * can lack a valid diff position.
 */
export const FileChatTagSchema = z
	.object({
		kind: z.literal("file"),
		path: z.string().min(1),
	})
	.strict();
export type FileChatTag = z.infer<typeof FileChatTagSchema>;

/** Build a validated tag for a non-file markdown context. */
function markdownContextChatTagSchema<
	TKind extends "description" | "one-pager",
>(kind: TKind) {
	return z
		.object({
			kind: z.literal(kind),
			startLine: z.number().int().positive().optional(),
			endLine: z.number().int().positive().optional(),
			quote: z.string().min(1),
		})
		.strict()
		.refine(
			(tag) => (tag.startLine === undefined) === (tag.endLine === undefined),
			{
				message: "startLine and endLine must both be present or both absent",
				path: ["endLine"],
			},
		)
		.refine(
			(tag) =>
				tag.startLine === undefined ||
				tag.endLine === undefined ||
				tag.endLine >= tag.startLine,
			{
				message: "endLine must be greater than or equal to startLine",
				path: ["endLine"],
			},
		);
}

/** Chat tag anchored to the merge request description, never a file. */
export const DescriptionChatTagSchema =
	markdownContextChatTagSchema("description");
export type DescriptionChatTag = z.infer<typeof DescriptionChatTagSchema>;
/** Chat tag anchored to the one-pager document, never a file. */
export const OnePagerChatTagSchema = markdownContextChatTagSchema("one-pager");
export type OnePagerChatTag = z.infer<typeof OnePagerChatTagSchema>;

export const ChatTagSchema = z.union([
	DiffChatTagSchema,
	MarkdownChatTagSchema,
	FileChatTagSchema,
	DescriptionChatTagSchema,
	OnePagerChatTagSchema,
]);
export type ChatTag = z.infer<typeof ChatTagSchema>;

export function isDescriptionChatTag(tag: ChatTag): tag is DescriptionChatTag {
	return "kind" in tag && tag.kind === "description";
}

export function isOnePagerChatTag(tag: ChatTag): tag is OnePagerChatTag {
	return "kind" in tag && tag.kind === "one-pager";
}

export function isMarkdownChatTag(tag: ChatTag): tag is MarkdownChatTag {
	return "kind" in tag && tag.kind === "markdown";
}

export function isFileChatTag(tag: ChatTag): tag is FileChatTag {
	return "kind" in tag && tag.kind === "file";
}

/**
 * Structural equality across all five chat tag variants, for dedup/removal.
 * Path is shared by the file, markdown and diff variants.
 */
export function chatTagsEqual(a: ChatTag, b: ChatTag): boolean {
	if (isOnePagerChatTag(a) || isOnePagerChatTag(b)) {
		return (
			isOnePagerChatTag(a) &&
			isOnePagerChatTag(b) &&
			a.startLine === b.startLine &&
			a.endLine === b.endLine
		);
	}
	if (isDescriptionChatTag(a) || isDescriptionChatTag(b)) {
		return (
			isDescriptionChatTag(a) &&
			isDescriptionChatTag(b) &&
			a.startLine === b.startLine &&
			a.endLine === b.endLine
		);
	}
	if (a.path !== b.path) return false;
	const aFile = isFileChatTag(a);
	const bFile = isFileChatTag(b);
	if (aFile || bFile) return aFile && bFile;
	const aMarkdown = isMarkdownChatTag(a);
	const bMarkdown = isMarkdownChatTag(b);
	if (aMarkdown || bMarkdown) return aMarkdown && bMarkdown;
	return (
		a.startLine === b.startLine &&
		a.endLine === b.endLine &&
		a.side === b.side &&
		a.hunk === b.hunk
	);
}
