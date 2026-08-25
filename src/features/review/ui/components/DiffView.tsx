import DOMPurify from "dompurify";
import type { Tokens } from "marked";
import mermaid from "mermaid";
import {
	Fragment,
	type KeyboardEvent,
	type MouseEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { codeToHtml } from "shiki";
import type { HostDiscussion } from "../../../../ports/git-host";
import type {
	DiffHunk,
	DiffLine,
	ParsedFileDiff,
} from "../../../../shared/diff-parse";
import { escapeHtml, renderMarkdownHtml } from "../../../../shared/markdown";
import type { Draft } from "../../state";
import { CommentDraft, type CommentDraftProps } from "./CommentDraft";
export type DiffMode = "inline" | "side-by-side";
export type FileViewMode = "rendered" | "diff";

export interface DiffLineSelection {
	path: string;
	side: "new" | "old";
	startLine: number;
	endLine: number;
	hunk: string;
}

interface DiffViewProps {
	file: ParsedFileDiff | null;
	mode: DiffMode;
	viewMode?: FileViewMode;
	largeFileLineThreshold: number;
	fileContents: string | null;
	fileContentsError: string | null;
	discussions?: readonly HostDiscussion[];
	drafts?: readonly Draft[];
	onModeChange: (mode: DiffMode) => void;
	onViewModeChange?: (mode: FileViewMode) => void;
	onExpandDiff?: (file: ParsedFileDiff) => Promise<ParsedFileDiff | null>;
	onLineSelection?: (selection: DiffLineSelection) => void;
	onCommentSelection?: (selection: DiffLineSelection) => void;
	onCancelDraft?: CommentDraftProps["onCancel"];
	onEditDraft?: CommentDraftProps["onEdit"];
	onSendDraft?: CommentDraftProps["onSend"];
	onRetryDraft?: CommentDraftProps["onRetry"];
}

export function isMarkdownPath(path: string): boolean {
	return /\.(?:md|mdx)$/i.test(path);
}

export function defaultFileViewMode(file: ParsedFileDiff): FileViewMode {
	return file.status === "added" && isMarkdownPath(file.newPath ?? "")
		? "rendered"
		: "diff";
}

interface CodeHighlightProps {
	text: string;
	language: string;
}

function CodeHighlight({ text, language }: CodeHighlightProps) {
	const [html, setHtml] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		void codeToHtml(text, {
			lang: language || "text",
			structure: "inline",
			theme: "github-dark",
		})
			.then((result) => {
				if (active) setHtml(result);
			})
			.catch(() => {
				if (active) setHtml(null);
			});
		return () => {
			active = false;
		};
	}, [language, text]);

	if (html) {
		// Shiki returns escaped HTML; this is the only rendering path for its output.
		// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki escapes highlighted source.
		return <span dangerouslySetInnerHTML={{ __html: html }} />;
	}
	return <>{text}</>;
}
let nextMermaidId = 0;
let mermaidConfigured = false;

interface RenderedMarkdown {
	html: string;
	mermaidSources: Map<string, string>;
}

function renderMarkdown(source: string): RenderedMarkdown {
	const mermaidSources = new Map<string, string>();
	const html = renderMarkdownHtml(source, (renderer) => {
		const defaultCode = renderer.code.bind(renderer);
		renderer.code = (token: Tokens.Code) => {
			if (token.lang?.trim().toLowerCase() !== "mermaid") {
				return defaultCode(token);
			}
			const id = `mole-mermaid-${nextMermaidId++}`;
			mermaidSources.set(id, token.text);
			return `<div class="mermaid-block" data-mermaid-id="${id}">Loading diagram...</div>`;
		};
		renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
	});
	return { html, mermaidSources };
}

function RenderedMarkdown({ source }: { source: string }) {
	const parsed = useMemo(() => {
		try {
			return { error: null, value: renderMarkdown(source) };
		} catch (reason: unknown) {
			return {
				error: reason instanceof Error ? reason.message : String(reason),
				value: null,
			};
		}
	}, [source]);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const rendered = parsed.value;
		const container = containerRef.current;
		if (!rendered || !container || rendered.mermaidSources.size === 0) {
			return;
		}
		if (!mermaidConfigured) {
			mermaid.initialize({
				securityLevel: "strict",
				startOnLoad: false,
				theme: "dark",
			});
			mermaidConfigured = true;
		}
		let cancelled = false;
		const placeholders = [
			...container.querySelectorAll<HTMLElement>("[data-mermaid-id]"),
		];
		void Promise.all(
			placeholders.map(async (placeholder, index) => {
				const id = placeholder.dataset.mermaidId;
				const source = id ? rendered.mermaidSources.get(id) : undefined;
				if (source === undefined) return;
				try {
					const result = await mermaid.render(
						`mole-mermaid-render-${index}-${id ?? "unknown"}`,
						source,
					);
					if (cancelled) return;
					placeholder.replaceChildren();
					placeholder.innerHTML = DOMPurify.sanitize(result.svg, {
						USE_PROFILES: { svg: true, svgFilters: true },
					});
					result.bindFunctions?.(placeholder);
				} catch (reason: unknown) {
					if (cancelled) return;
					const error = document.createElement("p");
					error.className = "mermaid-error";
					error.textContent = `Mermaid render failed: ${
						reason instanceof Error ? reason.message : String(reason)
					}`;
					const sourceBlock = document.createElement("pre");
					sourceBlock.className = "mermaid-source";
					sourceBlock.textContent = source;
					placeholder.replaceChildren(error, sourceBlock);
				}
			}),
		);
		return () => {
			cancelled = true;
		};
	}, [parsed.value]);

	if (parsed.error) {
		return (
			<div className="markdown-render-error">
				<p className="render-error">Markdown render failed: {parsed.error}</p>
				<pre className="mermaid-source">{source}</pre>
			</div>
		);
	}
	if (!parsed.value) return null;
	return (
		<div
			className="rendered-markdown"
			ref={containerRef}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown output is sanitized with DOMPurify.
			dangerouslySetInnerHTML={{ __html: parsed.value.html }}
		/>
	);
}

function MarkdownView({
	fileContents,
	fileContentsError,
}: {
	fileContents: string | null;
	fileContentsError: string | null;
}) {
	if (fileContentsError)
		return <p className="render-error">{fileContentsError}</p>;
	if (fileContents === null)
		return <p className="placeholder">Loading file...</p>;
	return <RenderedMarkdown source={fileContents} />;
}

interface SelectableLine {
	side: "new" | "old";
	line: number;
}
function discussionPositionLabel(position: HostDiscussion["position"]): string {
	if (!position) return "General discussion";
	const path = position.newPath ?? position.oldPath ?? "(unknown file)";
	const side = position.newLine !== null ? "new" : "old";
	const line = position.newLine ?? position.oldLine;
	return `${path}:${side}:${line ?? "unknown"}`;
}

function DiscussionCard({ discussion }: { discussion: HostDiscussion }) {
	return (
		<article
			className={`inline-discussion ${
				discussion.resolved ? "resolved" : "unresolved"
			}`}
			data-discussion-id={discussion.id}
		>
			<header className="inline-discussion-header">
				<strong>
					{discussion.resolved
						? "Resolved discussion"
						: "Unresolved discussion"}
				</strong>
				<span>{discussionPositionLabel(discussion.position)}</span>
			</header>
			{discussion.notes.length > 0 ? (
				discussion.notes.map((note) => (
					<div
						className={`inline-discussion-note ${note.system ? "system" : ""}`}
						key={note.id}
					>
						<strong>{note.author}</strong>
						<time dateTime={note.createdAt}>{note.createdAt}</time>
						<p>{note.body}</p>
					</div>
				))
			) : (
				<p className="inline-discussion-empty">No discussion notes.</p>
			)}
		</article>
	);
}

function discussionMatchesLine(
	discussion: HostDiscussion,
	file: ParsedFileDiff,
	line: DiffLine,
): boolean {
	const position = discussion.position;
	if (!position) return false;
	return (
		(position.newPath === file.newPath &&
			position.newLine !== null &&
			position.newLine === line.newLine) ||
		(position.oldPath === file.oldPath &&
			position.oldLine !== null &&
			position.oldLine === line.oldLine)
	);
}

function draftMatchesLine(
	draft: Draft,
	file: ParsedFileDiff,
	line: DiffLine,
	endOnly: boolean,
): boolean {
	const lineNumber =
		draft.selection.side === "old" ? line.oldLine : line.newLine;
	const path = draft.selection.side === "old" ? file.oldPath : file.newPath;
	if (
		lineNumber === null ||
		path === null ||
		path !== draft.filePath ||
		lineNumber < draft.selection.startLine ||
		lineNumber > draft.selection.endLine
	) {
		return false;
	}
	return !endOnly || lineNumber === draft.selection.endLine;
}

function InlineCommentRows({
	file,
	line,
	mode,
	discussions,
	drafts,
	commentDraftProps,
}: {
	file: ParsedFileDiff;
	line: DiffLine;
	mode: DiffMode;
	discussions: readonly HostDiscussion[];
	drafts: readonly Draft[];
	commentDraftProps: Pick<
		CommentDraftProps,
		"onCancel" | "onEdit" | "onSend" | "onRetry"
	>;
}) {
	const lineDiscussions = discussions.filter((discussion) =>
		discussionMatchesLine(discussion, file, line),
	);
	const lineDrafts = drafts.filter((draft) =>
		draftMatchesLine(draft, file, line, true),
	);
	if (lineDiscussions.length === 0 && lineDrafts.length === 0) return null;
	return (
		<tr className="inline-comment-row">
			<td colSpan={mode === "side-by-side" ? 4 : 3}>
				{lineDiscussions.map((discussion) => (
					<DiscussionCard key={discussion.id} discussion={discussion} />
				))}
				{lineDrafts.map((draft) => (
					<CommentDraft key={draft.id} draft={draft} {...commentDraftProps} />
				))}
			</td>
		</tr>
	);
}

function selectableLine(
	line: DiffLine,
	defaultSide: "new" | "old",
): SelectableLine | null {
	const side =
		line.kind === "del" ? "old" : line.kind === "add" ? "new" : defaultSide;
	const lineNumber = side === "old" ? line.oldLine : line.newLine;
	return lineNumber === null ? null : { side, line: lineNumber };
}

function lineLabel(line: DiffLine): string {
	return `${line.oldLine ?? ""}\n${line.newLine ?? ""}`;
}

function lineClass(line: DiffLine, selected = false): string {
	return `diff-line diff-line-${line.kind}${selected ? " line-selected" : ""}`;
}

interface ContextLine {
	line: number;
	text: string;
}

interface ContextRange {
	startLine: number;
	endLine: number;
	lines: ContextLine[] | null;
	side: "new" | "old";
}

type LineSelectionEvent = {
	shiftKey: boolean;
};

function LineActions({
	onTag,
	onComment,
}: {
	onTag?: () => void;
	onComment?: () => void;
}) {
	if (!onTag && !onComment) return null;
	return (
		<span className="line-actions">
			{onTag ? (
				<button
					type="button"
					className="line-tag"
					onClick={(event) => {
						event.stopPropagation();
						onTag();
					}}
					onKeyDown={(event) => event.stopPropagation()}
				>
					Tag line
				</button>
			) : null}
			{onComment ? (
				<button
					type="button"
					className="line-comment"
					onClick={(event) => {
						event.stopPropagation();
						onComment();
					}}
					onKeyDown={(event) => event.stopPropagation()}
				>
					Comment
				</button>
			) : null}
		</span>
	);
}

function DiffLineRow({
	line,
	mode,
	language,
	onSelect,
	onTag,
	onComment,
	commentSide,
	selected = false,
}: {
	line: DiffLine;
	mode: DiffMode;
	language: string;
	onSelect?: (event: LineSelectionEvent) => void;
	onTag?: () => void;
	onComment?: () => void;
	commentSide?: "new" | "old";
	selected?: boolean;
}) {
	const selectableProps = onSelect
		? {
				"aria-label": "Select diff line",
				onClick: (event: MouseEvent<HTMLTableRowElement>) => onSelect(event),
				onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onSelect(event);
					}
				},
				role: "button" as const,
				tabIndex: 0,
			}
		: {};
	return mode === "inline" ? (
		<tr
			className={lineClass(line, selected)}
			key={`${lineLabel(line)}-${line.kind}-${line.text}`}
			{...selectableProps}
		>
			<td className="line-number">{line.oldLine ?? ""}</td>
			<td className="line-number">{line.newLine ?? ""}</td>
			<td className="line-text">
				<span className="line-prefix">
					{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
				</span>
				<CodeHighlight text={line.text} language={language} />
				<LineActions onTag={onTag} onComment={onComment} />
			</td>
		</tr>
	) : (
		<tr
			className={lineClass(line, selected)}
			key={`${lineLabel(line)}-${line.kind}-${line.text}`}
			{...selectableProps}
		>
			<td className="line-number">{line.oldLine ?? ""}</td>
			<td className={`side-line ${line.kind === "del" ? "removed" : ""}`}>
				{line.kind === "add" ? (
					""
				) : (
					<>
						<CodeHighlight text={line.text} language={language} />
						{commentSide === "old" ? (
							<LineActions onTag={onTag} onComment={onComment} />
						) : null}
					</>
				)}
			</td>
			<td className="line-number">{line.newLine ?? ""}</td>
			<td className={`side-line ${line.kind === "add" ? "added" : ""}`}>
				{line.kind === "del" ? (
					""
				) : (
					<>
						<CodeHighlight text={line.text} language={language} />
						{commentSide === "new" ? (
							<LineActions onTag={onTag} onComment={onComment} />
						) : null}
					</>
				)}
			</td>
		</tr>
	);
}

function ContextRows({
	range,
	mode,
	language,
}: {
	range: ContextRange;
	mode: DiffMode;
	language: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const lines = range.lines ?? [];
	return (
		<>
			<tr className="expand-context-row">
				<td colSpan={mode === "side-by-side" ? 4 : 3}>
					<button type="button" onClick={() => setExpanded((value) => !value)}>
						{expanded
							? `Hide lines ${range.startLine}-${range.endLine}`
							: `Expand lines ${range.startLine}-${range.endLine}`}
					</button>
				</td>
			</tr>
			{expanded ? (
				lines.length > 0 ? (
					lines.map(({ line, text }) => (
						<DiffLineRow
							key={`${range.side}-${line}-${text}`}
							line={{
								kind: "context",
								oldLine: range.side === "old" ? line : null,
								newLine: range.side === "new" ? line : null,
								text,
							}}
							mode={mode}
							language={language}
						/>
					))
				) : (
					<tr className="inter-hunk-context">
						<td colSpan={mode === "side-by-side" ? 4 : 3}>
							Context source unavailable for lines {range.startLine}-
							{range.endLine}.
						</td>
					</tr>
				)
			) : null}
		</>
	);
}

interface LineSelectionAnchor extends SelectableLine {
	hunk: string;
}

function HunkRows({
	file,
	hunk,
	contextAfter,
	mode,
	language,
	path,
	defaultSide,
	anchor,
	rangeSelection,
	discussions,
	drafts,
	commentDraftProps,
	onLineClick,
	onTagHunk,
	onCommentSelection,
}: {
	file: ParsedFileDiff;
	hunk: DiffHunk;
	contextAfter: ContextRange | null;
	mode: DiffMode;
	language: string;
	path: string;
	defaultSide: "new" | "old";
	anchor: LineSelectionAnchor | null;
	rangeSelection: DiffLineSelection | null;
	discussions: readonly HostDiscussion[];
	drafts: readonly Draft[];
	commentDraftProps: Pick<
		CommentDraftProps,
		"onCancel" | "onEdit" | "onSend" | "onRetry"
	>;
	onLineClick?: (
		line: DiffLine,
		hunkHeader: string,
		event: LineSelectionEvent,
	) => void;
	onTagHunk?: (selection: DiffLineSelection) => void;
	onCommentSelection?: (selection: DiffLineSelection) => void;
}) {
	const hunkPoints = hunk.lines
		.map((line) => selectableLine(line, defaultSide))
		.filter((point): point is SelectableLine => point !== null);
	const primaryPoints = hunkPoints.filter(
		(point) => point.side === defaultSide,
	);
	const tagPoints = primaryPoints.length > 0 ? primaryPoints : hunkPoints;
	const hunkSelection: DiffLineSelection | null =
		tagPoints.length > 0
			? {
					path,
					side: tagPoints[0]?.side ?? defaultSide,
					startLine: Math.min(...tagPoints.map((point) => point.line)),
					endLine: Math.max(...tagPoints.map((point) => point.line)),
					hunk: hunk.header,
				}
			: null;
	const tagHunk =
		hunkSelection && onTagHunk ? () => onTagHunk(hunkSelection) : undefined;
	const commentHunk =
		hunkSelection && onCommentSelection
			? () => onCommentSelection(hunkSelection)
			: undefined;
	const selectedRange =
		rangeSelection?.hunk === hunk.header ? rangeSelection : null;
	return (
		<>
			<tr className="hunk-header">
				<td colSpan={mode === "side-by-side" ? 4 : 3}>
					<span>{hunk.header}</span>
					{commentHunk ? (
						<button
							type="button"
							className="hunk-comment"
							onClick={commentHunk}
							title="Add a comment to the full hunk"
						>
							Add comment
						</button>
					) : null}
					{tagHunk ? (
						<button
							type="button"
							className="hunk-tag"
							onClick={tagHunk}
							title="Add the full hunk as chat context"
						>
							Tag hunk
						</button>
					) : null}
				</td>
			</tr>
			{hunk.lines.map((line) => {
				const point = selectableLine(line, defaultSide);
				const selected =
					point !== null &&
					anchor?.hunk === hunk.header &&
					anchor.side === point.side &&
					anchor.line === point.line;
				const lineSelection = point
					? {
							path,
							side: point.side,
							startLine: point.line,
							endLine: point.line,
							hunk: hunk.header,
						}
					: null;
				return (
					<Fragment key={`${lineLabel(line)}-${line.kind}-${line.text}`}>
						<DiffLineRow
							line={line}
							mode={mode}
							language={language}
							selected={selected}
							commentSide={lineSelection?.side}
							onTag={
								lineSelection && onTagHunk
									? () => onTagHunk(lineSelection)
									: undefined
							}
							onComment={
								lineSelection && onCommentSelection
									? () => onCommentSelection(lineSelection)
									: undefined
							}
							onSelect={
								onLineClick
									? (event) => onLineClick(line, hunk.header, event)
									: undefined
							}
						/>
						<InlineCommentRows
							file={file}
							line={line}
							mode={mode}
							discussions={discussions}
							drafts={drafts}
							commentDraftProps={commentDraftProps}
						/>
					</Fragment>
				);
			})}
			{selectedRange ? (
				<tr className="selection-comment-row">
					<td colSpan={mode === "side-by-side" ? 4 : 3}>
						<span>
							Selected {selectedRange.side} lines {selectedRange.startLine}-
							{selectedRange.endLine}
						</span>
						{onCommentSelection ? (
							<button
								type="button"
								onClick={() => onCommentSelection(selectedRange)}
							>
								Add comment
							</button>
						) : null}
					</td>
				</tr>
			) : null}
			{contextAfter ? (
				<ContextRows range={contextAfter} mode={mode} language={language} />
			) : null}
		</>
	);
}

function DiffTable({
	file,
	mode,
	fileContents,
	discussions,
	drafts,
	commentDraftProps,
	onLineSelection,
	onCommentSelection,
}: {
	file: ParsedFileDiff;
	mode: DiffMode;
	fileContents: string | null;
	discussions: readonly HostDiscussion[];
	drafts: readonly Draft[];
	commentDraftProps: Pick<
		CommentDraftProps,
		"onCancel" | "onEdit" | "onSend" | "onRetry"
	>;
	onLineSelection?: (selection: DiffLineSelection) => void;
	onCommentSelection?: (selection: DiffLineSelection) => void;
}) {
	const path = file.newPath ?? file.oldPath ?? "";
	const language = path.split(".").pop() ?? "text";
	const defaultSide = file.status === "deleted" ? "old" : "new";
	const sourceLines = fileContents?.split(/\r?\n/) ?? null;
	const [anchor, setAnchor] = useState<LineSelectionAnchor | null>(null);
	const [rangeSelection, setRangeSelection] =
		useState<DiffLineSelection | null>(null);
	const visibleDrafts = drafts.filter((draft) => draft.status !== "posted");

	const selectLine = (
		line: DiffLine,
		hunkHeader: string,
		event: LineSelectionEvent,
	) => {
		const point = selectableLine(line, defaultSide);
		if (!point || !onLineSelection) return;
		if (
			anchor?.hunk === hunkHeader &&
			anchor.side === point.side &&
			(event.shiftKey || anchor.line !== point.line)
		) {
			const selection: DiffLineSelection = {
				path,
				side: point.side,
				startLine: Math.min(anchor.line, point.line),
				endLine: Math.max(anchor.line, point.line),
				hunk: hunkHeader,
			};
			onLineSelection(selection);
			setRangeSelection(selection);
			setAnchor(null);
			return;
		}
		setRangeSelection(null);
		setAnchor({ ...point, hunk: hunkHeader });
	};

	const tagHunk = onLineSelection
		? (selection: DiffLineSelection) => {
				onLineSelection(selection);
				setAnchor(null);
				setRangeSelection(null);
			}
		: undefined;

	return (
		<table className={`diff-table ${mode}`}>
			<tbody>
				{file.hunks.map((hunk, index) => {
					const next = file.hunks[index + 1];
					const currentStart =
						defaultSide === "old" ? hunk.oldStart : hunk.newStart;
					const currentLength =
						defaultSide === "old" ? hunk.oldLines : hunk.newLines;
					const nextStart =
						defaultSide === "old" ? next?.oldStart : next?.newStart;
					const contextStart = currentStart + currentLength;
					const contextAfter =
						next && nextStart !== undefined && nextStart > contextStart
							? {
									startLine: contextStart,
									endLine: nextStart - 1,
									lines:
										sourceLines
											?.slice(contextStart - 1, nextStart - 1)
											.map((text, offset) => ({
												line: contextStart + offset,
												text,
											})) ?? null,
									side: defaultSide,
								}
							: null;
					return (
						<HunkRows
							key={`${hunk.oldStart}-${hunk.newStart}-${hunk.header}`}
							file={file}
							hunk={hunk}
							contextAfter={contextAfter}
							mode={mode}
							language={language}
							path={path}
							defaultSide={defaultSide}
							anchor={anchor}
							rangeSelection={rangeSelection}
							discussions={discussions}
							drafts={visibleDrafts}
							commentDraftProps={commentDraftProps}
							onLineClick={onLineSelection ? selectLine : undefined}
							onTagHunk={tagHunk}
							onCommentSelection={onCommentSelection}
						/>
					);
				})}
			</tbody>
		</table>
	);
}

export function DiffView({
	file,
	mode,
	viewMode = "diff",
	largeFileLineThreshold,
	fileContents,
	fileContentsError,
	discussions = [],
	drafts = [],
	onModeChange,
	onViewModeChange,
	onExpandDiff,
	onLineSelection,
	onCommentSelection,
	onCancelDraft,
	onEditDraft,
	onSendDraft,
	onRetryDraft,
}: DiffViewProps) {
	const [expanded, setExpanded] = useState(false);
	const [expandedFile, setExpandedFile] = useState<ParsedFileDiff | null>(null);
	const [expanding, setExpanding] = useState(false);
	const [expansionError, setExpansionError] = useState<string | null>(null);

	if (!file) {
		return (
			<section className="empty-diff">
				Select changed file to inspect diff.
			</section>
		);
	}
	const path = file.newPath ?? file.oldPath ?? "(unknown file)";
	const markdown = isMarkdownPath(path);
	const showingRendered = markdown && viewMode === "rendered";
	const noPatch = file.hunks.length === 0;
	const overThreshold =
		file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0) >
		largeFileLineThreshold;
	const collapsed = !file.binary && (noPatch || overThreshold);
	const displayFile = expandedFile ?? file;
	const binary = displayFile.binary;
	const requestExpansion = () => {
		setExpanded(true);
		if (!noPatch || !onExpandDiff || expanding) return;
		setExpanding(true);
		setExpansionError(null);
		void onExpandDiff(file)
			.then((next) => setExpandedFile(next))
			.catch((reason: unknown) => {
				setExpansionError(
					reason instanceof Error ? reason.message : String(reason),
				);
			})
			.finally(() => setExpanding(false));
	};
	const commentDraftProps: Pick<
		CommentDraftProps,
		"onCancel" | "onEdit" | "onSend" | "onRetry"
	> = {
		onCancel: onCancelDraft ?? (() => undefined),
		onEdit: onEditDraft ?? (() => undefined),
		onSend: onSendDraft ?? (() => undefined),
		onRetry: onRetryDraft ?? (() => undefined),
	};

	return (
		<section className="diff-panel">
			<header className="diff-header">
				<div>
					<h2>{path}</h2>
					<p>
						{file.insertions} additions, {file.deletions} deletions
					</p>
				</div>
				<div className="diff-controls">
					{markdown ? (
						<>
							<button
								aria-pressed={showingRendered}
								className={showingRendered ? "active" : ""}
								type="button"
								onClick={() => onViewModeChange?.("rendered")}
							>
								Rendered
							</button>
							<button
								aria-pressed={!showingRendered}
								className={!showingRendered ? "active" : ""}
								type="button"
								onClick={() => onViewModeChange?.("diff")}
							>
								Diff
							</button>
						</>
					) : null}
					{!showingRendered ? (
						<>
							<button
								className={mode === "inline" ? "active" : ""}
								type="button"
								onClick={() => onModeChange("inline")}
							>
								Inline
							</button>
							<button
								className={mode === "side-by-side" ? "active" : ""}
								type="button"
								onClick={() => onModeChange("side-by-side")}
							>
								Side by side
							</button>
						</>
					) : null}
				</div>
			</header>
			{binary ? (
				<p className="stat-line">
					Binary file; {file.insertions} additions, {file.deletions} deletions.
				</p>
			) : null}
			{showingRendered && !binary ? (
				<MarkdownView
					fileContents={fileContents}
					fileContentsError={fileContentsError}
				/>
			) : null}
			{!showingRendered || binary ? (
				<>
					{fileContentsError ? (
						<p className="render-error">{fileContentsError}</p>
					) : null}
					{!binary && collapsed && !expanded ? (
						<div className="collapsed-diff">
							<p>
								{overThreshold
									? `Large diff collapsed after ${largeFileLineThreshold} lines.`
									: noPatch
										? "Diff contents unavailable for this file."
										: "Diff collapsed."}
							</p>
							<button type="button" onClick={requestExpansion}>
								Expand diff
							</button>
						</div>
					) : null}
					{!binary && collapsed && expanded && noPatch && !expandedFile ? (
						<p className="stat-line">
							{expanding
								? "Loading full diff..."
								: (expansionError ??
									"Diff contents unavailable for this file.")}
						</p>
					) : null}
					{!binary &&
					(!collapsed || (expanded && (!noPatch || expandedFile !== null))) ? (
						<DiffTable
							file={displayFile}
							mode={mode}
							fileContents={fileContents}
							discussions={discussions}
							drafts={drafts}
							commentDraftProps={commentDraftProps}
							onLineSelection={onLineSelection}
							onCommentSelection={onCommentSelection}
						/>
					) : null}
					{!file.binary && collapsed && expanded ? (
						<button type="button" onClick={() => setExpanded(false)}>
							Collapse diff
						</button>
					) : null}
				</>
			) : null}
		</section>
	);
}
