import { z } from "zod";

const NonEmptyString = z.string().min(1);

export const GitLabAuthorSchema = z
	.object({
		username: NonEmptyString.optional(),
		name: NonEmptyString.optional(),
	})
	.passthrough()
	.refine((author) => Boolean(author.username ?? author.name), {
		message: "GitLab author must include username or name",
	});

export const GitLabDiffRefsSchema = z
	.object({
		base_sha: NonEmptyString,
		start_sha: NonEmptyString,
		head_sha: NonEmptyString,
	})
	.passthrough();

export const GitLabMergeRequestSchema = z
	.object({
		iid: z.number().int().positive(),
		title: NonEmptyString,
		description: z.string().nullable(),
		web_url: z.string().url(),
		author: GitLabAuthorSchema,
		source_branch: NonEmptyString,
		target_branch: NonEmptyString,
		sha: NonEmptyString.optional(),
		diff_refs: GitLabDiffRefsSchema,
		state: NonEmptyString,
	})
	.passthrough();

const GitLabApprovalIdentitySchema = z.union([
	z.string().min(1),
	GitLabAuthorSchema,
	z.object({ user: GitLabAuthorSchema }).passthrough(),
]);

export const GitLabApprovalRuleSchema = z
	.object({
		name: NonEmptyString,
		approvals_required: z.number().int().nonnegative(),
		approvals_left: z.number().int().nonnegative().optional(),
		approved_by: z.array(GitLabApprovalIdentitySchema),
	})
	.passthrough();

export const GitLabApprovalStateSchema = z
	.object({
		user_has_approved: z.boolean().optional().default(false),
		approvals_left: z.number().int().nonnegative().nullable().optional(),
		approved_by: z.array(GitLabApprovalIdentitySchema),
		rules: z.array(GitLabApprovalRuleSchema).optional(),
	})
	.passthrough();

export const GitLabPositionSchema = z
	.object({
		old_path: z.string().nullable(),
		new_path: z.string().nullable(),
		old_line: z.number().int().nonnegative().nullable(),
		new_line: z.number().int().nonnegative().nullable(),
	})
	.passthrough();

const PositiveLine = z.number().int().positive().nullable();

const GitLabLineRangeEntrySchema = z
	.object({
		line_code: NonEmptyString,
		type: z.enum(["new", "old"]),
		old_line: PositiveLine,
		new_line: PositiveLine,
	})
	.passthrough()
	.refine(
		(entry) =>
			entry.type === "new" ? entry.new_line !== null : entry.old_line !== null,
		{
			message: "GitLab line range entry must include its selected side line",
		},
	);

export const GitLabPositionPayloadSchema = z
	.object({
		position_type: z.literal("text"),
		base_sha: NonEmptyString,
		start_sha: NonEmptyString,
		head_sha: NonEmptyString,
		old_path: z.string().min(1).nullable(),
		new_path: z.string().min(1).nullable(),
		old_line: PositiveLine,
		new_line: PositiveLine,
		line_range: z
			.object({
				start: GitLabLineRangeEntrySchema,
				end: GitLabLineRangeEntrySchema,
			})
			.passthrough()
			.optional(),
	})
	.passthrough()
	.refine(
		(position) => position.old_path !== null || position.new_path !== null,
		{
			message: "GitLab position must include old_path or new_path",
		},
	)
	.refine(
		(position) => (position.old_line === null) !== (position.new_line === null),
		{
			message: "GitLab position must anchor exactly one side",
		},
	)
	.refine(
		(position) =>
			(position.old_path !== null || position.old_line === null) &&
			(position.new_path !== null || position.new_line === null),
		{
			message: "GitLab position line must have a matching path",
		},
	)
	.refine(
		(position) => {
			const range = position.line_range;
			if (!range) return true;
			if (range.start.type !== range.end.type) return false;
			const side = range.end.type;
			const startLine =
				side === "new" ? range.start.new_line : range.start.old_line;
			const endLine = side === "new" ? range.end.new_line : range.end.old_line;
			if (startLine === null || endLine === null || startLine > endLine) {
				return false;
			}
			return side === "new"
				? position.new_line === endLine && position.old_line === null
				: position.old_line === endLine && position.new_line === null;
		},
		{
			message: "GitLab line range must be ordered and match its anchor side",
		},
	);

export const GitLabNoteSchema = z
	.object({
		id: z.union([NonEmptyString, z.number().int().nonnegative()]),
		author: GitLabAuthorSchema,
		body: z.string(),
		created_at: NonEmptyString,
		system: z.boolean(),
		resolved: z.boolean().optional().default(false),
		position: GitLabPositionSchema.nullable().optional().default(null),
	})
	.passthrough();

export const GitLabDiscussionSchema = z
	.object({
		id: z.union([NonEmptyString, z.number().int().nonnegative()]),
		notes: z.array(GitLabNoteSchema),
		resolved: z.boolean().optional(),
	})
	.passthrough();

export const GitLabDiscussionPageSchema = z.array(GitLabDiscussionSchema);

export type GitLabDiscussion = z.infer<typeof GitLabDiscussionSchema>;
