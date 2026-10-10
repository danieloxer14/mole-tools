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
export const GitLabAssigneeSchema = z
	.object({
		username: NonEmptyString,
	})
	.passthrough();

export const GitLabLabelSchema = z.union([
	NonEmptyString,
	z.object({ name: NonEmptyString }).passthrough(),
]);

export const GitLabPipelineSchema = z
	.object({
		sha: NonEmptyString.optional(),
		status: NonEmptyString.optional(),
	})
	.passthrough();

export const GitLabOpenedMergeRequestSchema = z
	.object({
		iid: z.number().int().positive(),
		web_url: z.string().url(),
		state: z.literal("opened"),
		assignees: z.array(GitLabAssigneeSchema),
	})
	.passthrough();

export const GitLabPipelinePageSchema = z.array(GitLabPipelineSchema);

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
		draft: z.boolean().optional(),
		labels: z.array(GitLabLabelSchema).optional(),
		detailed_merge_status: z.string().nullable().optional(),
		has_conflicts: z.boolean().optional(),
		head_pipeline: GitLabPipelineSchema.nullable().optional(),
	})
	.passthrough();
export const GitLabAutoApprovalMergeRequestSchema =
	GitLabMergeRequestSchema.extend({
		draft: z.boolean(),
		labels: z.array(GitLabLabelSchema),
		has_conflicts: z.boolean(),
	});
export type GitLabAutoApprovalMergeRequest = z.infer<
	typeof GitLabAutoApprovalMergeRequestSchema
>;

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

const PositiveLine = z.number().int().positive().nullable();

const GitLabDiscussionLineRangeEntrySchema = z
	.object({
		type: z.enum(["new", "old"]).nullable().optional(),
		old_line: PositiveLine,
		new_line: PositiveLine,
	})
	.passthrough()
	.refine(
		(entry) => {
			if (entry.type === "new") {
				return entry.new_line !== null;
			}

			if (entry.type === "old") {
				return entry.old_line !== null;
			}

			return entry.old_line !== null || entry.new_line !== null;
		},
		{
			message: "GitLab line range entry must include its selected side line",
		},
	);

export const GitLabPositionSchema = z
	.object({
		old_path: z.string().nullable(),
		new_path: z.string().nullable(),
		old_line: z
			.number()
			.int()
			.nonnegative()
			.nullable()
			.optional()
			.default(null),
		new_line: z
			.number()
			.int()
			.nonnegative()
			.nullable()
			.optional()
			.default(null),
		line_range: z
			.object({
				start: GitLabDiscussionLineRangeEntrySchema,
				end: GitLabDiscussionLineRangeEntrySchema,
			})
			.passthrough()
			.nullable()
			.optional(),
	})
	.passthrough();

export const GitLabNoteSchema = z
	.object({
		id: z.union([NonEmptyString, z.number().int().nonnegative()]),
		author: GitLabAuthorSchema,
		body: z.string(),
		created_at: NonEmptyString,
		system: z.boolean(),
		resolved: z.boolean().nullable().optional().default(false),
		position: GitLabPositionSchema.nullable().optional().default(null),
	})
	.passthrough();

export const GitLabDiscussionSchema = z
	.object({
		id: z.union([NonEmptyString, z.number().int().nonnegative()]),
		notes: z.array(GitLabNoteSchema),
		resolved: z.boolean().nullable().optional(),
		individual_note: z.boolean().optional(),
	})
	.passthrough();

export const GitLabDiscussionPageSchema = z.array(GitLabDiscussionSchema);

export type GitLabMergeRequest = z.infer<typeof GitLabMergeRequestSchema>;
export type GitLabOpenedMergeRequest = z.infer<
	typeof GitLabOpenedMergeRequestSchema
>;
export type GitLabLabel = z.infer<typeof GitLabLabelSchema>;
export type GitLabPipeline = z.infer<typeof GitLabPipelineSchema>;
export type GitLabDiscussion = z.infer<typeof GitLabDiscussionSchema>;
