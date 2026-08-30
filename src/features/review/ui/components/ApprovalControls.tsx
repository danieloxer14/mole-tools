import type { MrApprovalState } from "../../../ports/git-host";

export type ApprovalAction = "approve" | "unapprove";

interface ApprovalControlsProps {
	mrWebUrl: string;
	approval: MrApprovalState | null;
	loading: boolean;
	pendingAction: ApprovalAction | null;
	error: string | null;
	onAction: (action: ApprovalAction) => void;
}

function stateLabel(
	approval: MrApprovalState | null,
	loading: boolean,
): string {
	if (loading) return "Loading";
	if (!approval) return "Unavailable";
	return approval.approved ? "Approved" : "Not approved";
}

function actionLabel(
	action: ApprovalAction,
	pendingAction: ApprovalAction | null,
): string {
	if (pendingAction === action)
		return action === "approve" ? "Approving…" : "Unapproving…";
	return action === "approve" ? "Approve" : "Unapprove";
}

export function ApprovalControls({
	mrWebUrl,
	approval,
	loading,
	pendingAction,
	error,
	onAction,
}: ApprovalControlsProps) {
	const action = approval?.approved ? "unapprove" : "approve";
	const actionsDisabled =
		loading ||
		pendingAction !== null ||
		approval === null ||
		approval.currentUser === null;
	const status = stateLabel(approval, loading);
	return (
		<section className="approval-panel" aria-label="Merge request approval">
			<div className="approval-header">
				<strong>Approval</strong>
				<a
					className="approval-link"
					href={mrWebUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					Open in GitLab
				</a>
			</div>
			<div className="approval-status-row" role="status" aria-live="polite">
				<span
					className={`approval-state approval-state-${
						approval?.approved ? "approved" : loading ? "loading" : "pending"
					}`}
				>
					{status}
				</span>
				{approval?.currentUser ? (
					<span className="approval-current-user">
						as {approval.currentUser}
					</span>
				) : null}
			</div>
			{approval ? (
				<>
					{approval.approvalsLeft !== null ? (
						<p className="approval-summary">
							Approvals remaining <strong>{approval.approvalsLeft}</strong>
						</p>
					) : null}
					{approval.approvedBy.length > 0 ? (
						<p className="approval-summary">
							Approved by {approval.approvedBy.join(", ")}
						</p>
					) : null}
					{approval.currentUser === null ? (
						<p className="approval-unavailable">
							Current GitLab user unavailable; approval actions disabled.
						</p>
					) : null}
				</>
			) : !loading ? (
				<p className="approval-unavailable">Approval status unavailable.</p>
			) : null}
			{error ? (
				<p className="approval-error" role="alert">
					{error}
				</p>
			) : null}
			<div className="approval-actions">
				<button
					type="button"
					disabled={actionsDisabled}
					onClick={() => onAction(action)}
				>
					{actionLabel(action, pendingAction)}
				</button>
			</div>
		</section>
	);
}
