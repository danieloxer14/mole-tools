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

export const ChatTagSchema = z.union([
	DiffChatTagSchema,
	MarkdownChatTagSchema,
]);
export type ChatTag = z.infer<typeof ChatTagSchema>;

export function isMarkdownChatTag(tag: ChatTag): tag is MarkdownChatTag {
	return "kind" in tag && tag.kind === "markdown";
}

/** Structural equality across both chat tag variants, for dedup/removal. */
export function chatTagsEqual(a: ChatTag, b: ChatTag): boolean {
	if (
		a.path !== b.path ||
		a.startLine !== b.startLine ||
		a.endLine !== b.endLine
	) {
		return false;
	}
	const aMarkdown = isMarkdownChatTag(a);
	const bMarkdown = isMarkdownChatTag(b);
	if (aMarkdown || bMarkdown) return aMarkdown && bMarkdown;
	return a.side === b.side && a.hunk === b.hunk;
}
