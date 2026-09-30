import { List, ListTree, Search } from "lucide-react";
import type { ImportanceStatus } from "../../importance";
import type { ImportanceReviewProgress } from "../importance";

import { ImportanceProgressBar } from "./ImportanceProgressBar";
import { ProgressBar } from "./ProgressBar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import {
	SegmentedToggleGroup,
	SegmentedToggleGroupItem,
} from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type ChangedFilesMode = "list" | "tree";

export interface ChangedFilesHeaderProps {
	viewedCount: number;
	total: number;
	mode: ChangedFilesMode;
	onModeChange: (mode: ChangedFilesMode) => void;
	filterQuery: string;
	onFilterQueryChange: (query: string) => void;
	importance?: {
		status: ImportanceStatus | null;
		error: string | null;
		canRetry: boolean;
		onRetry: () => void;
	};
	importanceProgress?: ImportanceReviewProgress;
}

export function viewedFileCount(
	files: readonly string[],
	viewedFiles: readonly string[],
): number {
	const viewed = new Set(viewedFiles);
	return new Set(files.filter((path) => viewed.has(path))).size;
}

export function changedFileCount(files: readonly string[]): number {
	return new Set(files).size;
}
export function diffLineTotals(
	files: readonly { insertions: number; deletions: number }[],
): { insertions: number; deletions: number } {
	let insertions = 0;
	let deletions = 0;
	for (const file of files) {
		insertions += file.insertions;
		deletions += file.deletions;
	}
	return { insertions, deletions };
}

export function ChangedFilesHeader({
	viewedCount,
	total,
	mode,
	onModeChange,
	filterQuery,
	onFilterQueryChange,
	importance,
	importanceProgress,
}: ChangedFilesHeaderProps) {
	return (
		<div
			data-region="changed-files"
			className="flex min-w-0 flex-col gap-2 border-t border-b px-4 pt-3 pb-3 text-xs text-muted-foreground"
		>
			<div className="flex min-w-0 items-center gap-2">
				<SegmentedToggleGroup
					className="shrink-0"
					multiple={false}
					value={[mode]}
					onValueChange={(values) => {
						const value = values[0];
						if (value === "list" || value === "tree") onModeChange(value);
					}}
					aria-label="Changed files layout"
				>
					<Tooltip>
						<TooltipTrigger
							render={
								<SegmentedToggleGroupItem
									value="list"
									aria-label="List view"
									aria-pressed={mode === "list"}
									data-state={mode === "list" ? "on" : "off"}
								>
									<List aria-hidden />
									<span className="sr-only">List view</span>
								</SegmentedToggleGroupItem>
							}
						/>
						<TooltipContent>List view</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							render={
								<SegmentedToggleGroupItem
									value="tree"
									aria-label="Tree view"
									aria-pressed={mode === "tree"}
									data-state={mode === "tree" ? "on" : "off"}
								>
									<ListTree aria-hidden />
									<span className="sr-only">Tree view</span>
								</SegmentedToggleGroupItem>
							}
						/>
						<TooltipContent>Tree view</TooltipContent>
					</Tooltip>
				</SegmentedToggleGroup>
				<ProgressBar
					className="min-w-0 flex-1"
					label="Viewed file coverage"
					value={viewedCount}
					max={total}
				/>
				<span className="shrink-0 whitespace-nowrap tabular-nums">
					{viewedCount}/{total} files
				</span>
				{importance?.status && importance.status !== "ready" && (
					<div className="flex min-w-0 items-center gap-2">
						{importance.status === "pending" ||
						importance.status === "running" ? (
							<span className="flex items-center gap-1.5 text-muted-foreground">
								<Spinner className="size-3" />
								Scoring…
							</span>
						) : (
							<>
								<Tooltip>
									<TooltipTrigger
										render={
											<button type="button" className="text-destructive">
												Importance failed
											</button>
										}
									/>
									<TooltipContent>{importance.error}</TooltipContent>
								</Tooltip>
								{importance.canRetry && (
									<Button
										size="xs"
										variant="outline"
										onClick={importance.onRetry}
									>
										Retry
									</Button>
								)}
							</>
						)}
					</div>
				)}
			</div>
			{importanceProgress ? (
				<ImportanceProgressBar progress={importanceProgress} />
			) : null}
			<div className="flex min-w-0 items-center rounded-3xl border border-border bg-input/50 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
				<div className="relative min-w-0 flex-1">
					<Search
						className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden
					/>
					<Input
						type="text"
						className="h-8 w-full min-w-0 rounded-none border-0 bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0"
						placeholder="Filter files"
						aria-label="Filter files"
						value={filterQuery}
						onChange={(event) => onFilterQueryChange(event.target.value)}
					/>
				</div>
			</div>
		</div>
	);
}
