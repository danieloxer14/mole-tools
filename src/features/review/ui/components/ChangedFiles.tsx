import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import {
	type Dispatch,
	type ReactElement,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ParsedFileDiff } from "../../../../shared/diff-parse";
import {
	ChangedFilesHeader,
	type ChangedFilesMode,
	changedFileCount,
	viewedFileCount,
} from "./ChangedFilesHeader";
import { scrollSelectedFileRow } from "./file-tree-scroll";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible";

export interface ChangedFilesProps {
	files: readonly ParsedFileDiff[];
	viewedFiles: readonly string[];
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
	onViewedChange: (path: string, viewed: boolean) => void;
	showWhitespaceChanges?: boolean;
	whitespaceChanging?: boolean;
	syncing?: boolean;
	refreshing?: boolean;
	onShowWhitespaceChangesChange?: (show: boolean) => void;
}

export interface ChangedFileEntry {
	path: string;
	file: ParsedFileDiff;
}

export interface FileTreeDirectory {
	kind: "directory";
	name: string;
	path: string;
	children: FileTreeNode[];
}

export interface FileTreeFile {
	kind: "file";
	name: string;
	path: string;
	entry: ChangedFileEntry;
}

export type FileTreeNode = FileTreeDirectory | FileTreeFile;

function filePath(file: ParsedFileDiff): string {
	return file.newPath ?? file.oldPath ?? "";
}

export function buildChangedFileTree(
	entries: readonly ChangedFileEntry[],
): FileTreeNode[] {
	const root: FileTreeNode[] = [];
	const directories = new Map<string, FileTreeDirectory>();

	for (const entry of entries) {
		const segments = entry.path
			.split("/")
			.filter((segment) => segment.length > 0);
		if (segments.length === 0) continue;

		let children = root;
		let parentPath = "";
		for (const segment of segments.slice(0, -1)) {
			const path = parentPath ? `${parentPath}/${segment}` : segment;
			let directory = directories.get(path);
			if (directory === undefined) {
				directory = {
					kind: "directory",
					name: segment,
					path,
					children: [],
				};
				directories.set(path, directory);
				children.push(directory);
			}
			children = directory.children;
			parentPath = path;
		}

		const name = segments[segments.length - 1];
		if (name === undefined) continue;
		children.push({
			kind: "file",
			name,
			path: entry.path,
			entry,
		});
	}

	return root;
}

function ancestorDirectoryPaths(path: string): string[] {
	const segments = path.split("/").filter((segment) => segment.length > 0);
	if (segments.length < 2) return [];

	const ancestors: string[] = [];
	let current = "";
	for (const segment of segments.slice(0, -1)) {
		current = current ? `${current}/${segment}` : segment;
		ancestors.push(current);
	}
	return ancestors;
}

function revealSelectedAncestors(
	collapsedFolderPaths: Set<string>,
	selectedPath: string | null,
): Set<string> {
	if (selectedPath === null) return collapsedFolderPaths;

	let revealed: Set<string> | null = null;
	for (const ancestor of ancestorDirectoryPaths(selectedPath)) {
		if (!collapsedFolderPaths.has(ancestor)) continue;
		revealed ??= new Set(collapsedFolderPaths);
		revealed.delete(ancestor);
	}
	return revealed ?? collapsedFolderPaths;
}

function treeContainsFile(
	nodes: readonly FileTreeNode[],
	path: string,
): boolean {
	for (const node of nodes) {
		if (node.kind === "file" && node.path === path) return true;
		if (node.kind === "directory" && treeContainsFile(node.children, path)) {
			return true;
		}
	}
	return false;
}

interface ChangedFileRowProps {
	entry: ChangedFileEntry;
	label: string;
	depth: number;
	selectedPath: string | null;
	viewedFiles: readonly string[];
	onSelectFile: (path: string) => void;
	onViewedChange: (path: string, viewed: boolean) => void;
	registerRow: (path: string, element: HTMLElement | null) => void;
}

function ChangedFileRow({
	entry,
	label,
	depth,
	selectedPath,
	viewedFiles,
	onSelectFile,
	onViewedChange,
	registerRow,
}: ChangedFileRowProps): ReactElement {
	const selected = entry.path === selectedPath;
	return (
		<div
			ref={(element) => registerRow(entry.path, element)}
			className="group flex items-center gap-2 px-4 py-1.5 text-sm transition-colors duration-150 hover:bg-muted/60 data-[state=selected]:bg-accent"
			data-file-path={entry.path}
			data-state={selected ? "selected" : "idle"}
			style={{ paddingInlineStart: `${1 + depth}rem` }}
		>
			<button
				type="button"
				className="min-w-0 flex-1 truncate text-left font-mono text-xs"
				aria-label={entry.path}
				title={entry.path}
				onClick={() => onSelectFile(entry.path)}
			>
				{label}
			</button>
			<span className="flex shrink-0 gap-1 text-xs tabular-nums">
				<span className="text-success">+{entry.file.insertions}</span>
				<span className="text-destructive">−{entry.file.deletions}</span>
			</span>
			<div
				className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
				title="Mark file viewed"
			>
				<Checkbox
					checked={viewedFiles.includes(entry.path)}
					aria-label={`Viewed ${entry.path}`}
					onCheckedChange={(checked) =>
						onViewedChange(entry.path, checked === true)
					}
				/>
				<span>Viewed</span>
			</div>
		</div>
	);
}

interface ChangedFilesFolderProps {
	node: FileTreeDirectory;
	depth: number;
	collapsedFolderPaths: Set<string>;
	setCollapsedFolderPaths: Dispatch<SetStateAction<Set<string>>>;
	selectedPath: string | null;
	viewedFiles: readonly string[];
	onSelectFile: (path: string) => void;
	onViewedChange: (path: string, viewed: boolean) => void;
	registerRow: (path: string, element: HTMLElement | null) => void;
}

function ChangedFilesFolder({
	node,
	depth,
	collapsedFolderPaths,
	setCollapsedFolderPaths,
	selectedPath,
	viewedFiles,
	onSelectFile,
	onViewedChange,
	registerRow,
}: ChangedFilesFolderProps): ReactElement {
	const collapsed = collapsedFolderPaths.has(node.path);
	const open = !collapsed;
	const controlsId = `changed-files-directory-${encodeURIComponent(node.path)}`;
	const triggerLabel = `${open ? "Collapse" : "Expand"} ${node.path}`;

	return (
		<Collapsible
			open={open}
			onOpenChange={(nextOpen) => {
				setCollapsedFolderPaths((current) => {
					const nextCollapsed = !nextOpen;
					const alreadyCollapsed = current.has(node.path);
					if (alreadyCollapsed === nextCollapsed) return current;

					const next = new Set(current);
					if (nextCollapsed) next.add(node.path);
					else next.delete(node.path);
					return next;
				});
			}}
			data-directory-path={node.path}
		>
			<CollapsibleTrigger
				aria-label={triggerLabel}
				aria-controls={controlsId}
				aria-expanded={open}
				title={triggerLabel}
				render={
					<Button
						type="button"
						variant="ghost"
						className="group flex w-full min-w-0 items-center gap-2 rounded-none px-4 py-1.5 text-left text-sm"
						style={{ paddingInlineStart: `${1 + depth}rem` }}
					>
						<ChevronDown
							className="size-4 shrink-0 -rotate-90 transition-transform duration-200 ease-out group-data-[panel-open]:rotate-0"
							data-collapsed={collapsed ? "true" : "false"}
							aria-hidden
						/>
						{open ? (
							<FolderOpen className="size-4 shrink-0" aria-hidden />
						) : (
							<Folder className="size-4 shrink-0" aria-hidden />
						)}
						<span className="min-w-0 truncate font-mono text-xs">
							{node.name}
						</span>
					</Button>
				}
			/>
			<CollapsibleContent id={controlsId} keepMounted className="min-w-0">
				{node.children.map((child) =>
					child.kind === "directory" ? (
						<ChangedFilesFolder
							key={`directory:${child.path}`}
							node={child}
							depth={depth + 1}
							collapsedFolderPaths={collapsedFolderPaths}
							setCollapsedFolderPaths={setCollapsedFolderPaths}
							selectedPath={selectedPath}
							viewedFiles={viewedFiles}
							onSelectFile={onSelectFile}
							onViewedChange={onViewedChange}
							registerRow={registerRow}
						/>
					) : (
						<ChangedFileRow
							key={`file:${child.path}`}
							entry={child.entry}
							label={child.name}
							depth={depth + 1}
							selectedPath={selectedPath}
							viewedFiles={viewedFiles}
							onSelectFile={onSelectFile}
							onViewedChange={onViewedChange}
							registerRow={registerRow}
						/>
					),
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}

export function ChangedFiles({
	files,
	viewedFiles,
	selectedPath,
	onSelectFile,
	onViewedChange,
	showWhitespaceChanges = true,
	whitespaceChanging = false,
	syncing = false,
	refreshing = false,
	onShowWhitespaceChangesChange = () => {},
}: ChangedFilesProps): ReactElement {
	const [mode, setMode] = useState<ChangedFilesMode>("list");
	const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<Set<string>>(
		() => new Set(),
	);
	const entries = useMemo(
		() =>
			files
				.map((file): ChangedFileEntry => ({ path: filePath(file), file }))
				.filter((entry) => entry.path.length > 0),
		[files],
	);
	const tree = useMemo(() => buildChangedFileTree(entries), [entries]);
	const rowRegistry = useRef<Map<string, HTMLElement>>(new Map());
	const registerRow = useCallback(
		(path: string, element: HTMLElement | null) => {
			if (element) rowRegistry.current.set(path, element);
			else rowRegistry.current.delete(path);
		},
		[],
	);
	const treeRef = useRef(tree);
	treeRef.current = tree;
	const scrollTarget = useRef<{
		selectedPath: string | null;
		mode: ChangedFilesMode;
	} | null>(null);
	const shouldScrollAfterReveal = useRef(false);

	useEffect(() => {
		const previousTarget = scrollTarget.current;
		const selectionOrModeChanged =
			previousTarget === null ||
			previousTarget.selectedPath !== selectedPath ||
			previousTarget.mode !== mode;

		if (selectionOrModeChanged) {
			scrollTarget.current = { selectedPath, mode };
			if (
				mode === "tree" &&
				selectedPath !== null &&
				treeContainsFile(treeRef.current, selectedPath)
			) {
				const revealed = revealSelectedAncestors(
					collapsedFolderPaths,
					selectedPath,
				);
				if (revealed !== collapsedFolderPaths) {
					shouldScrollAfterReveal.current = true;
					setCollapsedFolderPaths(revealed);
					return;
				}
			}
		}

		const shouldScroll =
			selectionOrModeChanged || shouldScrollAfterReveal.current;
		shouldScrollAfterReveal.current = false;
		if (shouldScroll) {
			scrollSelectedFileRow(rowRegistry.current, selectedPath);
		}
	}, [collapsedFolderPaths, mode, selectedPath]);

	function renderTreeNode(node: FileTreeNode, depth: number): ReactElement {
		if (node.kind === "directory") {
			return (
				<ChangedFilesFolder
					key={`directory:${node.path}`}
					node={node}
					depth={depth}
					collapsedFolderPaths={collapsedFolderPaths}
					setCollapsedFolderPaths={setCollapsedFolderPaths}
					selectedPath={selectedPath}
					viewedFiles={viewedFiles}
					onSelectFile={onSelectFile}
					onViewedChange={onViewedChange}
					registerRow={registerRow}
				/>
			);
		}

		return (
			<ChangedFileRow
				key={`file:${node.path}`}
				entry={node.entry}
				label={node.name}
				depth={depth}
				selectedPath={selectedPath}
				viewedFiles={viewedFiles}
				onSelectFile={onSelectFile}
				onViewedChange={onViewedChange}
				registerRow={registerRow}
			/>
		);
	}

	const paths = entries.map((entry) => entry.path);
	return (
		<>
			<ChangedFilesHeader
				viewedCount={viewedFileCount(paths, viewedFiles)}
				total={changedFileCount(paths)}
				mode={mode}
				onModeChange={setMode}
				showWhitespaceChanges={showWhitespaceChanges}
				whitespaceChanging={whitespaceChanging}
				syncing={syncing}
				refreshing={refreshing}
				onShowWhitespaceChangesChange={onShowWhitespaceChangesChange}
			/>
			<nav
				className="min-h-0 max-h-[40vh] flex-1 overflow-auto"
				aria-label="Changed files"
			>
				{mode === "list"
					? entries.map((entry) => (
							<ChangedFileRow
								key={`file:${entry.path}`}
								entry={entry}
								label={entry.path}
								depth={0}
								selectedPath={selectedPath}
								viewedFiles={viewedFiles}
								onSelectFile={onSelectFile}
								onViewedChange={onViewedChange}
								registerRow={registerRow}
							/>
						))
					: tree.map((node) => renderTreeNode(node, 0))}
			</nav>
		</>
	);
}
