import { Folder } from "lucide-react";
import {
	type Dispatch,
	Fragment,
	type ReactElement,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ParsedFileDiff } from "../../../../shared/diff-parse";
import type { ImportanceRating } from "../importance";
import { IMPORTANCE_BG_CLASS, importanceTitle } from "../importance";
import type { ChangedFilesHeaderProps } from "./ChangedFilesHeader";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const TREE_ROOT_INDENT_REM = 0.5;
// Each displayed level advances by half a rem; cap keeps deep paths readable.
const TREE_INDENT_STEP_REM = 0.5;
const TREE_MAX_INDENT_REM = 2;

function treeRowIndent(depth: number): string {
	return `${Math.min(
		TREE_ROOT_INDENT_REM + depth * TREE_INDENT_STEP_REM,
		TREE_MAX_INDENT_REM,
	)}rem`;
}

type TextWidth = (text: string) => number;

export function fitChangedFileName(
	text: string,
	availableWidth: number,
	measureText: TextWidth,
): string {
	if (!Number.isFinite(availableWidth) || availableWidth <= 0) return text;

	try {
		const fullWidth = measureText(text);
		if (!Number.isFinite(fullWidth)) return text;
		if (fullWidth <= availableWidth) return text;

		const codePoints = Array.from(text);
		if (codePoints.length === 0) return text;

		const ellipsis = "…";
		const ellipsisWidth = measureText(ellipsis);
		if (!Number.isFinite(ellipsisWidth)) return text;
		if (ellipsisWidth > availableWidth) return "";

		const lastSlash = text.lastIndexOf("/");
		const lastDot = text.lastIndexOf(".");
		const extensionLength =
			lastDot > lastSlash && lastDot > 0 && lastDot < text.length - 1
				? Array.from(text.slice(lastDot)).length
				: 0;
		const extension =
			extensionLength > 0 ? codePoints.slice(-extensionLength).join("") : "";
		const preserveExtension =
			extensionLength > 0 &&
			measureText(`${ellipsis}${extension}`) <= availableWidth;

		const candidate = (retainedCount: number): string => {
			const suffixCount = preserveExtension
				? Math.max(extensionLength, Math.floor(retainedCount / 2))
				: Math.floor(retainedCount / 2);
			const prefixCount = retainedCount - suffixCount;
			const suffix =
				suffixCount === 0 ? "" : codePoints.slice(-suffixCount).join("");
			return `${codePoints.slice(0, prefixCount).join("")}${ellipsis}${suffix}`;
		};

		let best = ellipsis;
		let low = 0;
		if (preserveExtension) {
			low = extensionLength;
			best = candidate(low);
		}
		let high = codePoints.length - 1;
		while (low < high) {
			const retainedCount = Math.ceil((low + high) / 2);
			const visible = candidate(retainedCount);
			const width = measureText(visible);
			if (Number.isFinite(width) && width <= availableWidth) {
				best = visible;
				low = retainedCount;
			} else {
				high = retainedCount - 1;
			}
		}
		return best;
	} catch {
		return text;
	}
}

const canvasContexts = new WeakMap<Document, CanvasRenderingContext2D>();

function getCanvasContext(
	ownerDocument: Document,
): CanvasRenderingContext2D | null {
	const cachedContext = canvasContexts.get(ownerDocument);
	if (cachedContext) return cachedContext;

	let context: CanvasRenderingContext2D | null = null;
	try {
		context = ownerDocument.createElement("canvas").getContext("2d");
	} catch {
		// Canvas is unavailable in some test and server-rendering environments.
	}
	if (context) canvasContexts.set(ownerDocument, context);
	return context;
}

function measureChangedFileName(text: string, element: HTMLElement): string {
	const rectWidth = element.getBoundingClientRect().width;
	const availableWidth = rectWidth > 0 ? rectWidth : element.clientWidth;
	if (!Number.isFinite(availableWidth) || availableWidth <= 0) return text;

	const ownerDocument = element.ownerDocument;
	const context = getCanvasContext(ownerDocument);
	const view = ownerDocument.defaultView;
	if (!context || !view) return text;

	try {
		const style = view.getComputedStyle(element);
		context.font =
			style.font ||
			`${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		return fitChangedFileName(
			text,
			availableWidth,
			(value) => context.measureText(value).width,
		);
	} catch {
		return text;
	}
}

interface ChangedFileNameProps {
	text: string;
	className: string;
}

function ChangedFileName({
	text,
	className,
}: ChangedFileNameProps): ReactElement {
	const elementRef = useRef<HTMLSpanElement>(null);
	const [measuredName, setMeasuredName] = useState<{
		source: string;
		visible: string;
	} | null>(null);

	useEffect(() => {
		const element = elementRef.current;
		if (!element) return;

		const ownerDocument = element.ownerDocument;
		const view = ownerDocument.defaultView;
		const fontSet = ownerDocument.fonts;
		let active = true;
		let observer: ResizeObserver | null = null;
		const measure = () => {
			if (!active) return;
			const visible = measureChangedFileName(text, element);
			setMeasuredName((current) =>
				current?.source === text && current.visible === visible
					? current
					: { source: text, visible },
			);
		};

		measure();
		if (typeof ResizeObserver !== "undefined") {
			try {
				observer = new ResizeObserver(measure);
				observer.observe(element);
			} catch {
				observer?.disconnect();
				observer = null;
			}
		}
		if (!observer) view?.addEventListener("resize", measure);

		fontSet?.addEventListener("loadingdone", measure);
		if (fontSet?.ready) {
			void fontSet.ready.then(measure, () => {});
		}

		return () => {
			active = false;
			observer?.disconnect();
			view?.removeEventListener("resize", measure);
			fontSet?.removeEventListener("loadingdone", measure);
		};
	}, [text]);

	const visibleText =
		measuredName?.source === text ? measuredName.visible : text;
	return (
		<span ref={elementRef} aria-hidden="true" className={className}>
			{visibleText}
		</span>
	);
}

export interface ChangedFilesProps {
	files: readonly ParsedFileDiff[];
	viewedFiles: readonly string[];
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
	onViewedChange: (paths: readonly string[], viewed: boolean) => void;
	importanceByPath?: ReadonlyMap<string, ImportanceRating>;
	importance?: ChangedFilesHeaderProps["importance"];
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

interface ChangedFileListGroup {
	kind: "group";
	parentPath: string;
	entries: ChangedFileEntry[];
}

interface ChangedFileListFile {
	kind: "file";
	entry: ChangedFileEntry;
	name: string;
}

type ChangedFileListItem = ChangedFileListGroup | ChangedFileListFile;

function buildChangedFileList(
	entries: readonly ChangedFileEntry[],
): ChangedFileListItem[] {
	const items: ChangedFileListItem[] = [];
	const groups = new Map<string, ChangedFileListGroup>();

	for (const entry of entries) {
		const separator = entry.path.lastIndexOf("/");
		const parentPath = entry.path.slice(0, separator);
		if (separator <= 0) {
			items.push({
				kind: "file",
				entry,
				name: entry.path.slice(separator + 1),
			});
			continue;
		}

		let group = groups.get(parentPath);
		if (group === undefined) {
			group = { kind: "group", parentPath, entries: [] };
			groups.set(parentPath, group);
			items.push(group);
		}
		group.entries.push(entry);
	}

	return items;
}

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

function compactChangedFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
	let compacted: FileTreeNode[] | null = null;
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (node === undefined) continue;
		if (node.kind === "file") {
			compacted?.push(node);
			continue;
		}

		let tail = node;
		let name = node.name;
		while (tail.children.length === 1) {
			const child = tail.children[0];
			if (child?.kind !== "directory") break;
			name = `${name}/${child.name}`;
			tail = child;
		}
		const children = compactChangedFileTree(tail.children);
		const compactedNode: FileTreeDirectory =
			tail === node && children === node.children
				? node
				: { kind: "directory", name, path: tail.path, children };

		if (compactedNode === node) {
			compacted?.push(node);
			continue;
		}
		compacted ??= nodes.slice(0, index);
		compacted.push(compactedNode);
	}
	return compacted ?? nodes;
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
	onViewedChange: (paths: readonly string[], viewed: boolean) => void;
	registerRow: (path: string, element: HTMLElement | null) => void;
	rating?: ImportanceRating;
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
	rating,
}: ChangedFileRowProps): ReactElement {
	const selected = entry.path === selectedPath;
	return (
		<div
			ref={(element) => registerRow(entry.path, element)}
			className="group flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-muted/60 data-[state=selected]:bg-accent sm:px-4"
			data-file-path={entry.path}
			data-state={selected ? "selected" : "idle"}
			style={{ paddingInlineStart: treeRowIndent(depth) }}
		>
			<button
				type="button"
				className="min-w-0 grow shrink basis-32 text-left"
				aria-label={entry.path}
				title={entry.path}
				onClick={() => onSelectFile(entry.path)}
			>
				<ChangedFileName
					text={label}
					className="block min-w-0 truncate font-mono text-xs"
				/>
			</button>
			{rating !== undefined && (
				<span
					role="img"
					aria-label={`Importance ${rating.score} of 5`}
					title={importanceTitle(rating.score)}
					className={`size-2.5 shrink-0 rounded-full ${IMPORTANCE_BG_CLASS[rating.score]}`}
				/>
			)}
			<span className="flex min-w-0 shrink-0 flex-wrap gap-1 text-xs tabular-nums">
				<span className="max-w-full break-all text-success">
					+{entry.file.insertions}
				</span>
				<span className="max-w-full break-all text-destructive">
					−{entry.file.deletions}
				</span>
			</span>
			<Tooltip>
				<TooltipTrigger
					render={
						<Checkbox
							checked={viewedFiles.includes(entry.path)}
							aria-label={`Viewed ${entry.path}`}
							onCheckedChange={(checked) =>
								onViewedChange([entry.path], checked === true)
							}
						/>
					}
				/>
				<TooltipContent>Viewed</TooltipContent>
			</Tooltip>
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
	onViewedChange: (paths: readonly string[], viewed: boolean) => void;
	registerRow: (path: string, element: HTMLElement | null) => void;
	importanceByPath?: ReadonlyMap<string, ImportanceRating>;
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
	importanceByPath,
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
			<div
				data-folder-row={node.path}
				className="group flex min-h-7 w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-0.5 text-sm transition-colors duration-150 hover:bg-muted/60 sm:px-4"
				style={{ paddingInlineStart: treeRowIndent(depth) }}
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
							className="flex h-7 min-w-0 grow shrink basis-32 items-center justify-start gap-2 rounded-none px-0 text-left text-sm hover:bg-transparent hover:text-inherit aria-expanded:bg-transparent aria-expanded:text-inherit"
						>
							<Folder className="size-3 shrink-0" aria-hidden />
							<ChangedFileName
								text={node.name}
								className="block min-w-0 flex-1 truncate font-mono text-xs"
							/>
						</Button>
					}
				/>
			</div>
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
							importanceByPath={importanceByPath}
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
							rating={importanceByPath?.get(child.entry.path)}
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
	importance,
	importanceByPath,
}: ChangedFilesProps): ReactElement {
	const [mode, setMode] = useState<ChangedFilesMode>("list");
	const [filterQuery, setFilterQuery] = useState("");
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
	const normalizedFilterQuery = useMemo(
		() => filterQuery.toLowerCase(),
		[filterQuery],
	);
	const matchingEntries = useMemo(
		() =>
			normalizedFilterQuery.length === 0
				? entries
				: entries.filter((entry) =>
						entry.path.toLowerCase().includes(normalizedFilterQuery),
					),
		[entries, normalizedFilterQuery],
	);
	const tree = useMemo(
		() => buildChangedFileTree(matchingEntries),
		[matchingEntries],
	);
	const displayTree = useMemo(() => compactChangedFileTree(tree), [tree]);
	const listItems = useMemo(
		() => buildChangedFileList(matchingEntries),
		[matchingEntries],
	);

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
	const pendingScrollPath = useRef<string | null>(null);

	useEffect(() => {
		let active = true;
		let frame: number | null = null;
		const pendingTransitions = new Set<HTMLElement>();
		let onTransitionEnd: ((event: TransitionEvent) => void) | null = null;
		const previousTarget = scrollTarget.current;
		const selectionOrModeChanged =
			previousTarget === null ||
			previousTarget.selectedPath !== selectedPath ||
			previousTarget.mode !== mode;

		if (selectionOrModeChanged) {
			scrollTarget.current = { selectedPath, mode };
			pendingScrollPath.current = null;
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
					pendingScrollPath.current = selectedPath;
					setCollapsedFolderPaths(revealed);
					return;
				}
			}
		}

		const shouldScroll =
			selectionOrModeChanged || pendingScrollPath.current === selectedPath;
		if (shouldScroll) {
			const selectedRow =
				selectedPath === null
					? undefined
					: rowRegistry.current.get(selectedPath);
			const scroll = () => {
				if (!active || selectedPath === null) return;
				if (!rowRegistry.current.has(selectedPath)) return;
				scrollSelectedFileRow(rowRegistry.current, selectedPath);
				if (pendingScrollPath.current === selectedPath) {
					pendingScrollPath.current = null;
				}
			};
			const scrollAfterDisclosureLayout = () => {
				if (!active) return;
				let ancestor = selectedRow?.parentElement ?? null;
				while (ancestor !== null) {
					if (
						ancestor.getAttribute("data-slot") === "collapsible-content" &&
						typeof ancestor.getAnimations === "function" &&
						ancestor
							.getAnimations()
							.some((animation) => animation.playState === "running")
					) {
						pendingTransitions.add(ancestor);
					}
					ancestor = ancestor.parentElement;
				}

				if (pendingTransitions.size === 0) {
					scroll();
					return;
				}

				onTransitionEnd = (event) => {
					const panel = event.currentTarget as HTMLElement;
					if (
						event.target !== panel ||
						(event.type === "transitionend" && event.propertyName !== "height")
					) {
						return;
					}
					pendingTransitions.delete(panel);
					panel.removeEventListener(
						"transitionend",
						onTransitionEnd as EventListener,
					);
					panel.removeEventListener(
						"transitioncancel",
						onTransitionEnd as EventListener,
					);
					if (pendingTransitions.size === 0) scroll();
				};
				for (const panel of pendingTransitions) {
					panel.addEventListener("transitionend", onTransitionEnd);
					panel.addEventListener("transitioncancel", onTransitionEnd);
				}
			};
			if (
				pendingScrollPath.current === selectedPath &&
				typeof requestAnimationFrame === "function"
			) {
				frame = requestAnimationFrame(() => {
					frame = requestAnimationFrame(scrollAfterDisclosureLayout);
				});
			} else {
				scrollAfterDisclosureLayout();
			}
		}

		return () => {
			active = false;
			if (frame !== null) cancelAnimationFrame(frame);
			if (onTransitionEnd !== null) {
				for (const panel of pendingTransitions) {
					panel.removeEventListener(
						"transitionend",
						onTransitionEnd as EventListener,
					);
					panel.removeEventListener(
						"transitioncancel",
						onTransitionEnd as EventListener,
					);
				}
			}
		};
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
					importanceByPath={importanceByPath}
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
				rating={importanceByPath?.get(node.entry.path)}
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
				filterQuery={filterQuery}
				onFilterQueryChange={setFilterQuery}
				importance={importance}
			/>
			<nav
				className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
				aria-label="Changed files"
			>
				{mode === "list"
					? listItems.map((item) =>
							item.kind === "group" ? (
								<Fragment key={`group:${item.parentPath}`}>
									<h2
										aria-label={item.parentPath}
										data-list-group={item.parentPath}
										title={item.parentPath}
										className="m-0 min-w-0 overflow-hidden px-2 py-1.5 text-muted-foreground sm:px-4"
										style={{ paddingInlineStart: treeRowIndent(0) }}
									>
										<ChangedFileName
											text={item.parentPath}
											className="block min-w-0 truncate font-mono text-xs font-medium"
										/>
									</h2>
									{item.entries.map((entry) => (
										<ChangedFileRow
											key={`file:${entry.path}`}
											entry={entry}
											label={entry.path.slice(entry.path.lastIndexOf("/") + 1)}
											depth={1}
											selectedPath={selectedPath}
											viewedFiles={viewedFiles}
											onSelectFile={onSelectFile}
											onViewedChange={onViewedChange}
											registerRow={registerRow}
											rating={importanceByPath?.get(entry.path)}
										/>
									))}
								</Fragment>
							) : (
								<ChangedFileRow
									key={`file:${item.entry.path}`}
									entry={item.entry}
									label={item.name}
									depth={0}
									selectedPath={selectedPath}
									viewedFiles={viewedFiles}
									onSelectFile={onSelectFile}
									onViewedChange={onViewedChange}
									registerRow={registerRow}
									rating={importanceByPath?.get(item.entry.path)}
								/>
							),
						)
					: displayTree.map((node) => renderTreeNode(node, 0))}
			</nav>
		</>
	);
}
