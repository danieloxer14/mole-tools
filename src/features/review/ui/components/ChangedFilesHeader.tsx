import { ProgressBar } from "./ProgressBar";

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
}: {
	viewedCount: number;
	total: number;
}) {
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
		</div>
	);
}
