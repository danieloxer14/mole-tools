import { describe, expect, test } from "bun:test";
import { FakeGitHost } from "../../../test/fakes/FakeGitHost";
import { FakeNotifier } from "../../../test/fakes/FakeNotifier";
import { FakeUiPort } from "../../../test/fakes/FakeUiPort";
import { fakeContext } from "../../../test/fakes/fakeContext";
import type { ReviewBabysitterConfig } from "../../adapters/config/schema";
import { ReviewBabysitterConfigSchema } from "../../adapters/config/schema";
import type {
	HostDiscussion,
	MrApprovalState,
	MrAutoApprovalState,
} from "../../ports/git-host";
import type { FileDiff } from "../../ports/vcs";
import type { AssessmentResult } from "./assessment";
import {
	reviewBabysitter,
	runOneLoop,
	runScheduler,
	type SignalSource,
} from "./index";
import { formatReportLine, type ReportMr, type ReportResult } from "./report";

const config = ReviewBabysitterConfigSchema.parse({
	assignees: ["alice"],
	aiReviewerUsername: "ai-reviewer",
	promptFile: "prompt.md",
	model: "risk-model",
	webhookUrlEnv: "SLACK_WEBHOOK_URL",
	denyPathsByProject: { "group/api": [] },
});

const ref = {
	host: "gitlab.example.com",
	projectPath: "group/api",
	iid: 42,
};

const metadata: ReportMr = {
	webUrl: "https://gitlab.example.com/group/api/-/merge_requests/42",
	projectPath: "group/api",
	iid: 42,
	title: "Improve API",
	assignees: ["alice", "bob"],
};

const diff: FileDiff = {
	path: "src/api.ts",
	statOnly: false,
	patch: "@@ -1 +1 @@",
	insertions: 1,
	deletions: 1,
};

const approval: MrApprovalState = {
	approved: false,
	currentUser: "approver",
	approvalsLeft: 1,
	approvedBy: [],
	rules: [],
};

function state(
	overrides: Partial<MrAutoApprovalState> = {},
): MrAutoApprovalState {
	return {
		mr: {
			iid: ref.iid,
			projectPath: ref.projectPath,
			title: metadata.title,
			description: "",
			webUrl: metadata.webUrl,
			author: "author",
			sourceBranch: "feature/api",
			targetBranch: "main",
			headSha: "head-sha",
			diffRefs: {
				baseSha: "base-sha",
				startSha: "base-sha",
				headSha: "head-sha",
			},
			state: "opened",
		},
		draft: false,
		labels: [],
		detailedMergeStatus: "mergeable",
		hasConflicts: false,
		headPipelineStatus: "success",
		...overrides,
	};
}

const completeDiscussion = {
	id: "ai",
	resolved: true,
	position: null,
	notes: [
		{
			id: "ai-note",
			author: "ai-reviewer",
			body: "done",
			createdAt: "2026-08-30T00:00:00.000Z",
			system: false,
		},
	],
};

const unresolvedDiscussion: HostDiscussion = {
	id: "human",
	resolved: false,
	position: null,
	notes: [
		{
			id: "human-note",
			author: "reviewer",
			body: "please fix",
			createdAt: "2026-08-30T00:00:00.000Z",
			system: false,
		},
	],
};

function reportCase(result: ReportResult): string {
	return formatReportLine(result, metadata);
}

describe("review-babysitter descriptor", () => {
	test("uses exact command and help metadata", () => {
		expect(reviewBabysitter.name).toBe("review-babysitter");
		expect(reviewBabysitter.description).toBe(
			"Periodically assess and safely approve configured GitLab merge requests",
		);
		expect(reviewBabysitter.help).toEqual({
			usage: "mole-tools review-babysitter",
			examples: ["mole-tools review-babysitter"],
			notes: [
				"Requires reviewBabysitter config, authenticated glab, OMP, and its Slack webhook environment variable.",
				"Configuration: intervalSeconds defaults to 900 seconds and must be at least 60; configure assignees, aiReviewerUsername, promptFile, model, webhookUrlEnv, maxChangedLines (default 250), maxChangedFiles (default 10), and denyPathsByProject.",
				"Lifecycle: starts one scan immediately, processes merge requests serially, waits after each completed scan, and stops cleanly on SIGINT or SIGTERM without starting another scan.",
				"Limits and deny-list: change and file limits are strict upper bounds where equality is allowed; every project needs an exact denyPathsByProject entry, [] explicitly denies no paths, and matching changed paths block approval.",
				"Existing auto-approval or satisfied approval requirements skip diff, deny-list, and AI gates; merge blockers and remaining required approvals are still reported.",
				"Non-goals: does not post review comments, add a requires-review label, remove labels, change assignees, rerun CI, merge requests, retry prompts or approvals, or replace interactive review.",
			],
		});
		expect(reviewBabysitter.args.parse({})).toEqual({});
		expect(() => reviewBabysitter.args.parse({ extra: true })).toThrow();
	});
});

describe("report formatter", () => {
	const cases: Array<[string, ReportResult, string]> = [
		[
			"draft",
			{ kind: "skip_draft" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⏭️ This MR is draft. Mark it ready when work is ready.",
		],
		[
			"conflict",
			{ kind: "skip_conflict" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⛔ GitLab reports merge conflicts. Resolve them.",
		],

		[
			"unresolved discussions",
			{ kind: "skip_discussions_not_resolved" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n💬 GitLab reports unresolved discussions. Resolve open discussions.",
		],
		[
			"merge status",
			{ kind: "skip_merge_status" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⛔ GitLab reports unresolved mergeability status.",
		],
		[
			"failed CI",
			{ kind: "skip_ci_failed" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n❌ Head pipeline is failing. Fix failing jobs.",
		],
		[
			"pending CI",
			{ kind: "skip_ci_not_ready" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⏳ Head pipeline is not successful yet.",
		],
		[
			"queue",
			{ kind: "queue_ai_review" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n🏷️ AI review requested.",
		],
		[
			"waiting",
			{ kind: "wait_ai_review" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⏳ AI review is in progress.",
		],
		[
			"discussion",
			{ kind: "block_discussion" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n💬 Open discussion needs resolution.",
		],
		[
			"self",
			{ kind: "skip_self_approval" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⏭️ Authenticated approver is MR author.",
		],
		[
			"already approved",
			{ kind: "skip_already_approved" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⏭️ Authenticated approver already approved this MR.",
		],
		[
			"unreadable",
			{ kind: "block_diff_unreadable" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⚠️ Not eligible for auto-approval: diff cannot be safely evaluated.",
		],
		[
			"line limit",
			{ kind: "block_change_limit", changedLines: 251, maxChangedLines: 250 },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⚠️ Not eligible for auto-approval: total changes exceed 250.",
		],
		[
			"file limit",
			{ kind: "block_file_limit", changedFiles: 11, maxChangedFiles: 10 },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⚠️ Not eligible for auto-approval: changed files exceed 10.",
		],
		[
			"missing deny list",
			{ kind: "block_missing_denylist" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⚠️ Not eligible for auto-approval: no deny-list config exists for this project.",
		],
		[
			"denied path",
			{ kind: "block_deny_path", path: "src/auth.ts", glob: "src/auth/**" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⚠️ Not eligible for auto-approval: changed path src/auth.ts matches denied glob src/auth/**.",
		],
		[
			"risk",
			{ kind: "assessment_risk", risk: "HIGH", reason: "unsafe" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⚠️ Not eligible for auto-approval: AI assessed HIGH risk: unsafe.",
		],
		[
			"inconclusive",
			{ kind: "assessment_inconclusive" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n⚠️ Not eligible for auto-approval: AI assessment is inconclusive.",
		],
		[
			"approval rejected",
			{ kind: "approval_rejected" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n❌ Approval was not applied.",
		],
		[
			"approved",
			{ kind: "approved" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n✅ Auto-approved after low-risk AI assessment.",
		],
		[
			"error",
			{ kind: "error", error: "temporary failure" },
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice, @bob — Improve API\n❌ Check could not complete: temporary failure.",
		],
	];

	test.each(
		cases,
	)("renders %s with exact envelope and friendly fact", (_name, result, expected) => {
		expect(reportCase(result)).toBe(expected);
	});

	test("escapes dynamic display values but preserves link target", () => {
		const line = formatReportLine(
			{ kind: "assessment_risk", risk: "HIGH", reason: "<unsafe> & check" },
			{
				...metadata,
				title: "A <title> & change",
				projectPath: "group/<api>",
				assignees: ["a&b"],
			},
		);
		expect(line).toContain(
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/&lt;api&gt;!42>",
		);
		expect(line).toContain("A &lt;title&gt; &amp; change");
		expect(line).toContain("@a&amp;b");
		expect(line).toContain("&lt;unsafe&gt; &amp; check");
	});
});

describe("runOneLoop", () => {
	test("uses first precedence gate and does not fetch lower-stage inputs", async () => {
		const calls: string[] = [];
		const host = new FakeGitHost({
			listOpenedMrsForAssignees: async () => [{ ref, assignees: ["alice"] }],
			fetchAutoApprovalState: async () => {
				calls.push("state");
				return state({ draft: true });
			},
			listDiscussions: async () => {
				calls.push("discussions");
				return [];
			},
			fetchApprovalState: async () => {
				calls.push("approval");
				return approval;
			},
		});
		const notifier = new FakeNotifier();
		const result = await runOneLoop(fakeContext({ gitHost: host }), {
			config,
			notifier,
		});
		expect(calls).toEqual(["state"]);
		expect(result.lines[0]).toContain("This MR is draft.");
	});

	test("checks approval before applying the active AI review gate", async () => {
		let approvalCalls = 0;
		let discussionCalls = 0;
		const host = new FakeGitHost({
			listOpenedMrsForAssignees: async () => [{ ref, assignees: ["alice"] }],
			fetchAutoApprovalState: async () => state({ labels: ["ai-review"] }),
			fetchApprovalState: async () => {
				approvalCalls++;
				return approval;
			},
			listDiscussions: async () => {
				discussionCalls++;
				return [];
			},
		});
		const result = await runOneLoop(fakeContext({ gitHost: host }), {
			config,
			notifier: new FakeNotifier(),
		});
		expect(approvalCalls).toBe(1);
		expect(discussionCalls).toBe(1);
		expect(result.lines).toEqual([
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice — Improve API\n⏳ AI review is in progress.",
		]);
	});

	test.each([
		[
			"auto-approver already approved",
			{ ...approval, approved: true, approvalsLeft: 1 },
			"1 required approval remains before merge.",
		],
		[
			"required approvals already satisfied",
			{ ...approval, approved: false, approvalsLeft: 0 },
			"Required approvals are satisfied; no auto-approval needed.",
		],
	] as const)("skips auto-approval gates when %s", async (_name, existingApproval, expectedText) => {
		const calls: string[] = [];
		const host = new FakeGitHost({
			listOpenedMrsForAssignees: async () => [{ ref, assignees: ["alice"] }],
			fetchAutoApprovalState: async () => state({ labels: ["ai-review"] }),
			fetchApprovalState: async () => {
				calls.push("approval");
				return existingApproval;
			},
			listDiscussions: async () => {
				calls.push("discussions");
				return [completeDiscussion];
			},
		});
		const result = await runOneLoop(fakeContext({ gitHost: host }), {
			config,
			notifier: new FakeNotifier(),
			loadDiff: async () => {
				calls.push("diff");
				throw new Error("diff must be skipped");
			},
			assessRisk: async () => {
				calls.push("assess");
				throw new Error("assessment must be skipped");
			},
		});
		expect(calls).toEqual(["approval", "discussions"]);
		expect(result.text).toContain(expectedText);
	});

	test("keeps merge blockers when approval requirements are already satisfied", async () => {
		const calls: string[] = [];
		const host = new FakeGitHost({
			listOpenedMrsForAssignees: async () => [{ ref, assignees: ["alice"] }],
			fetchAutoApprovalState: async () => state({ labels: ["ai-review"] }),
			fetchApprovalState: async () => {
				calls.push("approval");
				return { ...approval, approved: false, approvalsLeft: 0 };
			},
			listDiscussions: async () => {
				calls.push("discussions");
				return [unresolvedDiscussion];
			},
		});
		const result = await runOneLoop(fakeContext({ gitHost: host }), {
			config,
			notifier: new FakeNotifier(),
			loadDiff: async () => {
				throw new Error("diff must be skipped");
			},
		});
		expect(calls).toEqual(["approval", "discussions"]);
		expect(result.text).toContain("Open discussion needs resolution.");
	});

	test("queues missing AI review with exactly one label mutation", async () => {
		const labels: string[] = [];
		const host = new FakeGitHost({
			listOpenedMrsForAssignees: async () => [{ ref, assignees: ["alice"] }],
			fetchAutoApprovalState: async () => state(),
			listDiscussions: async () => [],
			addMrLabel: async (_ref, label) => labels.push(label),
		});
		const notifier = new FakeNotifier();
		const result = await runOneLoop(fakeContext({ gitHost: host }), {
			config,
			notifier,
		});
		expect(labels).toEqual(["ai-review"]);
		expect(result.text).toContain("AI review requested.");
		expect(notifier.messages).toHaveLength(1);
	});

	test("approves only after assess returns low", async () => {
		let approvalCalls = 0;
		let assessCalls = 0;
		const host = new FakeGitHost({
			listOpenedMrsForAssignees: async () => [{ ref, assignees: ["alice"] }],
			fetchAutoApprovalState: async () => state(),
			listDiscussions: async () => [completeDiscussion],
			fetchApprovalState: async () => approval,
			approveMr: async () => {
				approvalCalls++;
				return { ...approval, approved: true };
			},
		});
		const result = await runOneLoop(fakeContext({ gitHost: host }), {
			config,
			notifier: new FakeNotifier(),
			loadDiff: async () => [diff],
			assessRisk: async () => {
				assessCalls++;
				return { kind: "low", reason: "safe" };
			},
		});
		expect(assessCalls).toBe(1);
		expect(approvalCalls).toBe(1);
		expect(result.text).toContain(
			"Current user approval applied; 1 required approval remains.",
		);
	});

	test("reports approval rejection when GitLab returns an unapproved state", async () => {
		let approvalCalls = 0;
		const host = new FakeGitHost({
			listOpenedMrsForAssignees: async () => [{ ref, assignees: ["alice"] }],
			fetchAutoApprovalState: async () => state(),
			listDiscussions: async () => [completeDiscussion],
			fetchApprovalState: async () => approval,
			approveMr: async () => {
				approvalCalls++;
				return { ...approval, approved: false };
			},
		});
		const result = await runOneLoop(fakeContext({ gitHost: host }), {
			config,
			notifier: new FakeNotifier(),
			loadDiff: async () => [diff],
			assessRisk: async () => ({ kind: "low", reason: "safe" }),
		});
		expect(approvalCalls).toBe(1);
		expect(result.lines).toEqual([
			"<https://gitlab.example.com/group/api/-/merge_requests/42|group/api!42> — @alice — Improve API\n❌ Approval was not applied.",
		]);
	});

	test("keeps first matching report priority when every lower stage is unsafe", async () => {
		type FailureStage =
			| "discussions"
			| "approval"
			| "diff"
			| "assess"
			| "approve";
		type Fixture = {
			name: string;
			expected: ReportResult;
			stateOverrides?: Partial<MrAutoApprovalState>;
			discussions?: HostDiscussion[];
			approval?: MrApprovalState;
			diffs?: FileDiff[];
			config?: ReviewBabysitterConfig;
			assessment?: AssessmentResult;
			approvalResult?: MrApprovalState;
			throwsAt?: readonly FailureStage[];
			expectedCalls: string[];
		};
		const badDiff: FileDiff = { ...diff, statOnly: true };
		const manyDiffs = Array.from({ length: 11 }, (_, index) => ({
			...diff,
			path: `src/file-${index}.ts`,
			insertions: 0,
			deletions: 0,
		}));
		const completeAndOpen = [completeDiscussion, unresolvedDiscussion];
		const fixtures: Fixture[] = [
			{
				name: "1 draft",
				expected: { kind: "skip_draft" },
				stateOverrides: {
					draft: true,
					hasConflicts: true,
					detailedMergeStatus: "unknown",
					headPipelineStatus: "failed",
					labels: ["ai-review"],
				},
				throwsAt: ["discussions", "approval", "diff", "assess", "approve"],
				expectedCalls: ["list", "state"],
			},
			{
				name: "2 conflict",
				expected: { kind: "skip_conflict" },
				stateOverrides: {
					hasConflicts: true,
					detailedMergeStatus: "unknown",
					headPipelineStatus: "failed",
					labels: ["ai-review"],
				},
				throwsAt: ["discussions", "approval", "diff", "assess", "approve"],
				expectedCalls: ["list", "state"],
			},
			{
				name: "3 GitLab unresolved discussions",
				expected: { kind: "skip_discussions_not_resolved" },
				stateOverrides: {
					detailedMergeStatus: "discussions_not_resolved",
					headPipelineStatus: "success",
					labels: ["ai-review"],
				},
				throwsAt: ["discussions", "approval", "diff", "assess", "approve"],
				expectedCalls: ["list", "state"],
			},
			{
				name: "3 merge status",
				expected: { kind: "skip_merge_status" },
				stateOverrides: {
					detailedMergeStatus: "unknown",
					headPipelineStatus: "failed",
					labels: ["ai-review"],
				},
				throwsAt: ["discussions", "approval", "diff", "assess", "approve"],
				expectedCalls: ["list", "state"],
			},
			{
				name: "4 failed CI",
				expected: { kind: "skip_ci_failed" },
				stateOverrides: { headPipelineStatus: "failed", labels: ["ai-review"] },
				throwsAt: ["discussions", "approval", "diff", "assess", "approve"],
				expectedCalls: ["list", "state"],
			},
			{
				name: "5 pending CI",
				expected: { kind: "skip_ci_not_ready" },
				stateOverrides: {
					headPipelineStatus: "running",
					labels: ["ai-review"],
				},
				throwsAt: ["discussions", "approval", "diff", "assess", "approve"],
				expectedCalls: ["list", "state"],
			},
			{
				name: "6 queue",
				expected: { kind: "queue_ai_review" },
				discussions: [unresolvedDiscussion],
				expectedCalls: ["list", "state", "approval", "discussions", "label"],
			},
			{
				name: "7 waiting",
				expected: { kind: "wait_ai_review" },
				stateOverrides: { labels: ["ai-review"] },
				throwsAt: ["diff", "assess", "approve"],
				expectedCalls: ["list", "state", "approval", "discussions"],
			},
			{
				name: "8 discussion",
				expected: { kind: "block_discussion" },
				stateOverrides: { mr: { ...state().mr, author: "approver" } },
				discussions: completeAndOpen,
				throwsAt: ["diff", "assess", "approve"],
				expectedCalls: ["list", "state", "approval", "discussions"],
			},
			{
				name: "9 self approval",
				expected: { kind: "skip_self_approval" },
				stateOverrides: { mr: { ...state().mr, author: "approver" } },
				discussions: [completeDiscussion],
				approval: { ...approval, approved: false },
				throwsAt: ["diff", "assess", "approve"],
				expectedCalls: ["list", "state", "approval", "discussions"],
			},
			{
				name: "10 already approved",
				expected: { kind: "skip_already_approved", approvalsLeft: 1 },
				discussions: [completeDiscussion],
				approval: { ...approval, approved: true },
				throwsAt: ["diff", "assess", "approve"],
				expectedCalls: ["list", "state", "approval", "discussions"],
			},
			{
				name: "11 unreadable diff",
				expected: { kind: "block_diff_unreadable" },
				discussions: [completeDiscussion],
				diffs: [badDiff],
				throwsAt: ["assess", "approve"],
				expectedCalls: ["list", "state", "approval", "discussions", "diff"],
			},
			{
				name: "12 change limit",
				expected: {
					kind: "block_change_limit",
					changedLines: 251,
					maxChangedLines: 250,
				},
				discussions: [completeDiscussion],
				diffs: [{ ...diff, insertions: 251, deletions: 0 }],
				throwsAt: ["assess", "approve"],
				expectedCalls: ["list", "state", "approval", "discussions", "diff"],
			},
			{
				name: "13 file limit",
				expected: {
					kind: "block_file_limit",
					changedFiles: 11,
					maxChangedFiles: 10,
				},
				discussions: [completeDiscussion],
				diffs: manyDiffs,
				throwsAt: ["assess", "approve"],
				expectedCalls: ["list", "state", "approval", "discussions", "diff"],
			},
			{
				name: "14 missing deny-list",
				expected: { kind: "block_missing_denylist" },
				discussions: [completeDiscussion],
				config: { ...config, denyPathsByProject: {} },
				throwsAt: ["assess", "approve"],
				expectedCalls: ["list", "state", "approval", "discussions", "diff"],
			},
			{
				name: "15 denied path",
				expected: {
					kind: "block_deny_path",
					path: "src/auth/index.ts",
					glob: "src/auth/**",
				},
				discussions: [completeDiscussion],
				config: {
					...config,
					denyPathsByProject: { "group/api": ["src/auth/**"] },
				},
				diffs: [{ ...diff, path: "src/auth/index.ts" }],
				throwsAt: ["assess", "approve"],
				expectedCalls: ["list", "state", "approval", "discussions", "diff"],
			},
			{
				name: "16 assessed risk",
				expected: { kind: "assessment_risk", risk: "HIGH", reason: "unsafe" },
				discussions: [completeDiscussion],
				assessment: { kind: "risk", risk: "HIGH", reason: "unsafe" },
				throwsAt: ["approve"],
				expectedCalls: [
					"list",
					"state",
					"approval",
					"discussions",
					"diff",
					"assess",
				],
			},
			{
				name: "17 inconclusive assessment",
				expected: { kind: "assessment_inconclusive" },
				discussions: [completeDiscussion],
				assessment: { kind: "inconclusive" },
				throwsAt: ["approve"],
				expectedCalls: [
					"list",
					"state",
					"approval",
					"discussions",
					"diff",
					"assess",
				],
			},
			{
				name: "18 rejected approval",
				expected: { kind: "approval_rejected" },
				discussions: [completeDiscussion],
				assessment: { kind: "low", reason: "safe" },
				approvalResult: { ...approval, approved: false },
				expectedCalls: [
					"list",
					"state",
					"approval",
					"discussions",
					"diff",
					"assess",
					"approve",
				],
			},
			{
				name: "19 successful approval",
				expected: { kind: "approved", approvalsLeft: 1 },
				stateOverrides: { detailedMergeStatus: "not_approved" },
				discussions: [completeDiscussion],
				assessment: { kind: "low", reason: "safe" },
				approvalResult: { ...approval, approved: true },
				expectedCalls: [
					"list",
					"state",
					"approval",
					"discussions",
					"diff",
					"assess",
					"approve",
				],
			},
		];

		for (const fixture of fixtures) {
			const calls: string[] = [];
			const shouldThrow = (stage: FailureStage) => {
				if (fixture.throwsAt?.includes(stage)) {
					throw new Error(`${stage} lower-priority failure`);
				}
			};
			const host = new FakeGitHost({
				listOpenedMrsForAssignees: async () => {
					calls.push("list");
					return [{ ref, assignees: ["alice"] }];
				},
				fetchAutoApprovalState: async () => {
					calls.push("state");
					return state(fixture.stateOverrides);
				},
				listDiscussions: async () => {
					calls.push("discussions");
					shouldThrow("discussions");
					return fixture.discussions ?? [];
				},
				fetchApprovalState: async () => {
					calls.push("approval");
					shouldThrow("approval");
					return fixture.approval ?? approval;
				},
				addMrLabel: async () => {
					calls.push("label");
				},
				approveMr: async () => {
					calls.push("approve");
					shouldThrow("approve");
					return fixture.approvalResult ?? { ...approval, approved: true };
				},
			});
			const result = await runOneLoop(fakeContext({ gitHost: host }), {
				config: fixture.config ?? config,
				notifier: new FakeNotifier(),
				loadDiff: async () => {
					calls.push("diff");
					shouldThrow("diff");
					return fixture.diffs ?? [diff];
				},
				assessRisk: async () => {
					calls.push("assess");
					shouldThrow("assess");
					return fixture.assessment ?? { kind: "low", reason: "safe" };
				},
			});
			expect(calls).toEqual(fixture.expectedCalls);
			expect(result.lines).toEqual([
				formatReportLine(fixture.expected, {
					...metadata,
					assignees: ["alice"],
				}),
			]);
		}
	});

	test("continues after one MR error and sends one joined report", async () => {
		const secondRef = { ...ref, iid: 43 };
		const host = new FakeGitHost({
			listOpenedMrsForAssignees: async () => [
				{ ref, assignees: ["alice"] },
				{ ref: secondRef, assignees: ["alice"] },
			],
			fetchAutoApprovalState: async (candidate) => {
				if (candidate.iid === ref.iid) throw new Error("state unavailable");
				return state({ mr: { ...state().mr, iid: secondRef.iid } });
			},
			listDiscussions: async () => [],
		});
		const notifier = new FakeNotifier();
		const result = await runOneLoop(fakeContext({ gitHost: host }), {
			config,
			notifier,
		});
		expect(result.lines).toHaveLength(2);
		expect(result.text).toContain("*PR Babysitter — Scan summary*");
		expect(result.text).toContain("Checked: 2 PRs");
		expect(notifier.messages).toEqual([result.text]);
	});

	test("renders global no-match and discovery failure heartbeats", async () => {
		const noMatchNotifier = new FakeNotifier();
		const noMatch = await runOneLoop(
			fakeContext({
				gitHost: new FakeGitHost({ listOpenedMrsForAssignees: async () => [] }),
			}),
			{ config, notifier: noMatchNotifier },
		);
		expect(noMatch.text).toBe(
			"*PR Babysitter — Scan summary*\nChecked: 0 PRs\nResult: No matching open MRs.\n\nℹ️ No matching open MRs.",
		);

		const failedNotifier = new FakeNotifier();
		const failure = await runOneLoop(
			fakeContext({
				gitHost: new FakeGitHost({
					listOpenedMrsForAssignees: async () => {
						throw new Error("access denied");
					},
				}),
			}),
			{ config, notifier: failedNotifier },
		);
		expect(failure.text).toBe(
			"*PR Babysitter — Scan summary*\nChecked: 0 PRs\nResult: Scan failed.\n\n❌ GitLab scan failed: access denied. Check GitLab access.",
		);
	});

	test("shows safe terminal progress for discovery and each merge request", async () => {
		const ui = new FakeUiPort();
		const host = new FakeGitHost({
			listOpenedMrsForAssignees: async () => [{ ref, assignees: ["alice"] }],
			fetchAutoApprovalState: async () => state({ draft: true }),
		});

		await runOneLoop(fakeContext({ gitHost: host, ui }), {
			config,
			notifier: new FakeNotifier(),
		});

		const entries = ui.transcript.filter((entry) => entry.kind === "info");
		expect(entries.map((entry) => entry.text)).toEqual([
			"Review babysitter — Discovering matching open MRs.",
			"Review babysitter — Found 1 matching open MR.",
			"Review babysitter — Checking merge request 1/1.",
			"Review babysitter — Finished merge request 1/1.",
			"Review babysitter — Slack report sent. Waiting for next scan.",
		]);
		expect(entries[0]).toMatchObject({ spinner: true, terminal: true });
		expect(entries[2]).toMatchObject({ spinner: true, terminal: true });
		expect(entries[3]).toMatchObject({ terminal: true });
	});
});

class TestSignals implements SignalSource {
	private readonly listeners = new Map<"SIGINT" | "SIGTERM", Set<() => void>>();

	on(event: "SIGINT" | "SIGTERM", listener: () => void): void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener);
	}

	off(event: "SIGINT" | "SIGTERM", listener: () => void): void {
		this.listeners.get(event)?.delete(listener);
	}

	emit(event: "SIGINT" | "SIGTERM"): void {
		for (const listener of this.listeners.get(event) ?? []) listener();
	}
}

describe("runScheduler", () => {
	test("runs immediately, serially, then stops after signal during wait", async () => {
		const signals = new TestSignals();
		let active = 0;
		let maxActive = 0;
		let runs = 0;
		const waits: number[] = [];
		await runScheduler({
			intervalSeconds: 60,
			signals,
			runLoop: async () => {
				runs++;
				active++;
				maxActive = Math.max(maxActive, active);
				await Promise.resolve();
				active--;
			},
			sleep: async (milliseconds) => {
				waits.push(milliseconds);
				signals.emit("SIGTERM");
			},
		});
		expect(runs).toBe(1);
		expect(maxActive).toBe(1);
		expect(waits).toEqual([60_000]);
	});
});
