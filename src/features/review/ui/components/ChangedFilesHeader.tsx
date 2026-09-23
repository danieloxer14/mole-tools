import { List, ListTree } from "lucide-react";
import { ProgressBar } from "./ProgressBar";
import {
	SegmentedToggleGroup,
	SegmentedToggleGroupItem,
} from "./ui/toggle-group";

export type ChangedFilesMode = "list" | "tree";

export interface ChangedFilesHeaderProps {
	viewedCount: number;
	total: number;
	mode: ChangedFilesMode;
	onModeChange: (mode: ChangedFilesMode) => void;
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

export function ChangedFilesHeader({
	viewedCount,
	total,
	mode,
	onModeChange,
}: ChangedFilesHeaderProps) {
	return (
		<div
			data-region="changed-files"
			className="flex min-w-0 items-center gap-3 border-t border-b px-4 py-2 text-xs text-muted-foreground"
		>
			<span className="shrink-0">Viewed files</span>
			<ProgressBar
				className="min-w-0 flex-1"
				label="Viewed file coverage"
				value={viewedCount}
				max={total}
			/>
			<span className="shrink-0 tabular-nums">
				{viewedCount}/{total} files
			</span>
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
				<SegmentedToggleGroupItem
					value="list"
					aria-label="List view"
					title="List view"
					aria-pressed={mode === "list"}
					data-state={mode === "list" ? "on" : "off"}
				>
					<List aria-hidden />
					<span className="sr-only">List view</span>
				</SegmentedToggleGroupItem>
				<SegmentedToggleGroupItem
					value="tree"
					aria-label="Tree view"
					title="Tree view"
					aria-pressed={mode === "tree"}
					data-state={mode === "tree" ? "on" : "off"}
				>
					<ListTree aria-hidden />
					<span className="sr-only">Tree view</span>
				</SegmentedToggleGroupItem>
			</SegmentedToggleGroup>
		</div>
	);
}
