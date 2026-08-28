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
import {
	CONTEXT_CHUNK_SIZE,
	type ContextGap,
	diffContextGaps,
	gapLineCount,
	hiddenContextRange,
	revealedContextLines,
	splitSourceLines,
} from "../../../../shared/diff-context";
import type {
	DiffHunk,
	DiffLine,
	ParsedFileDiff,
} from "../../../../shared/diff-parse";
import {
	escapeHtml,
	renderMarkdownBlocks,
	wrapMarkdownBlocksWithActions,
} from "../../../../shared/markdown";
import { type Draft, isMarkdownSelection } from "../../state";
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

/** Selection for a Tag/Comment action anchored to a rendered-markdown block. */
export interface MarkdownBlockSelection {
	path: string;
	startLine: number;
	endLine: number;
	quote: string;
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
	wholeFile?: boolean;
	onWholeFileChange?: (
		wholeFile: boolean,
		sourceLineCount: number | null,
	) => void;
	onViewModeChange?: (mode: FileViewMode) => void;
	onExpandDiff?: (file: ParsedFileDiff) => Promise<ParsedFileDiff | null>;
	onLineSelection?: (selection: DiffLineSelection) => void;
	onCommentSelection?: (selection: DiffLineSelection) => void;
	onMarkdownTag?: (selection: MarkdownBlockSelection) => void;
	onMarkdownComment?: (selection: MarkdownBlockSelection) => void;
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
let nextCodeBlockId = 0;
let mermaidConfigured = false;
const mermaidRenderCache = new Map<
	string,
	{ svg: string; bindFunctions?: (element: Element) => void }
>();
const codeHighlightCache = new Map<string, string>();

interface RenderedMarkdown {
	html: string;
	mermaidSources: Map<string, string>;
	codeSources: Map<string, { code: string; lang: string }>;
	blockRanges: Map<string, { startLine: number; endLine: number }>;
}

function renderMarkdown(source: string): RenderedMarkdown {
	const mermaidSources = new Map<string, string>();
	const codeSources = new Map<string, { code: string; lang: string }>();
	const blocks = renderMarkdownBlocks(source, (renderer) => {
		const defaultTable = renderer.table.bind(renderer);
		renderer.code = (token: Tokens.Code) => {
			if (token.lang?.trim().toLowerCase() === "mermaid") {
				const id = `mole-mermaid-${nextMermaidId++}`;
				mermaidSources.set(id, token.text);
				return `<div class="mermaid-block" data-mermaid-id="${id}">Loading diagram...</div>`;
			}
			const id = `mole-code-${nextCodeBlockId++}`;
			codeSources.set(id, {
				code: token.text,
				lang: token.lang?.trim() || "text",
			});
			return `<div class="code-block" data-code-block-id="${id}"><pre><code>${escapeHtml(
				token.text,
			)}</code></pre></div>`;
		};
		renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
		renderer.table = (token: Tokens.Table) =>
			`<div class="rendered-table-wrap">${defaultTable(token)}</div>`;
	});
	const { html: bodyHtml, blockRanges } = wrapMarkdownBlocksWithActions(blocks);
	const html = DOMPurify.sanitize(bodyHtml, {
		ADD_ATTR: [
			"data-mermaid-id",
			"data-code-block-id",
			"data-block-id",
			"data-source-line-start",
			"data-source-line-end",
		],
		FORBID_TAGS: ["embed", "iframe", "object", "script", "style"],
	});
	return { html, mermaidSources, codeSources, blockRanges };
}

function RenderedMarkdown({
	source,
	path,
	drafts,
	commentDraftProps,
	onTagBlock,
	onCommentBlock,
}: {
	source: string;
	path: string;
	drafts: readonly Draft[];
	commentDraftProps: Pick<
		CommentDraftProps,
		"onCancel" | "onEdit" | "onSend" | "onRetry"
	>;
	onTagBlock?: (selection: MarkdownBlockSelection) => void;
	onCommentBlock?: (selection: MarkdownBlockSelection) => void;
}) {
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
		if (
			!rendered ||
			!container ||
			(rendered.mermaidSources.size === 0 && rendered.codeSources.size === 0)
		) {
			return;
		}
		const tasks: Promise<void>[] = [];
		if (rendered.mermaidSources.size > 0) {
			if (!mermaidConfigured) {
				mermaid.initialize({
					securityLevel: "strict",
					startOnLoad: false,
					theme: "dark",
					htmlLabels: false,
				});
				mermaidConfigured = true;
			}
			const mermaidPlaceholders = [
				...container.querySelectorAll<HTMLElement>("[data-mermaid-id]"),
			];
			tasks.push(
				...mermaidPlaceholders.map(async (placeholder, index) => {
					const id = placeholder.dataset.mermaidId;
					const mermaidSource = id
						? rendered.mermaidSources.get(id)
						: undefined;
					if (mermaidSource === undefined) return;
					// A prior (possibly interrupted) render of this exact diagram may
					// have already completed; reuse it instead of re-racing mermaid.
					const cached = mermaidRenderCache.get(mermaidSource);
					if (cached) {
						placeholder.replaceChildren();
						placeholder.innerHTML = DOMPurify.sanitize(cached.svg, {
							USE_PROFILES: { svg: true, svgFilters: true },
						});
						cached.bindFunctions?.(placeholder);
						return;
					}
					try {
						const result = await mermaid.render(
							`mole-mermaid-render-${index}-${id ?? "unknown"}`,
							mermaidSource,
						);
						mermaidRenderCache.set(mermaidSource, result);
						if (!placeholder.isConnected) return;
						placeholder.replaceChildren();
						placeholder.innerHTML = DOMPurify.sanitize(result.svg, {
							USE_PROFILES: { svg: true, svgFilters: true },
						});
						result.bindFunctions?.(placeholder);
					} catch (reason: unknown) {
						if (!placeholder.isConnected) return;
						const error = document.createElement("p");
						error.className = "mermaid-error";
						error.textContent = `Mermaid render failed: ${
							reason instanceof Error ? reason.message : String(reason)
						}`;
						const sourceBlock = document.createElement("pre");
						sourceBlock.className = "mermaid-source";
						sourceBlock.textContent = mermaidSource;
						placeholder.replaceChildren(error, sourceBlock);
					}
				}),
			);
		}
		if (rendered.codeSources.size > 0) {
			const codePlaceholders = [
				...container.querySelectorAll<HTMLElement>("[data-code-block-id]"),
			];
			tasks.push(
				...codePlaceholders.map(async (placeholder) => {
					const id = placeholder.dataset.codeBlockId;
					const entry = id ? rendered.codeSources.get(id) : undefined;
					if (entry === undefined) return;
					const cacheKey = `${entry.lang}\u0000${entry.code}`;
					// A prior (possibly interrupted) highlight of this exact snippet may
					// have already completed; reuse it instead of re-racing Shiki.
					const cached = codeHighlightCache.get(cacheKey);
					if (cached !== undefined) {
						placeholder.replaceChildren();
						placeholder.innerHTML = DOMPurify.sanitize(cached);
						return;
					}
					try {
						const highlighted = await codeToHtml(entry.code, {
							lang: entry.lang || "text",
							theme: "github-dark",
						});
						codeHighlightCache.set(cacheKey, highlighted);
						if (!placeholder.isConnected) return;
						placeholder.replaceChildren();
						placeholder.innerHTML = DOMPurify.sanitize(highlighted);
					} catch {
						// Unknown language to Shiki: keep the escaped plain-text fallback.
					}
				}),
			);
		}
		void Promise.all(tasks);
	}, [parsed.value]);

	// React can reset this container's innerHTML back to the placeholder markup
	// on a later re-render even when `source`/`parsed.value` haven't changed
	// (e.g. a sibling state update from unrelated polling). Re-applying any
	// already-resolved mermaid/Shiki result after every render closes that
	// window immediately instead of leaving the placeholder stuck until an
	// unrelated remount (e.g. toggling view mode) happens to retrigger it.
	useEffect(() => {
		const rendered = parsed.value;
		const container = containerRef.current;
		if (!rendered) return;
		for (const placeholder of container?.querySelectorAll<HTMLElement>(
			"[data-mermaid-id]",
		) ?? []) {
			if (placeholder.dataset.moleApplied === "1") continue;
			const mermaidSource = placeholder.dataset.mermaidId
				? rendered.mermaidSources.get(placeholder.dataset.mermaidId)
				: undefined;
			const cached = mermaidSource
				? mermaidRenderCache.get(mermaidSource)
				: undefined;
			if (!cached) continue;
			placeholder.replaceChildren();
			placeholder.innerHTML = DOMPurify.sanitize(cached.svg, {
				USE_PROFILES: { svg: true, svgFilters: true },
			});
			cached.bindFunctions?.(placeholder);
			placeholder.dataset.moleApplied = "1";
		}
		for (const placeholder of container?.querySelectorAll<HTMLElement>(
			"[data-code-block-id]",
		) ?? []) {
			if (placeholder.dataset.moleApplied === "1") continue;
			const entry = placeholder.dataset.codeBlockId
				? rendered.codeSources.get(placeholder.dataset.codeBlockId)
				: undefined;
			const cached = entry
				? codeHighlightCache.get(`${entry.lang}\u0000${entry.code}`)
				: undefined;
			if (cached === undefined) continue;
			placeholder.replaceChildren();
			placeholder.innerHTML = DOMPurify.sanitize(cached);
			placeholder.dataset.moleApplied = "1";
		}
	});

	useEffect(() => {
		const rendered = parsed.value;
		const container = containerRef.current;
		if (!rendered || !container) return;
		const handleBlockActionClick = (event: Event) => {
			const target = event.target as HTMLElement;
			const button = target.closest<HTMLElement>(
				".markdown-block-tag, .markdown-block-comment",
			);
			if (!button) return;
			const blockId = button.dataset.blockId;
			const range = blockId ? rendered.blockRanges.get(blockId) : undefined;
			if (!range) return;
			const quote = source
				.split("\n")
				.slice(range.startLine - 1, range.endLine)
				.join("\n");
			const selection: MarkdownBlockSelection = {
				path,
				startLine: range.startLine,
				endLine: range.endLine,
				quote,
			};
			if (button.classList.contains("markdown-block-tag")) {
				onTagBlock?.(selection);
			} else {
				onCommentBlock?.(selection);
			}
		};
		container.addEventListener("click", handleBlockActionClick);
		return () => container.removeEventListener("click", handleBlockActionClick);
	}, [parsed.value, path, source, onTagBlock, onCommentBlock]);

	if (parsed.error) {
		return (
			<div className="markdown-render-error">
				<p className="render-error">Markdown render failed: {parsed.error}</p>
				<pre className="mermaid-source">{source}</pre>
			</div>
		);
	}
	if (!parsed.value) return null;
	const markdownDrafts = drafts.filter(
		(draft) =>
			draft.filePath === path &&
			draft.status !== "posted" &&
			isMarkdownSelection(draft.selection),
	);
	return (
		<div className="markdown-view">
			<div
				className="rendered-markdown"
				ref={containerRef}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown output is sanitized with DOMPurify.
				dangerouslySetInnerHTML={{ __html: parsed.value.html }}
			/>
			{markdownDrafts.length > 0 ? (
				<div className="markdown-draft-list">
					{markdownDrafts.map((draft) => (
						<CommentDraft key={draft.id} draft={draft} {...commentDraftProps} />
					))}
				</div>
			) : null}
		</div>
	);
}

function MarkdownView({
	fileContents,
	fileContentsError,
	path,
	drafts,
	commentDraftProps,
	onTagBlock,
	onCommentBlock,
}: {
	fileContents: string | null;
	fileContentsError: string | null;
	path: string;
	drafts: readonly Draft[];
	commentDraftProps: Pick<
		CommentDraftProps,
		"onCancel" | "onEdit" | "onSend" | "onRetry"
	>;
	onTagBlock?: (selection: MarkdownBlockSelection) => void;
	onCommentBlock?: (selection: MarkdownBlockSelection) => void;
}) {
	if (fileContentsError)
		return <p className="render-error">{fileContentsError}</p>;
	if (fileContents === null)
		return <p className="placeholder">Loading file...</p>;
	return (
		<RenderedMarkdown
			source={fileContents}
			path={path}
			drafts={drafts}
			commentDraftProps={commentDraftProps}
			onTagBlock={onTagBlock}
			onCommentBlock={onCommentBlock}
		/>
	);
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
	if (isMarkdownSelection(draft.selection)) return false;
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
	gap,
	revealedCount,
	sourceLines,
	wholeFile,
	mode,
	language,
	path,
	hunk,
	onReveal,
	onRevealAll,
	onHide,
	onTag,
}: {
	gap: ContextGap;
	revealedCount: number;
	sourceLines: readonly string[] | null;
	mode: DiffMode;
	wholeFile: boolean;
	language: string;
	path: string;
	hunk: string;
	onReveal: () => void;
	onRevealAll: () => void;
	onHide: () => void;
	onTag?: (selection: DiffLineSelection) => void;
}) {
	const lines = revealedContextLines(gap, sourceLines, revealedCount);
	const hidden = hiddenContextRange(gap, revealedCount);
	const fullyRevealed = hidden === null;
	const controls =
		wholeFile || (hidden === null && gap.position !== "between") ? null : (
			<tr className="expand-context-row">
				<td colSpan={mode === "side-by-side" ? 4 : 3}>
					{fullyRevealed ? (
						<button type="button" onClick={onHide}>
							Hide lines {gap.newStart}-{gap.newEnd}
						</button>
					) : (
						<>
							<button type="button" onClick={onReveal}>
								Expand lines {hidden.startLine}-{hidden.endLine}
							</button>
							{gap.position !== "between" ? (
								<button type="button" onClick={onRevealAll}>
									Expand all
								</button>
							) : null}
						</>
					)}
				</td>
			</tr>
		);
	const content =
		revealedCount === 0 ? null : lines === null ? (
			<tr className="inter-hunk-context">
				<td colSpan={mode === "side-by-side" ? 4 : 3}>
					Context source unavailable for lines {gap.newStart}-{gap.newEnd}.
				</td>
			</tr>
		) : (
			lines.map((line) => (
				<DiffLineRow
					key={`${gap.id}-${line.newLine}-${line.text}`}
					line={{ kind: "context", ...line }}
					mode={mode}
					language={language}
					commentSide="new"
					onTag={
						onTag
							? () =>
									onTag({
										path,
										side: "new",
										startLine: line.newLine,
										endLine: line.newLine,
										hunk,
									})
							: undefined
					}
				/>
			))
		);
	return gap.position === "tail" ? (
		<>
			{content}
			{controls}
		</>
	) : (
		<>
			{controls}
			{content}
		</>
	);
}

interface LineSelectionAnchor extends SelectableLine {
	hunk: string;
}

function HunkRows({
	file,
	hunk,
	showHeader,
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
	showHeader: boolean;
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
	const selectedRange =
		rangeSelection?.hunk === hunk.header ? rangeSelection : null;
	return (
		<>
			{showHeader ? (
				<tr className="hunk-header">
					<td colSpan={mode === "side-by-side" ? 4 : 3}>
						<span>{hunk.header}</span>
					</td>
				</tr>
			) : null}
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
		</>
	);
}

function DiffTable({
	file,
	mode,
	fileContents,
	wholeFile,
	discussions,
	drafts,
	commentDraftProps,
	onLineSelection,
	onCommentSelection,
}: {
	file: ParsedFileDiff;
	mode: DiffMode;
	fileContents: string | null;
	wholeFile: boolean;
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
	const sourceLines = useMemo(
		() => (fileContents === null ? null : splitSourceLines(fileContents)),
		[fileContents],
	);
	const gaps = useMemo(
		() => diffContextGaps(file.hunks, sourceLines?.length ?? null),
		[file.hunks, sourceLines],
	);
	const [anchor, setAnchor] = useState<LineSelectionAnchor | null>(null);
	const [rangeSelection, setRangeSelection] =
		useState<DiffLineSelection | null>(null);
	const [revealedCounts, setRevealedCounts] = useState<Record<string, number>>(
		{},
	);
	const wasWholeFile = useRef(wholeFile);
	const visibleDrafts = drafts.filter((draft) => draft.status !== "posted");

	useEffect(() => {
		if (wholeFile) {
			setRevealedCounts(
				Object.fromEntries(gaps.map((gap) => [gap.id, gapLineCount(gap)])),
			);
		} else if (wasWholeFile.current) {
			setRevealedCounts({});
		}
		wasWholeFile.current = wholeFile;
	}, [wholeFile, gaps]);

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

	const tagLine = onLineSelection
		? (selection: DiffLineSelection) => {
				onLineSelection(selection);
				setAnchor(null);
				setRangeSelection(null);
			}
		: undefined;
	const updateRevealedCount = (gap: ContextGap, count: number) => {
		const nextCount = Math.min(Math.max(count, 0), gapLineCount(gap));
		setRevealedCounts((current) =>
			current[gap.id] === nextCount
				? current
				: { ...current, [gap.id]: nextCount },
		);
	};
	const renderContext = (gap: ContextGap, hunk: string) => (
		<ContextRows
			key={gap.id}
			gap={gap}
			revealedCount={revealedCounts[gap.id] ?? 0}
			sourceLines={sourceLines}
			wholeFile={wholeFile}
			mode={mode}
			language={language}
			path={path}
			hunk={hunk}
			onReveal={() => {
				const currentCount = revealedCounts[gap.id] ?? 0;
				updateRevealedCount(
					gap,
					gap.position === "between"
						? gapLineCount(gap)
						: currentCount + CONTEXT_CHUNK_SIZE,
				);
			}}
			onRevealAll={() => updateRevealedCount(gap, gapLineCount(gap))}
			onHide={() => updateRevealedCount(gap, 0)}
			onTag={tagLine}
		/>
	);
	const head = gaps.find((gap) => gap.position === "head");
	const tail = gaps.find((gap) => gap.position === "tail");

	return (
		<table className={`diff-table ${mode}`}>
			<tbody>
				{file.hunks.map((hunk, index) => {
					const precedingGap =
						index === 0
							? head
							: gaps.find((gap) => gap.id === `between-${index - 1}-${index}`);
					const anchorHunk =
						index === 0
							? hunk.header
							: (file.hunks[index - 1]?.header ?? hunk.header);
					const showHunkHeader =
						!wholeFile &&
						hunk.lines.length > 0 &&
						(precedingGap === undefined ||
							hiddenContextRange(
								precedingGap,
								revealedCounts[precedingGap.id] ?? 0,
							) !== null);
					return (
						<Fragment key={`${hunk.oldStart}-${hunk.newStart}-${hunk.header}`}>
							{precedingGap ? renderContext(precedingGap, anchorHunk) : null}
							<HunkRows
								file={file}
								hunk={hunk}
								showHeader={showHunkHeader}
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
								onTagHunk={tagLine}
								onCommentSelection={onCommentSelection}
							/>
						</Fragment>
					);
				})}
				{tail && file.hunks.length > 0
					? renderContext(
							tail,
							file.hunks[file.hunks.length - 1]?.header ?? "tail",
						)
					: null}
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
	wholeFile = false,
	onWholeFileChange,
	onViewModeChange,
	onExpandDiff,
	onLineSelection,
	onCommentSelection,
	onMarkdownTag,
	onMarkdownComment,
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
	const wholeFileEligible =
		file.status === "modified" && !binary && !noPatch && !showingRendered;
	const sourceLineCount =
		fileContents === null ? null : splitSourceLines(fileContents).length;
	const changeWholeFile = (next: boolean) => {
		if (!next) {
			const headers = Array.from(
				document.querySelectorAll<HTMLElement>(".diff-panel .hunk-header"),
			);
			const anchor = headers.reduce<HTMLElement | null>((nearest, header) => {
				if (
					nearest === null ||
					Math.abs(header.getBoundingClientRect().top) <
						Math.abs(nearest.getBoundingClientRect().top)
				) {
					return header;
				}
				return nearest;
			}, null);
			onWholeFileChange?.(false, sourceLineCount);
			if (anchor) {
				requestAnimationFrame(() =>
					requestAnimationFrame(() =>
						anchor.scrollIntoView({ block: "nearest" }),
					),
				);
			}
			return;
		}
		if (collapsed) setExpanded(true);
		onWholeFileChange?.(true, sourceLineCount);
	};
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
					{wholeFileEligible ? (
						<>
							<button
								aria-pressed={wholeFile}
								className={wholeFile ? "active" : ""}
								type="button"
								onClick={() => changeWholeFile(true)}
							>
								Whole file
							</button>
							<button
								aria-pressed={!wholeFile}
								className={!wholeFile ? "active" : ""}
								type="button"
								onClick={() => changeWholeFile(false)}
							>
								Diff only
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
					path={path}
					drafts={drafts}
					commentDraftProps={commentDraftProps}
					onTagBlock={onMarkdownTag}
					onCommentBlock={onMarkdownComment}
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
							wholeFile={wholeFile}
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
