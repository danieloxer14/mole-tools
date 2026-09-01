import type { PolicyResult } from "./policy";

export interface ReportMr {
	/** Parsed GitLab merge-request URL used as Slack link target. */
	webUrl: string;
	projectPath: string;
	iid: number;
	title: string;
	assignees: readonly string[];
}

export type ReportResult =
	| PolicyResult
	| { kind: "assessment_risk"; risk: "MEDIUM" | "HIGH"; reason: string }
	| { kind: "assessment_inconclusive" }
	| { kind: "approval_rejected" }
	| { kind: "approved"; approvalsLeft?: number | null }
	| { kind: "error"; error: string };

export interface ReportLineInput extends ReportMr {
	result: ReportResult;
}

/** Escape dynamic display text for Slack mrkdwn. Link targets are not escaped. */
export function escapeSlackText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function safeText(value: unknown): string {
	const text = typeof value === "string" ? value : String(value);
	return text
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 500);
}

function envelope(mr: ReportMr): {
	display: string;
	title: string;
	assignees: string;
} {
	const project = escapeSlackText(safeText(mr.projectPath));
	const title = escapeSlackText(safeText(mr.title));
	const assignees = mr.assignees
		.map((assignee) => `@${escapeSlackText(safeText(assignee))}`)
		.join(", ");
	return {
		display: `<${mr.webUrl}|${project}!${mr.iid}>`,
		title,
		assignees,
	};
}

function reportEnvelope(mr: ReportMr, text: string, emoji: string): string {
	const copy = envelope(mr);
	return `${copy.display} — ${copy.assignees} — ${copy.title}\n${emoji} ${text}`;
}

function instruction(result: ReportResult): { emoji: string; text: string } {
	switch (result.kind) {
		case "skip_draft":
			return {
				emoji: "⏭️",
				text: "This MR is draft. Mark it ready when work is ready.",
			};
		case "skip_conflict":
			return {
				emoji: "⛔",
				text: "GitLab reports merge conflicts. Resolve them.",
			};
		case "skip_discussions_not_resolved":
			return {
				emoji: "💬",
				text: "GitLab reports unresolved discussions. Resolve open discussions.",
			};
		case "skip_merge_status":
			return {
				emoji: "⛔",
				text: "GitLab reports unresolved mergeability status.",
			};
		case "skip_ci_failed":
			return {
				emoji: "❌",
				text: "Head pipeline is failing. Fix failing jobs.",
			};
		case "skip_ci_not_ready":
			return { emoji: "⏳", text: "Head pipeline is not successful yet." };
		case "queue_ai_review":
			return { emoji: "🏷️", text: "AI review requested." };
		case "wait_ai_review":
			return { emoji: "⏳", text: "AI review is in progress." };
		case "block_discussion":
			return { emoji: "💬", text: "Open discussion needs resolution." };
		case "skip_self_approval":
			return { emoji: "⏭️", text: "Authenticated approver is MR author." };
		case "skip_already_approved":
			if (
				typeof result.approvalsLeft === "number" &&
				result.approvalsLeft > 0
			) {
				return {
					emoji: "⏳",
					text: `${result.approvalsLeft} required approval${result.approvalsLeft === 1 ? "" : "s"} remain${result.approvalsLeft === 1 ? "s" : ""} before merge.`,
				};
			}
			if (result.approvalsLeft === 0) {
				return {
					emoji: "✅",
					text: "Required approvals are satisfied; no auto-approval needed.",
				};
			}
			return {
				emoji: "⏭️",
				text: "Authenticated approver already approved this MR.",
			};
		case "block_diff_unreadable":
			return {
				emoji: "⚠️",
				text: "Not eligible for auto-approval: diff cannot be safely evaluated.",
			};
		case "block_change_limit":
			return {
				emoji: "⚠️",
				text: `Not eligible for auto-approval: total changes exceed ${result.maxChangedLines}.`,
			};
		case "block_file_limit":
			return {
				emoji: "⚠️",
				text: `Not eligible for auto-approval: changed files exceed ${result.maxChangedFiles}.`,
			};
		case "block_missing_denylist":
			return {
				emoji: "⚠️",
				text: "Not eligible for auto-approval: no deny-list config exists for this project.",
			};
		case "block_deny_path":
			return {
				emoji: "⚠️",
				text: `Not eligible for auto-approval: changed path ${escapeSlackText(safeText(result.path))} matches denied glob ${escapeSlackText(safeText(result.glob))}.`,
			};
		case "assessment_risk":
			return {
				emoji: "⚠️",
				text: `Not eligible for auto-approval: AI assessed ${result.risk} risk: ${escapeSlackText(safeText(result.reason))}.`,
			};
		case "assessment_inconclusive":
			return {
				emoji: "⚠️",
				text: "Not eligible for auto-approval: AI assessment is inconclusive.",
			};
		case "approval_rejected":
			return { emoji: "❌", text: "Approval was not applied." };
		case "approved":
			return {
				emoji: "✅",
				text:
					typeof result.approvalsLeft === "number" && result.approvalsLeft > 0
						? `Current user approval applied; ${result.approvalsLeft} required approval${result.approvalsLeft === 1 ? "" : "s"} remain${result.approvalsLeft === 1 ? "s" : ""}.`
						: "Auto-approved after low-risk AI assessment.",
			};
		case "error":
			return {
				emoji: "❌",
				text: `Check could not complete: ${escapeSlackText(safeText(result.error))}.`,
			};
		case "assess":
			return { emoji: "⚠️", text: "AI assessment is inconclusive." };
	}
}

/** Render one per-MR row using the first matching state supplied by the caller. */
export function formatReportLine(
	input: ReportLineInput | ReportResult,
	mr?: ReportMr,
): string {
	const resolved = mr
		? { ...mr, result: input as ReportResult }
		: (input as ReportLineInput);
	const copy = instruction(resolved.result);
	return reportEnvelope(resolved, copy.text, copy.emoji);
}

/** Alias retained for callers that describe the operation as rendering. */
export const renderReportLine = formatReportLine;

/** Render the global no-match heartbeat. */
export function formatNoMatches(): string {
	return [
		"*PR Babysitter — Scan summary*",
		"Checked: 0 PRs",
		"Result: No matching open MRs.",
		"",
		"ℹ️ No matching open MRs.",
	].join("\n");
}

/** Render the global discovery failure heartbeat without exposing credentials. */
export function formatDiscoveryFailure(error: unknown): string {
	const detail = safeText(error instanceof Error ? error.message : error);
	return [
		"*PR Babysitter — Scan summary*",
		"Checked: 0 PRs",
		"Result: Scan failed.",
		"",
		`❌ GitLab scan failed: ${escapeSlackText(detail)}. Check GitLab access.`,
	].join("\n");
}

function summary(lines: readonly string[]): string {
	const count = (emoji: string) =>
		lines.filter((line) => line.includes(`\n${emoji} `)).length;
	const approved = count("✅");
	const blocked = count("⛔") + count("❌") + count("⚠️") + count("💬");
	const waiting = count("⏳");
	const queued = count("🏷️");
	const skipped = count("⏭️");
	const parts = [
		["Approved", approved],
		["Blocked", blocked],
		["Waiting", waiting],
		["Queued", queued],
		["Skipped", skipped],
	]
		.filter(([, value]) => value > 0)
		.map(([label, value]) => `${label}: ${value}`);
	return `Checked: ${lines.length} PRs${parts.length > 0 ? ` | ${parts.join(" | ")}` : ""}`;
}

/** Render one complete readable Slack report. */
export function formatReport(lines: readonly string[]): string {
	return [
		"*PR Babysitter — Scan summary*",
		summary(lines),
		"",
		lines.join("\n\n"),
	].join("\n");
}
