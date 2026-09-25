import DOMPurify from "dompurify";
import {
	ChevronDown,
	ChevronsUpDown,
	ChevronUp,
	CircleCheck,
	CircleDot,
	Columns2,
	Diff,
	Eye,
	EyeOff,
	Loader2,
	MessageSquarePlus,
	Minus,
	Pilcrow,
	Rows3,
	Search,
	Sparkles,
	Tag,
} from "lucide-react";
import type { Tokens } from "marked";
import mermaid from "mermaid";
import {
	Fragment,
	type KeyboardEvent,
	type MouseEvent,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { codeToHtml, codeToTokens, type ThemedToken } from "shiki";
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
import { type ColorTheme, useColorTheme } from "../color-theme";
import type { FromChatContext } from "../from-chat";
import { CommentDraft, type CommentDraftProps } from "./CommentDraft";
import { CommentMarkdown } from "./CommentMarkdown";
import {
	contextLineId,
	diffLineId,
	type FindRender,
	findCountText,
	findMatches,
	lineTextMatches,
	stepMatchIndex,
} from "./find";
import { IconButton } from "./IconButton";
import {
	type DiffDragRow,
	type DragAction,
	diffDragRange,
	isBlockInMarkdownDrag,
	isRowInDiffDrag,
	type MarkdownDragBlock,
	type MarkdownDragState,
	markdownDragRange,
	nextMarkdownDragEnd,
} from "./line-drag";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible";
import { Input } from "./ui/input";
import {
	SegmentedToggleGroup,
	SegmentedToggleGroupItem,
} from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useDiffDrag } from "./use-diff-drag";
export type DiffMode = "inline" | "side-by-side";
export type FileViewMode = "rendered" | "diff";

function TooltipToggleGroupItem({
	label,
	...props
}: Parameters<typeof SegmentedToggleGroupItem>[0] & { label: string }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={<SegmentedToggleGroupItem {...props} aria-label={label} />}
			/>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

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
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled?: boolean;
	onModeChange: (mode: DiffMode) => void;
	wholeFile?: boolean;
	onWholeFileChange?: (
		wholeFile: boolean,
		sourceLineCount: number | null,
	) => void;
	onViewModeChange?: (mode: FileViewMode) => void;
	viewed?: boolean;
	onViewedChange?: (viewed: boolean) => void;
	onExpandDiff?: (file: ParsedFileDiff) => Promise<ParsedFileDiff | null>;
	onLineSelection?: (selection: DiffLineSelection) => void;
	onCommentSelection?: (selection: DiffLineSelection) => void;
	onMarkdownTag?: (selection: MarkdownBlockSelection) => void;
	onFileTag?: (path: string) => void;
	onMarkdownComment?: (selection: MarkdownBlockSelection) => void;
	onCancelDraft?: CommentDraftProps["onCancel"];
	onEditDraft?: CommentDraftProps["onEdit"];
	onSendDraft?: CommentDraftProps["onSend"];
	onRetryDraft?: CommentDraftProps["onRetry"];
	fromChat?: FromChatContext;
	commentsCollapsed?: boolean;
	findQuery?: string;
	onFindQueryChange?: (query: string) => void;
}

type CommentDraftCallbacks = Pick<
	CommentDraftProps,
	"onCancel" | "onEdit" | "onSend" | "onRetry"
>;

function draftFromChat(
	fromChat: FromChatContext | undefined,
	draftId: string,
): CommentDraftProps["fromChat"] {
	if (!fromChat) return undefined;
	return {
		availability: fromChat.availability,
		generation: fromChat.generations[draftId],
		onGenerate: fromChat.onGenerate,
		onStop: fromChat.onStop,
	};
}

export function isMarkdownPath(path: string): boolean {
	return /\.(?:md|mdx)$/i.test(path);
}

export function defaultFileViewMode(file: ParsedFileDiff): FileViewMode {
	return file.status === "added" && isMarkdownPath(file.newPath ?? "")
		? "rendered"
		: "diff";
}

const SHIKI_THEMES = { dark: "github-dark", light: "github-light" } as const;

interface CodeHighlightProps {
	text: string;
	language: string;
	tokens?: readonly ThemedToken[];
	tokenized?: boolean;
}

interface HighlightSource {
	source: string;
	lineNumbers: readonly number[];
}

interface HighlightedCode {
	side: "new" | "old";
	tokensByLine: ReadonlyMap<number, readonly ThemedToken[]>;
}

function buildHighlightSources(
	file: ParsedFileDiff,
	fileContents: string | null,
	side: "new" | "old",
): HighlightSource[] {
	if (fileContents !== null) {
		const lineNumbers = splitSourceLines(fileContents).map(
			(_, index) => index + 1,
		);
		return lineNumbers.length > 0
			? [{ source: fileContents, lineNumbers }]
			: [];
	}
	return file.hunks.flatMap((hunk) => {
		const sourceLines: string[] = [];
		const lineNumbers: number[] = [];
		for (const line of hunk.lines) {
			const lineNumber = side === "new" ? line.newLine : line.oldLine;
			if (lineNumber === null) continue;
			sourceLines.push(line.text);
			lineNumbers.push(lineNumber);
		}
		return sourceLines.length > 0
			? [{ source: sourceLines.join("\n"), lineNumbers }]
			: [];
	});
}

function useCodeHighlights(
	file: ParsedFileDiff,
	fileContents: string | null,
	language: string,
): HighlightedCode {
	const side = file.status === "deleted" ? "old" : "new";
	const sources = useMemo(
		() => buildHighlightSources(file, fileContents, side),
		[file, fileContents, side],
	);
	const [tokensByLine, setTokensByLine] = useState<
		ReadonlyMap<number, readonly ThemedToken[]>
	>(() => new Map());

	useEffect(() => {
		let active = true;
		if (sources.length === 0) {
			return () => {
				active = false;
			};
		}
		void Promise.all(
			sources.map(async (source) => {
				try {
					const result = await codeToTokens(source.source, {
						lang: language || "text",
						themes: SHIKI_THEMES,
						defaultColor: "dark",
					});
					return { source, tokens: result.tokens };
				} catch {
					return null;
				}
			}),
		).then((results) => {
			if (!active) return;
			const next = new Map<number, readonly ThemedToken[]>();
			for (const result of results) {
				if (!result) continue;
				for (const [index, tokens] of result.tokens.entries()) {
					const lineNumber = result.source.lineNumbers[index];
					if (lineNumber !== undefined) next.set(lineNumber, tokens);
				}
			}
			setTokensByLine(next);
		});
		return () => {
			active = false;
		};
	}, [language, sources]);

	return { side, tokensByLine };
}

function lineHighlight(
	highlightedCode: HighlightedCode,
	side: "new" | "old",
	lineNumber: number | null,
): Pick<CodeHighlightProps, "tokens" | "tokenized"> {
	if (highlightedCode.side !== side || lineNumber === null) {
		return { tokenized: false };
	}
	return {
		tokens: highlightedCode.tokensByLine.get(lineNumber),
		tokenized: highlightedCode.tokensByLine.has(lineNumber),
	};
}

function CodeHighlight({
	text,
	language,
	tokens,
	tokenized = false,
}: CodeHighlightProps) {
	const [html, setHtml] = useState<string | null>(null);
	useEffect(() => {
		if (tokenized) {
			setHtml(null);
			return;
		}
		let active = true;
		void codeToHtml(text, {
			lang: language || "text",
			structure: "inline",
			themes: SHIKI_THEMES,
			defaultColor: "dark",
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
	}, [language, text, tokenized]);

	if (tokenized) {
		return tokens ? (
			<span className="shiki">
				{tokens.map((token) => (
					<span key={token.offset} style={token.htmlStyle}>
						{token.content}
					</span>
				))}
			</span>
		) : (
			text
		);
	}
	if (html) {
		// Shiki returns escaped HTML; this is the only rendering path for its output.
		return (
			<span
				className="shiki"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki escapes highlighted source.
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		);
	}
	return <>{text}</>;
}
let nextMermaidId = 0;
let nextCodeBlockId = 0;
type MermaidTheme = "dark" | "default";
function mermaidThemeFor(colorTheme: ColorTheme): MermaidTheme {
	return colorTheme === "light" ? "default" : "dark";
}
function mermaidCacheKey(theme: MermaidTheme, source: string): string {
	return `${theme}\u0000${source}`;
}
let mermaidConfiguredTheme: MermaidTheme | null = null;
let mermaidConfigurationGeneration = 0;
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
			return `<div class="code-block min-w-0 max-w-full" data-code-block-id="${id}"><pre><code>${escapeHtml(
				token.text,
			)}</code></pre></div>`;
		};
		renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
		renderer.table = (token: Tokens.Table) =>
			`<div class="rendered-table-wrap min-w-0 max-w-full">${defaultTable(token)}</div>`;
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

function MermaidThemeRenderer({
	rendered,
	containerRef,
}: {
	rendered: RenderedMarkdown | null;
	containerRef: { current: HTMLDivElement | null };
}) {
	const mermaidTheme = mermaidThemeFor(useColorTheme());

	useEffect(() => {
		const container = containerRef.current;
		if (!rendered || !container) return;
		let active = true;
		const tasks: Promise<void>[] = [];
		if (rendered.mermaidSources.size > 0) {
			if (mermaidConfiguredTheme !== mermaidTheme) {
				mermaid.initialize({
					securityLevel: "strict",
					startOnLoad: false,
					theme: mermaidTheme,
					htmlLabels: false,
				});
				mermaidConfiguredTheme = mermaidTheme;
				mermaidConfigurationGeneration += 1;
			}
			const mermaidGeneration = mermaidConfigurationGeneration;
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
					const cached = mermaidRenderCache.get(
						mermaidCacheKey(mermaidTheme, mermaidSource),
					);
					if (cached) {
						placeholder.replaceChildren();
						placeholder.innerHTML = DOMPurify.sanitize(cached.svg, {
							USE_PROFILES: { svg: true, svgFilters: true },
						});
						cached.bindFunctions?.(placeholder);
						placeholder.dataset.moleApplied = mermaidTheme;
						return;
					}
					try {
						const result = await mermaid.render(
							`mole-mermaid-render-${index}-${id ?? "unknown"}`,
							mermaidSource,
						);
						if (mermaidGeneration === mermaidConfigurationGeneration) {
							mermaidRenderCache.set(
								mermaidCacheKey(mermaidTheme, mermaidSource),
								result,
							);
						}
						if (!active || !placeholder.isConnected) return;
						placeholder.replaceChildren();
						placeholder.innerHTML = DOMPurify.sanitize(result.svg, {
							USE_PROFILES: { svg: true, svgFilters: true },
						});
						result.bindFunctions?.(placeholder);
						placeholder.dataset.moleApplied = mermaidTheme;
					} catch (reason: unknown) {
						if (!active || !placeholder.isConnected) return;
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
		void Promise.all(tasks);
		return () => {
			active = false;
		};
	}, [containerRef, rendered, mermaidTheme]);

	useEffect(() => {
		if (!rendered) return;
		const container = containerRef.current;
		for (const placeholder of container?.querySelectorAll<HTMLElement>(
			"[data-mermaid-id]",
		) ?? []) {
			if (placeholder.dataset.moleApplied === mermaidTheme) continue;
			const mermaidSource = placeholder.dataset.mermaidId
				? rendered.mermaidSources.get(placeholder.dataset.mermaidId)
				: undefined;
			const cached = mermaidSource
				? mermaidRenderCache.get(mermaidCacheKey(mermaidTheme, mermaidSource))
				: undefined;
			if (!cached) continue;
			placeholder.replaceChildren();
			placeholder.innerHTML = DOMPurify.sanitize(cached.svg, {
				USE_PROFILES: { svg: true, svgFilters: true },
			});
			cached.bindFunctions?.(placeholder);
			placeholder.dataset.moleApplied = mermaidTheme;
		}
	});

	return null;
}

/**
 * Resolves the nearest `.markdown-block` that recovered a source range from a
 * raw DOM element. Unmapped blocks carry neither `data-block-id` nor the
 * `data-source-line-*` attributes, so they never match the `[data-block-id]`
 * selector and resolve to `null` here — exactly the signal `nextMarkdownDragEnd`
 * needs to cross over them without ending the drag.
 */
function markdownDragBlockFromElement(
	element: Element | null,
): MarkdownDragBlock | null {
	const block = element?.closest?.(".markdown-block[data-block-id]");
	if (!block) return null;
	const blockId = block.getAttribute("data-block-id");
	const startLine = Number.parseInt(
		block.getAttribute("data-source-line-start") ?? "",
		10,
	);
	const endLine = Number.parseInt(
		block.getAttribute("data-source-line-end") ?? "",
		10,
	);
	if (blockId === null || Number.isNaN(startLine) || Number.isNaN(endLine)) {
		return null;
	}
	return { blockId, startLine, endLine };
}

/** Slices the inclusive source-line range into the quote text used by Tag/Comment. */
function markdownBlockQuote(
	source: string,
	range: { startLine: number; endLine: number },
): string {
	return source
		.split("\n")
		.slice(range.startLine - 1, range.endLine)
		.join("\n");
}

function RenderedMarkdown({
	source,
	path,
	drafts,
	commentDraftProps,
	fromChat,
	onTagBlock,
	onCommentBlock,
}: {
	source: string;
	path: string;
	drafts: readonly Draft[];
	commentDraftProps: CommentDraftCallbacks;
	fromChat?: FromChatContext;
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
	const [drag, setDrag] = useState<MarkdownDragState | null>(null);
	const dragRef = useRef<MarkdownDragState | null>(null);

	useEffect(() => {
		const rendered = parsed.value;
		const container = containerRef.current;
		if (!rendered || !container || rendered.codeSources.size === 0) return;
		let active = true;
		const tasks = [
			...container.querySelectorAll<HTMLElement>("[data-code-block-id]"),
		].map(async (placeholder) => {
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
				placeholder.dataset.moleApplied = "1";
				return;
			}
			try {
				const highlighted = await codeToHtml(entry.code, {
					lang: entry.lang || "text",
					themes: SHIKI_THEMES,
					defaultColor: "dark",
				});
				codeHighlightCache.set(cacheKey, highlighted);
				if (!active || !placeholder.isConnected) return;
				placeholder.replaceChildren();
				placeholder.innerHTML = DOMPurify.sanitize(highlighted);
				placeholder.dataset.moleApplied = "1";
			} catch {
				// Unknown language to Shiki: keep the escaped plain-text fallback.
			}
		});
		void Promise.all(tasks);
		return () => {
			active = false;
		};
	}, [parsed.value]);

	// React can reset this container's innerHTML on a later parent render even
	// when the parsed Markdown is unchanged. Restore cached Shiki output after
	// each render so code blocks do not remain at their plain-text fallback.
	useEffect(() => {
		const rendered = parsed.value;
		const container = containerRef.current;
		if (!rendered) return;
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
		const resolveBlock = (button: HTMLElement): MarkdownDragBlock | null => {
			const blockId = button.dataset.blockId;
			const range = blockId ? rendered.blockRanges.get(blockId) : undefined;
			if (!blockId || !range) return null;
			return { blockId, startLine: range.startLine, endLine: range.endLine };
		};
		const commitBlock = (button: HTMLElement, block: MarkdownDragBlock) => {
			const selection: MarkdownBlockSelection = {
				path,
				startLine: block.startLine,
				endLine: block.endLine,
				quote: markdownBlockQuote(source, block),
			};
			if (button.classList.contains("markdown-block-tag")) {
				onTagBlock?.(selection);
			} else {
				onCommentBlock?.(selection);
			}
		};
		const handleMouseDown = (event: Event) => {
			const target = event.target as HTMLElement;
			const button = target.closest<HTMLElement>(
				".markdown-block-tag, .markdown-block-comment",
			);
			if (!button) return;
			const block = resolveBlock(button);
			if (!block) return;
			event.preventDefault();
			const nextDrag: MarkdownDragState = {
				action: button.classList.contains("markdown-block-tag")
					? "tag"
					: "comment",
				origin: block,
				end: block,
			};
			dragRef.current = nextDrag;
			setDrag(nextDrag);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			const target = event.target as HTMLElement;
			const button = target.closest<HTMLElement>(
				".markdown-block-tag, .markdown-block-comment",
			);
			if (!button) return;
			const block = resolveBlock(button);
			if (!block) return;
			event.preventDefault();
			commitBlock(button, block);
		};
		container.addEventListener("mousedown", handleMouseDown);
		container.addEventListener("keydown", handleKeyDown);
		return () => {
			container.removeEventListener("mousedown", handleMouseDown);
			container.removeEventListener("keydown", handleKeyDown);
		};
	}, [parsed.value, path, source, onTagBlock, onCommentBlock]);

	const commitDrag = (current: MarkdownDragState) => {
		const { startLine, endLine } = markdownDragRange(
			current.origin,
			current.end,
		);
		const selection: MarkdownBlockSelection = {
			path,
			startLine,
			endLine,
			quote: markdownBlockQuote(source, { startLine, endLine }),
		};
		if (current.action === "tag") onTagBlock?.(selection);
		else onCommentBlock?.(selection);
	};
	const commitDragRef = useRef(commitDrag);
	commitDragRef.current = commitDrag;

	const isDragging = drag !== null;
	useEffect(() => {
		if (!isDragging) return;
		const handleMouseMove = (event: Event) => {
			const current = dragRef.current;
			if (!current) return;
			const candidate = markdownDragBlockFromElement(
				event.target as HTMLElement | null,
			);
			const nextEnd = nextMarkdownDragEnd(current.end, candidate);
			if (nextEnd === current.end) return;
			const nextDrag = { ...current, end: nextEnd };
			dragRef.current = nextDrag;
			setDrag(nextDrag);
		};
		const handleMouseUp = () => {
			const current = dragRef.current;
			if (!current) return;
			dragRef.current = null;
			setDrag(null);
			commitDragRef.current(current);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			dragRef.current = null;
			setDrag(null);
		};
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			window.removeEventListener("keydown", handleKeyDown, {
				capture: true,
			});
		};
	}, [isDragging]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		for (const block of container.querySelectorAll<HTMLElement>(
			".markdown-block[data-block-id]",
		)) {
			const candidate = markdownDragBlockFromElement(block);
			const inDrag =
				drag !== null &&
				candidate !== null &&
				isBlockInMarkdownDrag(candidate, drag);
			block.toggleAttribute("data-drag-selected", inDrag);
		}
	}, [drag]);

	if (parsed.error) {
		return (
			<div>
				<Alert variant="destructive">
					Markdown render failed: {parsed.error}
				</Alert>
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
		<div className="min-w-0 max-w-full">
			<MermaidThemeRenderer
				rendered={parsed.value}
				containerRef={containerRef}
			/>
			<div
				className="rendered-markdown min-w-0 max-w-full pl-4 [overflow-wrap:anywhere]"
				ref={containerRef}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown output is sanitized with DOMPurify.
				dangerouslySetInnerHTML={{ __html: parsed.value.html }}
			/>
			{markdownDrafts.length > 0 ? (
				<div>
					{markdownDrafts.map((draft) => (
						<CommentDraft
							key={draft.id}
							draft={draft}
							{...commentDraftProps}
							fromChat={draftFromChat(fromChat, draft.id)}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}
const MemoizedRenderedMarkdown = memo(RenderedMarkdown);

function MarkdownView({
	fileContents,
	fileContentsError,
	path,
	drafts,
	commentDraftProps,
	fromChat,
	onTagBlock,
	onCommentBlock,
}: {
	fileContents: string | null;
	fileContentsError: string | null;
	path: string;
	drafts: readonly Draft[];
	commentDraftProps: CommentDraftCallbacks;
	fromChat?: FromChatContext;
	onTagBlock?: (selection: MarkdownBlockSelection) => void;
	onCommentBlock?: (selection: MarkdownBlockSelection) => void;
}) {
	if (fileContentsError)
		return <Alert variant="destructive">{fileContentsError}</Alert>;
	if (fileContents === null)
		return <p className="placeholder">Loading file...</p>;
	return (
		<MemoizedRenderedMarkdown
			source={fileContents}
			path={path}
			drafts={drafts}
			commentDraftProps={commentDraftProps}
			onTagBlock={onTagBlock}
			fromChat={fromChat}
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
	const side = position.newLine !== null ? "new" : "old";
	const line = position.newLine ?? position.oldLine;
	return `${side}:${line ?? "unknown"}`;
}

/**
 * First non-blank line of the first non-system note body — the single-line
 * preview shown while a discussion is collapsed.
 */
function discussionPreview(discussion: HostDiscussion): string {
	const note = discussion.notes.find(
		(candidate) => !candidate.system && candidate.body.trim().length > 0,
	);
	for (const line of (note?.body ?? "").split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length > 0) return trimmed;
	}
	return "";
}

function DiscussionCard({
	discussion,
	collapsed,
	onToggleCollapse,
	onExplainDiscussion,
	explainDisabled,
}: {
	discussion: HostDiscussion;
	collapsed: boolean;
	onToggleCollapse: () => void;
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled?: boolean;
}) {
	const expanded = !collapsed;
	const preview = discussionPreview(discussion);
	const firstNote =
		discussion.notes.find((note) => !note.system) ?? discussion.notes[0];
	const author = firstNote?.author ?? "Discussion";
	return (
		<Collapsible
			className="min-w-0 max-w-full overflow-hidden rounded-md border border-l-2 bg-card shadow-xs data-[resolved=true]:border-l-success data-[resolved=false]:border-l-warning"
			data-collapsed={collapsed ? "true" : "false"}
			data-discussion-id={discussion.id}
			data-resolved={discussion.resolved ? "true" : "false"}
			open={expanded}
			onOpenChange={(open) => {
				if (open !== expanded) onToggleCollapse();
			}}
			render={<article />}
		>
			<header className="flex min-w-0 flex-wrap items-center gap-2 p-3">
				<CollapsibleTrigger
					aria-label={`${expanded ? "Collapse" : "Expand"} discussion`}
					aria-controls={`discussion-body-${discussion.id}`}
					render={
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="group"
						/>
					}
				>
					<ChevronDown
						className="transition-transform duration-200 ease-out group-data-[panel-open]:rotate-0 -rotate-90"
						aria-hidden
					/>
				</CollapsibleTrigger>
				{discussion.resolved ? (
					<CircleCheck className="size-4 text-success" aria-hidden />
				) : (
					<CircleDot className="size-4 text-warning" aria-hidden />
				)}
				<span className="min-w-0 max-w-full shrink-0 break-words whitespace-normal text-sm font-medium [overflow-wrap:anywhere]">
					{author}
				</span>
				{expanded ? (
					<>
						<span className="min-w-0 flex-1 break-words whitespace-normal text-xs text-muted-foreground [overflow-wrap:anywhere]">
							{discussionPositionLabel(discussion.position)}
						</span>
						{onExplainDiscussion ? (
							<div
								className="flex min-w-0 shrink-0 items-center gap-1"
								data-action-group="discussion-actions"
							>
								<Button
									type="button"
									variant="default"
									size="xs"
									data-action="explain"
									disabled={explainDisabled}
									aria-busy={explainDisabled ? "true" : undefined}
									onClick={() => onExplainDiscussion(discussion.id)}
								>
									{explainDisabled ? (
										<Loader2 className="animate-spin" aria-hidden />
									) : (
										<Sparkles aria-hidden />
									)}
									Explain
								</Button>
							</div>
						) : null}
					</>
				) : (
					<span
						className="min-w-0 flex-1 break-words whitespace-normal text-xs text-muted-foreground italic [overflow-wrap:anywhere]"
						title={preview.length > 0 ? preview : undefined}
					>
						{preview}
					</span>
				)}
			</header>
			<CollapsibleContent
				keepMounted
				id={`discussion-body-${discussion.id}`}
				className="min-w-0 max-w-full space-y-2 px-3 pb-3"
			>
				<div className="min-w-0 max-w-full divide-y">
					{discussion.notes.length > 0 ? (
						discussion.notes.map((note) => (
							<div
								className={`min-w-0 max-w-full py-2 text-sm${note.system ? " opacity-70" : ""}`}
								key={note.id}
							>
								<CommentMarkdown body={note.body} />
							</div>
						))
					) : (
						<p className="py-2 text-sm">No discussion notes.</p>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
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

function discussionMatchesDiff(
	discussion: HostDiscussion,
	file: ParsedFileDiff,
): boolean {
	return file.hunks.some((hunk) =>
		hunk.lines.some((line) => discussionMatchesLine(discussion, file, line)),
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
	collapsedDiscussionIds,
	onToggleDiscussionCollapse,
	onExplainDiscussion,
	explainDisabled,
	drafts,
	commentDraftProps,
	fromChat,
}: {
	file: ParsedFileDiff;
	line: DiffLine;
	mode: DiffMode;
	discussions: readonly HostDiscussion[];
	collapsedDiscussionIds: ReadonlySet<string>;
	onToggleDiscussionCollapse: (discussionId: string) => void;
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled?: boolean;
	drafts: readonly Draft[];
	commentDraftProps: CommentDraftCallbacks;
	fromChat?: FromChatContext;
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
			<td
				className="min-w-0 max-w-full"
				colSpan={mode === "side-by-side" ? 4 : 3}
			>
				{lineDiscussions.map((discussion) => (
					<DiscussionCard
						key={discussion.id}
						discussion={discussion}
						collapsed={collapsedDiscussionIds.has(discussion.id)}
						onToggleCollapse={() => onToggleDiscussionCollapse(discussion.id)}
						onExplainDiscussion={onExplainDiscussion}
						explainDisabled={explainDisabled}
					/>
				))}
				{lineDrafts.map((draft) => (
					<CommentDraft
						key={draft.id}
						draft={draft}
						{...commentDraftProps}
						fromChat={draftFromChat(fromChat, draft.id)}
					/>
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

function lineClass(line: DiffLine): string {
	return `diff-line diff-line-${line.kind}`;
}

type LineSelectionEvent = {
	shiftKey: boolean;
};

function LineActions({
	onTag,
	onComment,
	onDragStart,
}: {
	onTag?: () => void;
	onComment?: () => void;
	onDragStart?: (action: DragAction, event: MouseEvent<HTMLElement>) => void;
}) {
	if (!onTag && !onComment) return null;
	return (
		<span className="line-actions">
			{onTag ? (
				<Button
					type="button"
					size="xs"
					variant="secondary"
					{...(onDragStart
						? {
								onMouseDown: (event) => onDragStart("tag", event),
								onKeyDown: (event) => {
									event.stopPropagation();
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onTag();
									}
								},
							}
						: {
								onClick: (event) => {
									event.stopPropagation();
									onTag();
								},
								onKeyDown: (event) => event.stopPropagation(),
							})}
				>
					<Tag aria-hidden />
					Tag line
				</Button>
			) : null}
			{onComment ? (
				<Button
					type="button"
					size="xs"
					variant="secondary"
					{...(onDragStart
						? {
								onMouseDown: (event) => onDragStart("comment", event),
								onKeyDown: (event) => {
									event.stopPropagation();
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onComment();
									}
								},
							}
						: {
								onClick: (event) => {
									event.stopPropagation();
									onComment();
								},
								onKeyDown: (event) => event.stopPropagation(),
							})}
				>
					<MessageSquarePlus aria-hidden />
					Comment
				</Button>
			) : null}
		</span>
	);
}

function DiffLineRow({
	line,
	mode,
	language,
	highlightedCode,
	find,
	findId,
	onSelect,
	onTag,
	onComment,
	commentSide,
	selected = false,
	drag,
	onDragStart,
}: {
	line: DiffLine;
	mode: DiffMode;
	language: string;
	highlightedCode: HighlightedCode;
	find: FindRender;
	findId: string;
	onSelect?: (event: LineSelectionEvent) => void;
	onTag?: () => void;
	onComment?: () => void;
	commentSide?: "new" | "old";
	selected?: boolean;
	drag?: { hunkIndex: number; side: "new" | "old"; line: number };
	onDragStart?: (action: DragAction, event: MouseEvent<HTMLElement>) => void;
}) {
	const isMatch = lineTextMatches(line.text, find.query);
	const isCurrent = find.currentId === findId;
	const className = [
		lineClass(line),
		isMatch ? "find-match" : "",
		isCurrent ? "find-match-current" : "",
	].join(" ");
	const setRef = useCallback(
		(el: HTMLTableRowElement | null) => find.registerRow(findId, el),
		[find.registerRow, findId],
	);
	const selectableProps = onSelect
		? {
				"aria-label": "Select diff line",
				onClick: (event: MouseEvent<HTMLTableRowElement>) => {
					const target = event.target as HTMLElement | null;
					if (target?.closest?.(".line-actions")) return;
					onSelect(event);
				},
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
	const dragAttributes = drag
		? {
				"data-drag-hunk": String(drag.hunkIndex),
				"data-drag-side": drag.side,
				"data-drag-line": String(drag.line),
			}
		: {};
	const trProps = {
		...selectableProps,
		"data-find-line": findId,
		"data-selected": selected ? "true" : undefined,
		...dragAttributes,
	};
	const inlineSide = line.newLine === null ? "old" : "new";
	const inlineHighlight = lineHighlight(
		highlightedCode,
		inlineSide,
		inlineSide === "old" ? line.oldLine : line.newLine,
	);
	const oldHighlight = lineHighlight(highlightedCode, "old", line.oldLine);
	const newHighlight = lineHighlight(highlightedCode, "new", line.newLine);
	return mode === "inline" ? (
		<tr
			ref={setRef}
			className={className}
			key={`${lineLabel(line)}-${line.kind}-${line.text}`}
			{...trProps}
		>
			<td className="line-number">{line.oldLine ?? ""}</td>
			<td className="line-number">{line.newLine ?? ""}</td>
			<td className="line-text">
				<span className="line-prefix">
					{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
				</span>
				<CodeHighlight
					text={line.text}
					language={language}
					{...inlineHighlight}
				/>
				<LineActions
					onTag={onTag}
					onComment={onComment}
					onDragStart={onDragStart}
				/>
			</td>
		</tr>
	) : (
		<tr
			ref={setRef}
			className={className}
			key={`${lineLabel(line)}-${line.kind}-${line.text}`}
			{...trProps}
		>
			<td className="line-number">{line.oldLine ?? ""}</td>
			<td className={`side-line ${line.kind === "del" ? "removed" : ""}`}>
				{line.kind === "add" ? (
					""
				) : (
					<>
						<CodeHighlight
							text={line.text}
							language={language}
							{...oldHighlight}
						/>
						{commentSide === "old" ? (
							<LineActions
								onTag={onTag}
								onComment={onComment}
								onDragStart={onDragStart}
							/>
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
						<CodeHighlight
							text={line.text}
							language={language}
							{...newHighlight}
						/>
						{commentSide === "new" ? (
							<LineActions
								onTag={onTag}
								onComment={onComment}
								onDragStart={onDragStart}
							/>
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
	highlightedCode,
	path,
	hunk,
	onReveal,
	onRevealAll,
	onHide,
	onTag,
	find,
	findSide,
}: {
	gap: ContextGap;
	revealedCount: number;
	sourceLines: readonly string[] | null;
	mode: DiffMode;
	wholeFile: boolean;
	language: string;
	highlightedCode: HighlightedCode;
	path: string;
	hunk: string;
	onReveal: () => void;
	onRevealAll: () => void;
	onHide: () => void;
	onTag?: (selection: DiffLineSelection) => void;
	find: FindRender;
	findSide: "new" | "old";
}) {
	const effectiveRevealedCount = find.forceContext
		? gapLineCount(gap)
		: revealedCount;
	const lines = revealedContextLines(gap, sourceLines, effectiveRevealedCount);
	const hidden = hiddenContextRange(gap, effectiveRevealedCount);
	const fullyRevealed = hidden === null;
	const controls =
		wholeFile ||
		find.forceContext ||
		(hidden === null && gap.position !== "between") ? null : (
			<tr className="expand-context-row">
				<td colSpan={mode === "side-by-side" ? 4 : 3}>
					{fullyRevealed ? (
						<Button type="button" variant="ghost" size="xs" onClick={onHide}>
							<Minus aria-hidden />
							Hide lines {gap.newStart}-{gap.newEnd}
						</Button>
					) : (
						<>
							<Button
								type="button"
								variant="ghost"
								size="xs"
								onClick={onReveal}
							>
								<ChevronsUpDown aria-hidden />
								Expand lines {hidden.startLine}-{hidden.endLine}
							</Button>
							{gap.position !== "between" ? (
								<Button
									type="button"
									variant="ghost"
									size="xs"
									onClick={onRevealAll}
								>
									<ChevronsUpDown aria-hidden />
									Expand all
								</Button>
							) : null}
						</>
					)}
				</td>
			</tr>
		);
	const content =
		effectiveRevealedCount === 0 ? null : lines === null ? (
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
					highlightedCode={highlightedCode}
					language={language}
					find={find}
					findId={contextLineId(
						findSide,
						findSide === "old" ? line.oldLine : line.newLine,
					)}
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
	hunkIndex,
	showHeader,
	mode,
	language,
	highlightedCode,
	find,
	path,
	defaultSide,
	anchor,
	rangeSelection,
	discussions,
	onExplainDiscussion,
	explainDisabled,
	drafts,
	commentDraftProps,
	fromChat,
	onLineClick,
	onTagHunk,
	onCommentSelection,
	onDragStart,
	dragSelected,
	collapsedDiscussionIds,
	onToggleDiscussionCollapse,
}: {
	file: ParsedFileDiff;
	hunk: DiffHunk;
	hunkIndex: number;
	showHeader: boolean;
	mode: DiffMode;
	language: string;
	highlightedCode: HighlightedCode;
	find: FindRender;
	path: string;
	defaultSide: "new" | "old";
	anchor: LineSelectionAnchor | null;
	rangeSelection: DiffLineSelection | null;
	discussions: readonly HostDiscussion[];
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled?: boolean;
	drafts: readonly Draft[];
	commentDraftProps: CommentDraftCallbacks;
	fromChat?: FromChatContext;
	onLineClick?: (
		line: DiffLine,
		hunkHeader: string,
		event: LineSelectionEvent,
	) => void;
	onTagHunk?: (selection: DiffLineSelection) => void;
	onCommentSelection?: (selection: DiffLineSelection) => void;
	onDragStart?: (
		action: DragAction,
		row: DiffDragRow,
		event: MouseEvent<HTMLElement>,
	) => void;
	dragSelected?: (row: DiffDragRow) => boolean;
	collapsedDiscussionIds: ReadonlySet<string>;
	onToggleDiscussionCollapse: (discussionId: string) => void;
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
				const dragRow = point
					? { hunkIndex, side: point.side, line: point.line }
					: undefined;
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
							highlightedCode={highlightedCode}
							line={line}
							mode={mode}
							language={language}
							find={find}
							findId={diffLineId(hunk.header, line)}
							selected={
								selected || (dragRow ? dragSelected?.(dragRow) === true : false)
							}
							drag={dragRow}
							onDragStart={
								dragRow
									? (action, event) => onDragStart?.(action, dragRow, event)
									: undefined
							}
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
							collapsedDiscussionIds={collapsedDiscussionIds}
							onToggleDiscussionCollapse={onToggleDiscussionCollapse}
							onExplainDiscussion={onExplainDiscussion}
							explainDisabled={explainDisabled}
							fromChat={fromChat}
							drafts={drafts}
							commentDraftProps={commentDraftProps}
						/>
					</Fragment>
				);
			})}
			{selectedRange ? (
				<tr className="selection-comment-row animate-in fade-in slide-in-from-top-1 duration-200 ease-out">
					<td
						className="min-w-0 max-w-full"
						colSpan={mode === "side-by-side" ? 4 : 3}
					>
						<span>
							Selected {selectedRange.side} lines {selectedRange.startLine}-
							{selectedRange.endLine}
						</span>
						{onCommentSelection ? (
							<Button
								type="button"
								size="sm"
								onClick={() => onCommentSelection(selectedRange)}
							>
								Add comment
							</Button>
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
	find,
	discussions,
	onExplainDiscussion,
	explainDisabled,
	drafts,
	commentDraftProps,
	fromChat,
	onLineSelection,
	onCommentSelection,
	collapsedDiscussionIds,
	onToggleDiscussionCollapse,
}: {
	file: ParsedFileDiff;
	mode: DiffMode;
	fileContents: string | null;
	wholeFile: boolean;
	find: FindRender;
	discussions: readonly HostDiscussion[];
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled?: boolean;
	drafts: readonly Draft[];
	commentDraftProps: CommentDraftCallbacks;
	fromChat?: FromChatContext;
	onLineSelection?: (selection: DiffLineSelection) => void;
	onCommentSelection?: (selection: DiffLineSelection) => void;
	collapsedDiscussionIds: ReadonlySet<string>;
	onToggleDiscussionCollapse: (discussionId: string) => void;
}) {
	const path = file.newPath ?? file.oldPath ?? "";
	const language = path.split(".").pop() ?? "text";
	const defaultSide = file.status === "deleted" ? "old" : "new";
	const highlightedCode = useCodeHighlights(file, fileContents, language);
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
		() =>
			wholeFile
				? Object.fromEntries(gaps.map((gap) => [gap.id, gapLineCount(gap)]))
				: {},
	);
	const wasWholeFile = useRef(wholeFile);
	const visibleDrafts = drafts.filter((draft) => draft.status !== "posted");
	const { drag, start: startDrag } = useDiffDrag({
		onCommit: (action, origin, end) => {
			const hunkHeader = file.hunks[origin.hunkIndex]?.header;
			if (hunkHeader === undefined) return;
			const { startLine, endLine } = diffDragRange(origin, end);
			const selection: DiffLineSelection = {
				path,
				side: origin.side,
				startLine,
				endLine,
				hunk: hunkHeader,
			};
			setAnchor(null);
			setRangeSelection(null);
			if (action === "tag") onLineSelection?.(selection);
			else onCommentSelection?.(selection);
		},
	});

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
			highlightedCode={highlightedCode}
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
			find={find}
			findSide={defaultSide}
		/>
	);
	const head = gaps.find((gap) => gap.position === "head");
	const tail = gaps.find((gap) => gap.position === "tail");

	return (
		<table
			className={`diff-table ${
				mode === "inline" ? "diff-inline" : "side-by-side"
			} w-full max-w-full`}
		>
			<colgroup>
				{mode === "side-by-side" ? (
					<>
						<col className="diff-line-number-column" />
						<col className="diff-side-column" />
						<col className="diff-line-number-column" />
						<col className="diff-side-column" />
					</>
				) : (
					<>
						<col className="diff-line-number-column" />
						<col className="diff-line-number-column" />
						<col className="diff-inline-column" />
					</>
				)}
			</colgroup>
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
								hunkIndex={index}
								showHeader={showHunkHeader}
								mode={mode}
								language={language}
								highlightedCode={highlightedCode}
								find={find}
								path={path}
								defaultSide={defaultSide}
								anchor={anchor}
								rangeSelection={rangeSelection}
								discussions={discussions}
								onExplainDiscussion={onExplainDiscussion}
								explainDisabled={explainDisabled}
								drafts={visibleDrafts}
								commentDraftProps={commentDraftProps}
								fromChat={fromChat}
								onLineClick={onLineSelection ? selectLine : undefined}
								onTagHunk={tagLine}
								onCommentSelection={onCommentSelection}
								onDragStart={startDrag}
								dragSelected={(row) =>
									drag !== null && isRowInDiffDrag(row, drag)
								}
								collapsedDiscussionIds={collapsedDiscussionIds}
								onToggleDiscussionCollapse={onToggleDiscussionCollapse}
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
	onExplainDiscussion,
	explainDisabled,
	onModeChange,
	wholeFile = false,
	onWholeFileChange,
	onViewModeChange,
	viewed,
	onViewedChange,
	onExpandDiff,
	onLineSelection,
	onCommentSelection,
	onMarkdownTag,
	onFileTag,
	onMarkdownComment,
	onCancelDraft,
	onEditDraft,
	onSendDraft,
	onRetryDraft,
	fromChat,
	commentsCollapsed,
	findQuery: findQueryProp,
	onFindQueryChange,
}: DiffViewProps) {
	const [expanded, setExpanded] = useState(false);
	const [expandedFile, setExpandedFile] = useState<ParsedFileDiff | null>(null);
	const [expanding, setExpanding] = useState(false);
	const [expansionError, setExpansionError] = useState<string | null>(null);
	const [internalFindQuery, setInternalFindQuery] = useState("");
	const [findIndex, setFindIndex] = useState(0);
	const [collapsedDiscussionIds, setCollapsedDiscussionIds] = useState<
		Set<string>
	>(() => new Set(commentsCollapsed ? discussions.map((d) => d.id) : []));
	const findRowsRef = useRef<Map<string, HTMLElement>>(new Map());
	const findInputRef = useRef<HTMLInputElement | null>(null);

	// Find-in-file: computed top-level and null-safe so the scroll effect
	// obeys the rules of hooks. The early return below guards the render
	// paths that consume `find`; with no file, matches stay empty.
	const findQueryControlled = findQueryProp !== undefined;
	const findQuery = findQueryControlled ? findQueryProp : internalFindQuery;
	const findActive = findQuery.length > 0;
	const findDisplayFile = expandedFile ?? file;
	const matches =
		findActive && findDisplayFile
			? findMatches(findDisplayFile, fileContents, findQuery, findActive)
			: [];
	const currentId = matches[findIndex]?.id ?? null;
	const findCount = findCountText(findQuery, findIndex, matches.length);
	const registerRow = useCallback((id: string, el: HTMLElement | null) => {
		const rows = findRowsRef.current;
		if (el) rows.set(id, el);
		else rows.delete(id);
	}, []);
	useEffect(() => {
		if (!findActive || !currentId) return;
		const row = findRowsRef.current.get(currentId);
		row?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [findActive, currentId]);
	const find: FindRender = {
		query: findQuery,
		currentId,
		registerRow,
		forceContext: findActive,
	};
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
				event.preventDefault();
				findInputRef.current?.focus();
				findInputRef.current?.select();
			}
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, []);
	const toggleDiscussionCollapse = useCallback((discussionId: string) => {
		setCollapsedDiscussionIds((previous) => {
			const next = new Set(previous);
			if (next.has(discussionId)) next.delete(discussionId);
			else next.add(discussionId);
			return next;
		});
	}, []);
	const onMarkdownTagRef = useRef(onMarkdownTag);
	onMarkdownTagRef.current = onMarkdownTag;
	const stableOnMarkdownTag = useCallback(
		(selection: MarkdownBlockSelection) => {
			onMarkdownTagRef.current?.(selection);
		},
		[],
	);
	const onMarkdownCommentRef = useRef(onMarkdownComment);
	onMarkdownCommentRef.current = onMarkdownComment;
	const stableOnMarkdownComment = useCallback(
		(selection: MarkdownBlockSelection) => {
			onMarkdownCommentRef.current?.(selection);
		},
		[],
	);
	const fromChatRef = useRef(fromChat);
	fromChatRef.current = fromChat;
	const stableFromChat = useMemo<FromChatContext>(
		() => ({
			get availability() {
				return (
					fromChatRef.current?.availability ?? {
						kind: "disabled",
						reason: "Loading chat…",
					}
				);
			},
			get generations() {
				return fromChatRef.current?.generations ?? {};
			},
			onGenerate: (id) => fromChatRef.current?.onGenerate(id),
			onStop: (id) => fromChatRef.current?.onStop(id),
		}),
		[],
	);
	const onCancelDraftRef = useRef(onCancelDraft);
	onCancelDraftRef.current = onCancelDraft;
	const onEditDraftRef = useRef(onEditDraft);
	onEditDraftRef.current = onEditDraft;
	const onSendDraftRef = useRef(onSendDraft);
	onSendDraftRef.current = onSendDraft;
	const onRetryDraftRef = useRef(onRetryDraft);
	onRetryDraftRef.current = onRetryDraft;
	const stableCommentDraftProps = useMemo<
		Pick<CommentDraftProps, "onCancel" | "onEdit" | "onSend" | "onRetry">
	>(
		() => ({
			onCancel: (id) => onCancelDraftRef.current?.(id),
			onEdit: (id, body) => onEditDraftRef.current?.(id, body),
			onSend: (id) => onSendDraftRef.current?.(id),
			onRetry: (id) => onRetryDraftRef.current?.(id),
		}),
		[],
	);
	if (!file) {
		return (
			<section className="flex flex-col items-center gap-2 p-8 text-sm text-muted-foreground">
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
	const fileDiscussions = discussions.filter((discussion) =>
		discussionMatchesDiff(discussion, displayFile),
	);
	const allCommentsCollapsed =
		fileDiscussions.length > 0 &&
		fileDiscussions.every((discussion) =>
			collapsedDiscussionIds.has(discussion.id),
		);
	const collapseAllComments = () => {
		setCollapsedDiscussionIds(
			allCommentsCollapsed
				? new Set()
				: new Set(fileDiscussions.map((discussion) => discussion.id)),
		);
	};
	const commentsLabel = allCommentsCollapsed
		? "Expand all comments"
		: "Collapse all comments";
	const sourceLineCount =
		fileContents === null ? null : splitSourceLines(fileContents).length;
	const changeWholeFile = (next: boolean) => {
		if (!next) {
			const headers = Array.from(
				document.querySelectorAll<HTMLElement>(".diff-table .hunk-header"),
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
	const applyFindQuery = (value: string) => {
		if (!findQueryControlled) setInternalFindQuery(value);
		onFindQueryChange?.(value);
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
	const commentDraftProps = stableCommentDraftProps;

	return (
		<section className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto">
			<header className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-2 border-b bg-card/95 px-4 py-2 backdrop-blur">
				<h2 className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
					{path}
				</h2>
				<div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
					<span className="text-success">+{file.insertions}</span>
					<span className="text-destructive">−{file.deletions}</span>
				</div>
				<div className="flex min-w-0 max-w-full flex-1 flex-wrap items-center justify-end gap-2">
					{!binary && !showingRendered ? (
						<div
							className="flex h-8 w-56 min-w-0 max-w-full shrink items-center overflow-hidden rounded-3xl border border-border bg-input/50 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
							data-find-control=""
						>
							<div className="relative min-w-0 flex-1">
								<Search
									className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
									aria-hidden
								/>
								<Input
									ref={findInputRef}
									type="text"
									className="h-8 w-full min-w-0 rounded-none border-0 bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0"
									placeholder="Find in file…"
									value={findQuery}
									onChange={(event) => {
										const value = event.target.value;
										applyFindQuery(value);
										setFindIndex(0);
										if (value.length > 0 && collapsed && !expanded) {
											requestExpansion();
										}
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter" && event.shiftKey) {
											event.preventDefault();
											setFindIndex((current) =>
												stepMatchIndex(current, matches.length, -1),
											);
										} else if (event.key === "Enter") {
											event.preventDefault();
											setFindIndex((current) =>
												stepMatchIndex(current, matches.length, 1),
											);
										} else if (event.key === "Escape") {
											event.preventDefault();
											applyFindQuery("");
											setFindIndex(0);
											event.currentTarget.blur();
										}
									}}
									aria-label="Find in file"
								/>
							</div>
							{findActive ? (
								<span
									className="flex shrink-0 items-center gap-0.5 pr-1 whitespace-nowrap"
									data-find-navigation=""
								>
									<span
										className="text-xs tabular-nums text-muted-foreground"
										aria-live="polite"
										data-find-count=""
									>
										{findCount}
									</span>
									<IconButton
										label="Previous match"
										size="icon-xs"
										tooltip="Previous match (Shift+Enter)"
										disabled={matches.length === 0}
										onClick={() =>
											setFindIndex((current) =>
												stepMatchIndex(current, matches.length, -1),
											)
										}
									>
										<ChevronUp aria-hidden />
									</IconButton>
									<IconButton
										label="Next match"
										size="icon-xs"
										tooltip="Next match (Enter)"
										disabled={matches.length === 0}
										onClick={() =>
											setFindIndex((current) =>
												stepMatchIndex(current, matches.length, 1),
											)
										}
									>
										<ChevronDown aria-hidden />
									</IconButton>
								</span>
							) : null}
						</div>
					) : null}
					{markdown ? (
						<SegmentedToggleGroup
							multiple={false}
							value={showingRendered ? ["rendered"] : ["diff"]}
							onValueChange={(values) => {
								const value = values[0];
								if (value === "rendered" || value === "diff") {
									onViewModeChange?.(value);
								}
							}}
							aria-label="Markdown view"
						>
							<TooltipToggleGroupItem
								label="Rendered"
								value="rendered"
								aria-pressed={showingRendered}
								data-state={showingRendered ? "on" : "off"}
							>
								<Pilcrow aria-hidden />
								<span className="sr-only">Rendered</span>
							</TooltipToggleGroupItem>
							<TooltipToggleGroupItem
								label="Raw"
								value="diff"
								aria-pressed={!showingRendered}
								data-state={!showingRendered ? "on" : "off"}
							>
								<Diff aria-hidden />
								<span className="sr-only">Raw</span>
							</TooltipToggleGroupItem>
						</SegmentedToggleGroup>
					) : null}
					{!showingRendered ? (
						<SegmentedToggleGroup
							multiple={false}
							value={[mode]}
							onValueChange={(values) => {
								const value = values[0];
								if (value === "inline" || value === "side-by-side") {
									onModeChange(value);
								}
							}}
							aria-label="Diff layout"
						>
							<TooltipToggleGroupItem
								label="Inline"
								value="inline"
								aria-pressed={mode === "inline"}
								data-state={mode === "inline" ? "on" : "off"}
							>
								<Rows3 aria-hidden />
								<span className="sr-only">Inline</span>
							</TooltipToggleGroupItem>
							<TooltipToggleGroupItem
								label="Side by side"
								value="side-by-side"
								aria-pressed={mode === "side-by-side"}
								data-state={mode === "side-by-side" ? "on" : "off"}
							>
								<Columns2 aria-hidden />
								<span className="sr-only">Side by side</span>
							</TooltipToggleGroupItem>
						</SegmentedToggleGroup>
					) : null}
					{wholeFileEligible ? (
						<SegmentedToggleGroup
							multiple={false}
							value={wholeFile ? ["whole-file"] : ["diff-only"]}
							onValueChange={(values) => {
								const value = values[0];
								if (value === "whole-file") changeWholeFile(true);
								else if (value === "diff-only") changeWholeFile(false);
							}}
							aria-label="File scope"
						>
							<TooltipToggleGroupItem
								label="Full file"
								value="whole-file"
								aria-pressed={wholeFile}
								data-state={wholeFile ? "on" : "off"}
							>
								<Eye aria-hidden />
								<span className="sr-only">Full file</span>
							</TooltipToggleGroupItem>
							<TooltipToggleGroupItem
								value="diff-only"
								label="Diff only"
								aria-pressed={!wholeFile}
								data-state={!wholeFile ? "on" : "off"}
							>
								<EyeOff aria-hidden />
								<span className="sr-only">Diff only</span>
							</TooltipToggleGroupItem>
						</SegmentedToggleGroup>
					) : null}
					{onFileTag && path !== "(unknown file)" ? (
						<IconButton
							label="Tag whole file"
							tooltip="Add this whole file to the active chat context"
							onClick={() => onFileTag(path)}
						>
							<Tag aria-hidden />
						</IconButton>
					) : null}
					{!showingRendered &&
					fileDiscussions.length > 0 &&
					(!collapsed || expanded) ? (
						<IconButton
							label={commentsLabel}
							tooltip={commentsLabel}
							onClick={collapseAllComments}
						>
							<ChevronsUpDown aria-hidden />
						</IconButton>
					) : null}
				</div>
				<label
					className="flex shrink-0 items-center gap-2 text-xs whitespace-nowrap text-muted-foreground"
					title="Mark file viewed"
					htmlFor="diff-viewed"
				>
					<Checkbox
						id="diff-viewed"
						aria-label="Viewed"
						checked={viewed ?? false}
						onCheckedChange={(checked) => onViewedChange?.(checked === true)}
					/>
					<span>Viewed</span>
				</label>
			</header>
			{binary ? (
				<p className="flex flex-col items-center gap-2 p-8 text-sm text-muted-foreground">
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
					fromChat={fromChat}
					onTagBlock={stableOnMarkdownTag}
					onCommentBlock={stableOnMarkdownComment}
				/>
			) : null}
			{!showingRendered || binary ? (
				<>
					{fileContentsError ? (
						<Alert variant="destructive">{fileContentsError}</Alert>
					) : null}
					{!binary && collapsed && !expanded ? (
						<div className="flex flex-col items-center gap-2 p-8 text-sm text-muted-foreground">
							<p>
								{overThreshold
									? `Large diff collapsed after ${largeFileLineThreshold} lines.`
									: noPatch
										? "Diff contents unavailable for this file."
										: "Diff collapsed."}
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={requestExpansion}
							>
								Expand diff
							</Button>
						</div>
					) : null}
					{!binary && collapsed && expanded && noPatch && !expandedFile ? (
						<div className="flex flex-col items-center gap-2 p-8 text-sm text-muted-foreground">
							{expanding ? (
								<p>Loading full diff...</p>
							) : expansionError ? (
								<Alert variant="destructive">{expansionError}</Alert>
							) : (
								<p>Diff contents unavailable for this file.</p>
							)}
						</div>
					) : null}
					{!binary &&
					(!collapsed || (expanded && (!noPatch || expandedFile !== null))) ? (
						<DiffTable
							file={displayFile}
							mode={mode}
							wholeFile={wholeFile}
							fileContents={fileContents}
							discussions={discussions}
							onExplainDiscussion={onExplainDiscussion}
							explainDisabled={explainDisabled}
							drafts={drafts}
							commentDraftProps={commentDraftProps}
							fromChat={fromChat ? stableFromChat : undefined}
							onLineSelection={onLineSelection}
							onCommentSelection={onCommentSelection}
							find={find}
							collapsedDiscussionIds={collapsedDiscussionIds}
							onToggleDiscussionCollapse={toggleDiscussionCollapse}
						/>
					) : null}
					{!file.binary && collapsed && expanded ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setExpanded(false)}
						>
							Collapse diff
						</Button>
					) : null}
				</>
			) : null}
		</section>
	);
}
