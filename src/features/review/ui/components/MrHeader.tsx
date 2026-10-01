import { Check, Copy, ExternalLink, RefreshCw, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MrApprovalState } from "../../../../ports/git-host";
import type { ReleaseNotes } from "../../release-notes";
import { IconButton } from "./IconButton";
import { UpdateAvailable } from "./UpdateAvailable";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
	SegmentedToggleGroup,
	SegmentedToggleGroupItem,
} from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type ApprovalAction = "approve" | "unapprove";
export type ReviewView = "code" | "overview";
export interface MrHeaderProps {
	mr: { iid: number; title: string; webUrl: string; state: string | null };
	view: ReviewView;
	onViewChange: (view: ReviewView) => void;
	headSha: string;
	filesChanged: number;
	insertions: number;
	deletions: number;
	approval: MrApprovalState | null;
	approvalLoading: boolean;
	approvalAction: ApprovalAction | null;
	onApprovalAction: (action: ApprovalAction) => void;
	freshness: { stale: boolean } | null;
	refreshing: boolean;
	layerGenerating: boolean;
	onRefresh: () => void;
	update?: {
		latest: string;
		releases: ReleaseNotes[];
		autoOpen: boolean;
	} | null;
	onUpdateAutoOpened: (version: string) => void;
	onOpenSettings: () => void;
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

export function filesChangedLabel(count: number): string {
	return `${count} file${count === 1 ? "" : "s"} changed`;
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

export function MrHeader({
	mr,
	view,
	onViewChange,
	headSha,
	filesChanged,
	insertions,
	deletions,
	approval,
	approvalLoading,
	approvalAction,
	onApprovalAction,
	freshness,
	refreshing,
	layerGenerating,
	onRefresh,
	update,
	onUpdateAutoOpened,
	onOpenSettings,
}: MrHeaderProps) {
	const [copied, setCopied] = useState(false);
	const copyTimer = useRef<Timer | undefined>(undefined);
	const merged = mr.state === "merged";
	const approvalLabel = merged
		? null
		: approvalPillLabel(approval, approvalLoading);
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
		<header className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 overflow-x-auto border-b bg-card px-3 py-2 lg:flex-nowrap lg:px-4 lg:py-3">
			<SegmentedToggleGroup
				className="shrink-0"
				aria-label="Review view"
				multiple={false}
				value={[view]}
				onValueChange={(values) => {
					const next = values[0];
					if (next === "code" || next === "overview") onViewChange(next);
				}}
			>
				<SegmentedToggleGroupItem
					value="code"
					className="!flex-none !h-9 !min-w-fit !px-4 !text-sm"
					aria-pressed={view === "code"}
				>
					Code
				</SegmentedToggleGroupItem>
				<SegmentedToggleGroupItem
					value="overview"
					className="!flex-none !h-9 !min-w-fit !px-4 !text-sm"
					aria-pressed={view === "overview"}
				>
					Overview
				</SegmentedToggleGroupItem>
			</SegmentedToggleGroup>
			<h1
				className="min-w-0 basis-full break-words text-lg font-semibold tracking-tight lg:flex-1 lg:basis-auto lg:truncate"
				title={mr.title}
			>
				{headerTitle(mr.title, mr.iid)}
			</h1>
			<div className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap leading-none">
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
				{freshness?.stale ? (
					<Badge
						className="inline-flex items-center leading-none bg-warning/15 text-warning"
						data-freshness="stale"
					>
						Out of sync
					</Badge>
				) : null}
				{merged ? (
					<Badge
						variant="secondary"
						className="inline-flex items-center leading-none"
						data-lifecycle="merged"
					>
						Merged
					</Badge>
				) : approvalLabel !== null ? (
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
				<span
					className="inline-flex items-center gap-3 text-xs leading-none tabular-nums text-muted-foreground"
					data-diff-stats=""
				>
					<span data-files-changed="">{filesChangedLabel(filesChanged)}</span>
					<span className="inline-flex gap-1">
						<span className="text-success" data-insertions="">
							+{insertions}
						</span>
						<span className="text-destructive" data-deletions="">
							−{deletions}
						</span>
					</span>
				</span>
			</div>
			<div
				className="ml-auto inline-flex shrink-0 items-center gap-2 whitespace-nowrap leading-none"
				data-header-actions=""
			>
				<IconButton
					label="Refresh review and layers"
					tooltip="Fetch latest MR state, sync when needed, and regenerate layers"
					busy={refreshing}
					disabled={refreshing || layerGenerating}
					onClick={onRefresh}
				>
					<RefreshCw aria-hidden />
				</IconButton>
				<IconButton href={mr.webUrl} label="Open in GitLab">
					<ExternalLink aria-hidden />
				</IconButton>
				{merged ? null : (
					<>
						<Tooltip>
							<TooltipTrigger
								render={
									<span className="inline-flex items-center leading-none" />
								}
							>
								{approvalButton}
							</TooltipTrigger>
							<TooltipContent>{approvalButtonTooltip}</TooltipContent>
						</Tooltip>
						<span id="approve-tooltip" className="sr-only">
							{approvalButtonTooltip}
						</span>
					</>
				)}
				{update ? (
					<UpdateAvailable
						latest={update.latest}
						releases={update.releases}
						autoOpen={update.autoOpen}
						onAutoOpened={onUpdateAutoOpened}
					/>
				) : null}
				<IconButton
					label="Settings"
					tooltip="Settings"
					onClick={onOpenSettings}
				>
					<Settings aria-hidden />
				</IconButton>
			</div>
		</header>
	);
}
