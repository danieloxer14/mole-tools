import { ProgressBar } from "./ProgressBar";
import { Checkbox } from "./ui/checkbox";

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

export interface ChangedFilesHeaderProps {
	viewedCount: number;
	total: number;
	showWhitespaceChanges: boolean;
	whitespaceChanging: boolean;
	syncing: boolean;
	onShowWhitespaceChangesChange: (show: boolean) => void;
}

export function ChangedFilesHeader({
	viewedCount,
	total,
	showWhitespaceChanges,
	whitespaceChanging,
	syncing,
	onShowWhitespaceChangesChange,
}: ChangedFilesHeaderProps) {
	const whitespaceDisabled = whitespaceChanging || syncing;

	return (
		<div
			data-region="changed-files"
			className="flex items-center gap-3 border-t border-b px-4 py-2 text-xs text-muted-foreground"
		>
			<span className="shrink-0">Viewed files</span>
			<ProgressBar
				className="flex-1"
				label="Viewed file coverage"
				value={viewedCount}
				max={total}
			/>
			<span className="tabular-nums">
				{viewedCount}/{total} files
			</span>
			<div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
				<Checkbox
					id="show-whitespace-changes"
					aria-label="Show whitespace changes"
					checked={showWhitespaceChanges}
					disabled={whitespaceDisabled}
					onCheckedChange={(checked) =>
						onShowWhitespaceChangesChange(checked === true)
					}
				/>
				<label htmlFor="show-whitespace-changes">Show whitespace changes</label>
			</div>
		</div>
	);
}
