import {
	Check,
	Copy,
	ExternalLink,
	RefreshCcwDot,
	RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MrApprovalState } from "../../../../ports/git-host";
import { IconButton } from "./IconButton";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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

export function tabTitle(projectPath: string, iid: number): string {
	return `${projectPath.slice(projectPath.lastIndexOf("/") + 1)}!${iid}`;
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
	const approvalButtonTooltip = approveTooltip(
		approveReason,
		freshness?.stale ?? false,
		headSha,
		approved,
	);
	const copySha = () => {
		void navigator.clipboard.writeText(headSha).then(
			() => {
				setCopied(true);
				clearTimeout(copyTimer.current);
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
	const approvalButton = (
		<Button
			type="button"
			size="sm"
			variant={approved ? "destructive" : "default"}
			className={
				approved
					? undefined
					: "bg-success text-success-foreground hover:bg-success/80 focus-visible:border-success/40 focus-visible:ring-success/20"
			}
			aria-label={approved ? "Unapprove" : "Approve"}
			aria-describedby="approve-tooltip"
			disabled={approveReason !== null}
			onClick={() => onApprovalAction(approved ? "unapprove" : "approve")}
		>
			{approved ? "Unapprove" : "Approve"}
		</Button>
	);
	return (
		<header className="flex items-center justify-between gap-4 bg-card px-4 py-3">
			<div className="min-w-0 flex-1">
				<h1
					className="truncate text-lg font-semibold tracking-tight"
					title={mr.title}
				>
					{headerTitle(mr.title, mr.iid)}
				</h1>
				<div className="inline-flex items-center gap-2 leading-none">
					<Button
						type="button"
						variant="ghost"
						size="xs"
						className="inline-flex min-w-24 items-center overflow-hidden font-mono text-xs leading-none"
						data-sha-control=""
						aria-label="Copy commit sha"
						title={headSha}
						onClick={copySha}
					>
						<span className="min-w-0 truncate" data-sha-label="">
							{shaButtonLabel(headSha, copied)}
						</span>
						{copied ? (
							<Check
								className="size-3 shrink-0 animate-in zoom-in-50 duration-150 ease-out"
								aria-hidden
							/>
						) : (
							<Copy className="size-3 shrink-0" aria-hidden />
						)}
					</Button>
					{approvalLabel !== null ? (
						<Badge
							variant="secondary"
							className={
								approved
									? "inline-flex items-center leading-none bg-success/15 text-success"
									: "inline-flex items-center leading-none"
							}
							data-approval={approved ? "approved" : "not-approved"}
							title={
								approval && approval.approvedBy.length > 0
									? `Approved by ${approval.approvedBy.join(", ")}`
									: undefined
							}
						>
							{approvalLabel}
						</Badge>
					) : null}
				</div>
			</div>
			<div className="inline-flex shrink-0 items-center gap-2 leading-none">
				<IconButton
					label="Refresh merge request"
					busy={refreshing}
					disabled={refreshing || syncing || layerGenerating}
					onClick={onRefresh}
				>
					<RefreshCw aria-hidden />
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
							<RefreshCcwDot aria-hidden />
						</IconButton>
						<label
							className="flex shrink-0 items-center gap-2 text-xs whitespace-nowrap text-muted-foreground"
							htmlFor="regenerate-after-sync"
						>
							<Checkbox
								id="regenerate-after-sync"
								aria-label="Regenerate layers after sync"
								checked={regenerateAfterSync}
								disabled={syncing || layerGenerating}
								onCheckedChange={onRegenerateAfterSyncChange}
							/>
							Regenerate layers after sync
						</label>
					</>
				) : null}
				<IconButton href={mr.webUrl} label="Open in GitLab">
					<ExternalLink aria-hidden />
				</IconButton>
				<Tooltip>
					<TooltipTrigger
						render={<span className="inline-flex items-center leading-none" />}
					>
						{approvalButton}
					</TooltipTrigger>
					<TooltipContent>{approvalButtonTooltip}</TooltipContent>
				</Tooltip>
				<span id="approve-tooltip" className="sr-only">
					{approvalButtonTooltip}
				</span>
			</div>
		</header>
	);
}
