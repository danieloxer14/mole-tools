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

export function ChangedFilesHeader({
	viewedCount,
	total,
}: {
	viewedCount: number;
	total: number;
}) {
	return (
		<header className="file-tree-header">
			<strong>Viewed files</strong>
			<ProgressBar
				label="Viewed file coverage"
				value={viewedCount}
				max={total}
			/>
			<span>
				{viewedCount}/{total} files
			</span>
		</header>
	);
}
