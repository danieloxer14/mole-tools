import { describe, expect, test } from "bun:test";
import { ReviewBabysitterConfigSchema } from "../../adapters/config/schema";
import type {
	HostDiscussion,
	MrApprovalState,
	MrAutoApprovalState,
} from "../../ports/git-host";
import type { FileDiff } from "../../ports/vcs";
import { evaluatePolicy } from "./policy";

const config = ReviewBabysitterConfigSchema.parse({
	assignees: ["owner"],
	aiReviewerUsername: "ai-reviewer",
	promptFile: "prompt.md",
	model: "model",
	webhookUrlEnv: "SLACK_WEBHOOK_URL",
	denyPathsByProject: { "group/project": [] },
});

const mr: MrAutoApprovalState["mr"] = {
	iid: 42,
	projectPath: "group/project",
	title: "Improve API",
	description: "Description",
	webUrl: "https://gitlab.example.com/group/project/-/merge_requests/42",
	author: "author",
	sourceBranch: "feature",
	targetBranch: "main",
	headSha: "head",
	diffRefs: { baseSha: "base", startSha: "start", headSha: "head" },
	state: "opened",
};

const approval: MrApprovalState = {
	approved: false,
	currentUser: "approver",
	approvalsLeft: 1,
	approvedBy: [],
	rules: [],
};

const readableDiff: FileDiff = {
	path: "src/app.ts",
	statOnly: false,
	patch: "@@ -1 +1 @@\n-old\n+new",
	insertions: 1,
	deletions: 1,
};

function aiNoteDiscussion(
	overrides: Partial<HostDiscussion> = {},
): HostDiscussion {
	return {
		id: "ai-discussion",
		resolved: true,
		position: null,
		notes: [
			{
				id: "ai-note",
				author: "ai-reviewer",
				body: "VERDICT: LOW",
				createdAt: "2026-08-30T00:00:00.000Z",
				system: false,
			},
		],
		...overrides,
	};
}

function base(overrides: Partial<PolicyInput> = {}): PolicyInput {
	return {
		state: {
			mr,
			draft: false,
			labels: [],
			detailedMergeStatus: "mergeable",
			hasConflicts: false,
			headPipelineStatus: "success",
		},
		discussions: [aiNoteDiscussion()],
		approval,
		diffs: [readableDiff],
		config,
		authenticatedUser: "approver",
		...overrides,
	};
}

function state(
	overrides: Partial<MrAutoApprovalState> = {},
): MrAutoApprovalState {
	return { ...base().state, ...overrides };
}

function diff(overrides: Partial<FileDiff> = {}): FileDiff {
	return { ...readableDiff, ...overrides };
}

describe("evaluatePolicy", () => {
	test("returns assess for complete safe input", () => {
		expect(evaluatePolicy(base())).toEqual({ kind: "assess" });
	});

	test.each([
		["draft", state({ draft: true }), "skip_draft"],
		["conflict", state({ hasConflicts: true }), "skip_conflict"],
		[
			"null merge status",
			state({ detailedMergeStatus: null }),
			"skip_merge_status",
		],
		[
			"unknown merge status",
			state({ detailedMergeStatus: "future" }),
			"skip_merge_status",
		],
		[
			"unsafe merge status",
			state({ detailedMergeStatus: "cannot_be_merged" }),
			"skip_merge_status",
		],
		[
			"failed pipeline",
			state({ headPipelineStatus: "failed" }),
			"skip_ci_failed",
		],
		[
			"pending pipeline",
			state({ headPipelineStatus: "pending" }),
			"skip_ci_not_ready",
		],
		[
			"running pipeline",
			state({ headPipelineStatus: "running" }),
			"skip_ci_not_ready",
		],
		[
			"manual pipeline",
			state({ headPipelineStatus: "manual" }),
			"skip_ci_not_ready",
		],
		[
			"unknown pipeline",
			state({ headPipelineStatus: "future" }),
			"skip_ci_not_ready",
		],
	] as const)("blocks %s", (_name, candidate, expected) => {
		expect(evaluatePolicy(base({ state: candidate }))).toEqual({
			kind: expected,
		});
	});

	test("permits not_approved merge status because tool supplies approval", () => {
		expect(
			evaluatePolicy(
				base({ state: state({ detailedMergeStatus: "not_approved" }) }),
			),
		).toEqual({ kind: "assess" });
	});

	test("permits an MR with no configured pipeline", () => {
		expect(
			evaluatePolicy(
				base({ state: state({ headPipelineStatus: "not_configured" }) }),
			),
		).toEqual({ kind: "assess" });
	});

	test("reports GitLab unresolved discussion status before other checks", () => {
		expect(
			evaluatePolicy(
				base({
					state: state({ detailedMergeStatus: "discussions_not_resolved" }),
				}),
			),
		).toEqual({ kind: "skip_discussions_not_resolved" });
	});

	test.each([
		["missing AI note", [], "queue_ai_review"],
		[
			"case-insensitive AI note",
			[
				aiNoteDiscussion({
					notes: [
						{
							id: "ai-note",
							author: "AI-REVIEWER",
							body: "done",
							createdAt: "2026-08-30T00:00:00.000Z",
							system: false,
						},
					],
				}),
			],
			"assess",
		],
	] as const)("handles %s", (_name, discussions, expected) => {
		expect(evaluatePolicy(base({ discussions }))).toEqual({ kind: expected });
	});

	test("present ai-review label waits even when configured AI note exists", () => {
		expect(
			evaluatePolicy(
				base({ state: state({ labels: ["backend", "AI-REVIEW"] }) }),
			),
		).toEqual({ kind: "wait_ai_review" });
	});

	test("resolved and system-only discussions do not block", () => {
		const systemDiscussion: HostDiscussion = {
			id: "system-discussion",
			resolved: false,
			position: null,
			notes: [
				{
					id: "system",
					author: "gitlab",
					body: "system note",
					createdAt: "2026-08-30T00:00:00.000Z",
					system: true,
				},
			],
		};
		expect(
			evaluatePolicy(
				base({ discussions: [aiNoteDiscussion(), systemDiscussion] }),
			),
		).toEqual({
			kind: "assess",
		});
		expect(
			evaluatePolicy(
				base({ discussions: [aiNoteDiscussion({ resolved: false })] }),
			),
		).toEqual({
			kind: "block_discussion",
		});
	});

	test("ignores standalone global MR notes when checking open threads", () => {
		const globalNote: HostDiscussion = {
			id: "global-note",
			resolved: false,
			individualNote: true,
			position: null,
			notes: [
				{
					id: "human-note",
					author: "reviewer",
					body: "global comment",
					createdAt: "2026-08-30T00:00:00.000Z",
					system: false,
				},
			],
		};
		expect(
			evaluatePolicy(base({ discussions: [aiNoteDiscussion(), globalNote] })),
		).toEqual({ kind: "assess" });
	});

	test("skips self-authored and already-approved merge requests", () => {
		expect(
			evaluatePolicy(
				base({ state: state({ mr: { ...mr, author: "APPROVER" } }) }),
			),
		).toEqual({ kind: "skip_self_approval" });
		expect(
			evaluatePolicy(
				base({ approval: { ...approval, approvedBy: ["APPROVER"] } }),
			),
		).toEqual({ kind: "skip_already_approved" });
		expect(
			evaluatePolicy(base({ approval: { ...approval, approved: true } })),
		).toEqual({ kind: "skip_already_approved" });
	});

	test.each([
		["null diff", null],
		["stat-only", [diff({ statOnly: true })]],
		["missing patch", [diff({ patch: null })]],
		[
			"binary marker",
			[diff({ patch: "Binary files a/a.bin and b/a.bin differ" })],
		],
		["binary flag", [{ ...diff(), binary: true }]],
		["missing insertion count", [{ ...diff(), insertions: undefined }]],
		["non-finite deletion count", [diff({ deletions: Number.NaN })]],
		["fractional insertion count", [diff({ insertions: 1.5 })]],
		["negative deletion count", [diff({ deletions: -1 })]],
		["empty path", [diff({ path: "" })]],
		["traversal path", [diff({ path: "../secret" })]],
		["absolute path", [diff({ path: "/etc/passwd" })]],
	] as const)("rejects %s", (_name, diffs) => {
		expect(evaluatePolicy(base({ diffs: diffs as FileDiff[] | null }))).toEqual(
			{
				kind: "block_diff_unreadable",
			},
		);
	});

	test.each([
		["default equality", 250, 250, "assess"],
		["default one over", 251, 250, "block_change_limit"],
		["zero equality", 0, 0, "assess"],
		["zero one over", 1, 0, "block_change_limit"],
	] as const)("uses strict line limit: %s", (_name, total, limit, expected) => {
		const customConfig = { ...config, maxChangedLines: limit };
		const evaluated = evaluatePolicy(
			base({
				config: customConfig,
				diffs: [diff({ insertions: total, deletions: 0 })],
			}),
		);
		expect(evaluated).toMatchObject({ kind: expected });
		if (expected === "block_change_limit") {
			expect(evaluated).toEqual({
				kind: "block_change_limit",
				changedLines: total,
				maxChangedLines: limit,
			});
		}
	});

	test.each([
		["equal", 1, 1, "assess"],
		["one over", 2, 1, "block_file_limit"],
		["zero equality", 0, 0, "assess"],
		["zero one over", 1, 0, "block_file_limit"],
	] as const)("uses strict file limit: %s", (_name, fileCount, limit, expected) => {
		const diffs = Array.from({ length: fileCount }, (_, index) =>
			diff({ path: `src/file-${index}.ts`, insertions: 0, deletions: 0 }),
		);
		const customConfig = { ...config, maxChangedFiles: limit };
		const evaluated = evaluatePolicy(base({ config: customConfig, diffs }));
		expect(evaluated).toMatchObject({ kind: expected });
		if (expected === "block_file_limit") {
			expect(evaluated).toEqual({
				kind: "block_file_limit",
				changedFiles: fileCount,
				maxChangedFiles: limit,
			});
		}
	});

	test("requires exact project deny-list entry and accepts explicit empty entry", () => {
		expect(
			evaluatePolicy(base({ config: { ...config, denyPathsByProject: {} } })),
		).toEqual({
			kind: "block_missing_denylist",
		});
		expect(evaluatePolicy(base())).toEqual({ kind: "assess" });
	});

	test("reports first matching path and glob using Bun.Glob", () => {
		const customConfig = {
			...config,
			denyPathsByProject: {
				"group/project": ["docs/**", "src/**", "src/app.ts"],
			},
		};
		expect(evaluatePolicy(base({ config: customConfig }))).toEqual({
			kind: "block_deny_path",
			path: "src/app.ts",
			glob: "src/**",
		});
		expect(
			evaluatePolicy(
				base({
					config: {
						...config,
						denyPathsByProject: { "group/project": ["docs/**"] },
					},
				}),
			),
		).toEqual({ kind: "assess" });
	});

	test("returns first result in every exhaustive lower-failure combination", () => {
		const failures = [
			["skip_draft", { state: state({ draft: true }) }],
			["skip_conflict", { state: state({ hasConflicts: true }) }],
			[
				"skip_merge_status",
				{ state: state({ detailedMergeStatus: "blocked_status" }) },
			],
			["skip_ci_failed", { state: state({ headPipelineStatus: "failed" }) }],
			[
				"skip_ci_not_ready",
				{ state: state({ headPipelineStatus: "pending" }) },
			],
			["queue_ai_review", { discussions: [] }],
			["wait_ai_review", { state: state({ labels: ["ai-review"] }) }],
			[
				"block_discussion",
				{
					discussions: [
						aiNoteDiscussion(),
						{
							id: "open",
							resolved: false,
							position: null,
							notes: [
								{
									id: "note",
									author: "reviewer",
									body: "fix",
									createdAt: "2026-08-30T00:00:00.000Z",
									system: false,
								},
							],
						},
					],
				},
			],
			[
				"skip_self_approval",
				{ state: state({ mr: { ...mr, author: "approver" } }) },
			],
			["skip_already_approved", { approval: { ...approval, approved: true } }],
			["block_diff_unreadable", { diffs: [diff({ patch: null })] }],
			[
				"block_change_limit",
				{ diffs: [diff({ insertions: 251, deletions: 0 })] },
			],
			[
				"block_file_limit",
				{
					diffs: Array.from({ length: 11 }, (_, index) =>
						diff({ path: `src/file-${index}.ts`, insertions: 0, deletions: 0 }),
					),
				},
			],
			[
				"block_missing_denylist",
				{ config: { ...config, denyPathsByProject: {} } },
			],
			[
				"block_deny_path",
				{
					config: {
						...config,
						denyPathsByProject: { "group/project": ["src/**"] },
					},
				},
			],
		] as const;
		for (let index = 0; index < failures.length; index++) {
			const [expectedKind, ownFailure] = failures[index];
			const lower: Partial<PolicyInput> = {};
			for (const [, failure] of failures.slice(index + 1))
				Object.assign(lower, failure);
			expect(evaluatePolicy(base({ ...lower, ...ownFailure })).kind).toBe(
				expectedKind,
			);
		}
	});
});
