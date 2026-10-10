import { z } from "zod";

const NonEmptyString = z.string().min(1);

export const GhUserSchema = z
	.object({
		id: z.number(),
		login: NonEmptyString,
		name: z.string().nullable().optional(),
	})
	.passthrough();

export const GhTeamSchema = z
	.object({
		id: z.number(),
		name: NonEmptyString,
	})
	.passthrough();

export const GhUserSearchSchema = z
	.object({
		items: z.array(
			z
				.object({
					login: NonEmptyString,
				})
				.passthrough(),
		),
	})
	.passthrough();
export const GhPullRequestUrlListSchema = z.array(
	z
		.object({
			url: z.string().refine((url) => url.trim().length > 0),
		})
		.passthrough(),
);
const GhNullableLoginSchema = z
	.object({ login: NonEmptyString })
	.passthrough()
	.nullable();
const GhCommentFieldsSchema = z
	.object({
		id: z.number(),
		user: GhNullableLoginSchema,
		body: z.string(),
		created_at: z.string(),
	})
	.passthrough();

export const GhIssueCommentSchema = GhCommentFieldsSchema;

export const GhReviewThreadPageSchema = z
	.object({
		data: z
			.object({
				repository: z
					.object({
						pullRequest: z
							.object({
								reviewThreads: z
									.object({
										nodes: z.array(
											z
												.object({
													isResolved: z.boolean(),
													path: z.string(),
													line: z.number().nullable(),
													originalLine: z.number().nullable(),
													diffSide: z.enum(["LEFT", "RIGHT"]),
													comments: z
														.object({
															nodes: z.array(
																z
																	.object({
																		databaseId: z.number(),
																		author: GhNullableLoginSchema,
																		body: z.string(),
																		createdAt: z.string(),
																	})
																	.passthrough(),
															),
														})
														.passthrough(),
												})
												.passthrough(),
										),
									})
									.passthrough(),
							})
							.passthrough(),
					})
					.passthrough(),
			})
			.passthrough(),
	})
	.passthrough();

export const GhReviewThreadPagesSchema = z.array(GhReviewThreadPageSchema);

export const GhIssueCommentPagesSchema = z.array(z.array(GhIssueCommentSchema));

export const GhReviewPagesSchema = z.array(
	z.array(
		z
			.object({
				id: z.number(),
				user: GhNullableLoginSchema,
				body: z.string().nullable(),
				state: NonEmptyString,
				submitted_at: z.string().nullish(),
			})
			.passthrough(),
	),
);

export const GhPullRequestSchema = z
	.object({
		number: z.number(),
		title: NonEmptyString,
		body: z.string().nullable(),
		html_url: NonEmptyString,
		state: NonEmptyString,
		merged_at: z.string().nullable(),
		user: z.object({ login: NonEmptyString }).passthrough(),
		head: z.object({ ref: NonEmptyString, sha: NonEmptyString }).passthrough(),
		base: z.object({ ref: NonEmptyString, sha: NonEmptyString }).passthrough(),
	})
	.passthrough();

export const GhCompareSchema = z
	.object({
		merge_base_commit: z.object({ sha: NonEmptyString }).passthrough(),
	})
	.passthrough();
export const GhReviewCommentSchema = GhCommentFieldsSchema.extend({
	path: NonEmptyString,
	side: z.enum(["LEFT", "RIGHT"]).nullable(),
	line: z.number().nullable(),
	original_line: z.number().nullable(),
}).passthrough();
