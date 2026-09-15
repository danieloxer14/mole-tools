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

export const ChatTagSchema = z.union([
	DiffChatTagSchema,
	MarkdownChatTagSchema,
	FileChatTagSchema,
]);
export type ChatTag = z.infer<typeof ChatTagSchema>;

export function isMarkdownChatTag(tag: ChatTag): tag is MarkdownChatTag {
	return "kind" in tag && tag.kind === "markdown";
}

export function isFileChatTag(tag: ChatTag): tag is FileChatTag {
	return "kind" in tag && tag.kind === "file";
}

/**
 * Structural equality across all three chat tag variants, for dedup/removal.
 * Path is always shared by the check; only the discriminating fields differ.
 */
export function chatTagsEqual(a: ChatTag, b: ChatTag): boolean {
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
