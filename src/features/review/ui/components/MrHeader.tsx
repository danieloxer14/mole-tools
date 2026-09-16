import { useEffect, useRef, useState } from "react";
import type { MrApprovalState } from "../../../../ports/git-host";
import { IconButton } from "./IconButton";
import {
	CheckIcon,
	CopyIcon,
	ExternalLinkIcon,
	RefreshIcon,
	SyncIcon,
} from "./Icons";

export type ApprovalAction = "approve" | "unapprove";

export interface MrHeaderProps {
	mr: { iid: number; title: string; webUrl: string };
	headSha: string;
	approval: MrApprovalState | null;
	approvalLoading: boolean;
	approvalAction: ApprovalAction | null;
	onApprovalAction: (action: ApprovalAction) => void;
	freshness: { stale: boolean; newCommitCount: number } | null;
	refreshing: boolean;
	syncing: boolean;
	layerGenerating: boolean;
	regenerateAfterSync: boolean;
	onRegenerateAfterSyncChange: (value: boolean) => void;
	onRefresh: () => void;
	onSync: () => void;
}

export function headerTitle(title: string, iid: number): string {
	return title.trim() ? title : `!${iid}`;
}

export function shortSha(sha: string): string {
	return sha.slice(0, 8);
}

export function shaButtonLabel(sha: string, copied: boolean): string {
	return copied ? "Copied" : shortSha(sha);
}

export function approvalPillLabel(
	approval: MrApprovalState | null,
	approvalLoading: boolean,
): "Approved" | "Not approved" | null {
	if (approvalLoading || approval === null) return null;
	return approval.approved ? "Approved" : "Not approved";
}

export function approveDisabledReason(
	approval: MrApprovalState | null,
	approvalLoading: boolean,
	approvalAction: ApprovalAction | null,
): string | null {
	if (approvalLoading) return "Loading approval…";
	if (approval === null) return "Approval unavailable";
	if (approval.currentUser === null) return "Cannot determine current user";
	if (approvalAction !== null) {
		return approvalAction === "approve" ? "Approving…" : "Unapproving…";
	}
	return null;
}

export function approveTooltip(
	reason: string | null,
	stale: boolean,
	headSha: string,
	approved: boolean,
): string {
	if (reason !== null) return reason;
	if (stale) return `MR out of date — approves ${shortSha(headSha)}`;
	return approved ? "Unapprove" : "Approve";
}

export function syncTooltip(newCommitCount: number): string {
	return `Sync to latest — ${newCommitCount} new commit${
		newCommitCount === 1 ? "" : "s"
	}`;
}

export function MrHeader({
	mr,
	headSha,
	approval,
	approvalLoading,
	approvalAction,
	onApprovalAction,
	freshness,
	refreshing,
	syncing,
	layerGenerating,
	regenerateAfterSync,
	onRegenerateAfterSyncChange,
	onRefresh,
	onSync,
}: MrHeaderProps) {
	const [copied, setCopied] = useState(false);
	const copyTimer = useRef<Timer | undefined>(undefined);
	const approvalLabel = approvalPillLabel(approval, approvalLoading);
	const approveReason = approveDisabledReason(
		approval,
		approvalLoading,
		approvalAction,
	);
	const approved = approval?.approved ?? false;
	const copySha = () => {
		void navigator.clipboard.writeText(headSha).then(
			() => {
				setCopied(true);
				if (copyTimer.current !== undefined) {
					clearTimeout(copyTimer.current);
				}
				copyTimer.current = setTimeout(() => setCopied(false), 1500);
			},
			() => undefined,
		);
	};
	useEffect(() => {
		return () => {
			clearTimeout(copyTimer.current);
		};
	}, []);
	return (
		<header className="mr-header">
			<div className="mr-identity">
				<h1 className="mr-title" title={mr.title}>
					{headerTitle(mr.title, mr.iid)}
				</h1>
				<div className="mr-identity-meta">
					<button
						type="button"
						className="mr-sha"
						aria-label="Copy commit sha"
						title={headSha}
						onClick={copySha}
					>
						{shaButtonLabel(headSha, copied)}
						{copied ? <CheckIcon /> : <CopyIcon />}
					</button>
					{approvalLabel !== null ? (
						<span
							className={`mr-status-pill mr-status-pill-${approved ? "approved" : "neutral"}`}
							title={
								approval && approval.approvedBy.length > 0
									? `Approved by ${approval.approvedBy.join(", ")}`
									: undefined
							}
						>
							{approvalLabel}
						</span>
					) : null}
				</div>
			</div>
			<div className="mr-header-actions">
				<IconButton
					label="Refresh merge request"
					busy={refreshing}
					disabled={refreshing || syncing || layerGenerating}
					onClick={onRefresh}
				>
					<RefreshIcon />
				</IconButton>
				{freshness?.stale ? (
					<>
						<IconButton
							label="Sync to latest"
							tooltip={syncTooltip(freshness.newCommitCount)}
							badge
							disabled={syncing || layerGenerating}
							onClick={onSync}
						>
							<SyncIcon />
						</IconButton>
						<label className="mr-regenerate">
							<input
								type="checkbox"
								checked={regenerateAfterSync}
								disabled={syncing || layerGenerating}
								onChange={(event) =>
									onRegenerateAfterSyncChange(event.target.checked)
								}
							/>
							Regenerate layers after sync
						</label>
					</>
				) : null}
				<IconButton href={mr.webUrl} label="Open in GitLab">
					<ExternalLinkIcon />
				</IconButton>
				<button
					type="button"
					className={`mr-approve mr-approve-${approved ? "danger" : "success"}`}
					disabled={approveReason !== null}
					title={approveTooltip(
						approveReason,
						freshness?.stale ?? false,
						headSha,
						approved,
					)}
					onClick={() => onApprovalAction(approved ? "unapprove" : "approve")}
				>
					{approved ? "Unapprove" : "Approve"}
				</button>
			</div>
		</header>
	);
}
