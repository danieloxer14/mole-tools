import DOMPurify from "dompurify";
import type { Tokens } from "marked";
import mermaid from "mermaid";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import {
	escapeHtml,
	renderMarkdownBlocks,
	wrapMarkdownBlocksWithActions,
} from "../../../../shared/markdown";
import { useColorTheme } from "../color-theme";
import { finalizeDescriptionHtml, isVideoUrl } from "../description-media";
import {
	isBlockInMarkdownDrag,
	type MarkdownDragBlock,
	type MarkdownDragState,
	markdownDragRange,
	nextMarkdownDragEnd,
} from "./line-drag";
import { Alert } from "./ui/alert";

export interface MarkdownBlockRange {
	startLine: number;
	endLine: number;
	quote: string;
}

export type MarkdownRenderPolicy =
	| { kind: "file" }
	| { kind: "description"; projectWebUrl: string };

export interface MarkdownDocumentProps {
	source: string;
	policy: MarkdownRenderPolicy;
	commentable: boolean;
	onTagBlock?: (range: MarkdownBlockRange) => void;
	onCommentBlock?: (range: MarkdownBlockRange) => void;
}

export const SHIKI_THEMES = {
	dark: "github-dark",
	light: "github-light",
} as const;

let nextMermaidId = 0;
let nextCodeBlockId = 0;
type MermaidTheme = "dark" | "default";
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

interface RenderedMarkdownOutput {
	html: string;
	mermaidSources: Map<string, string>;
	codeSources: Map<string, { code: string; lang: string }>;
	blockRanges: Map<string, { startLine: number; endLine: number }>;
}

function renderMarkdown(
	source: string,
	policy: MarkdownRenderPolicy,
	commentable: boolean,
): RenderedMarkdownOutput {
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
		if (policy.kind === "file") {
			renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text);
		} else {
			const defaultImage = renderer.image.bind(renderer);
			renderer.image = (token: Tokens.Image) =>
				isVideoUrl(token.href)
					? `<video controls preload="metadata" src="${escapeHtml(token.href)}" title="${escapeHtml(token.text)}"></video>`
					: defaultImage(token);
		}
		renderer.table = (token: Tokens.Table) =>
			`<div class="rendered-table-wrap min-w-0 max-w-full">${defaultTable(token)}</div>`;
	});
	const { html: bodyHtml, blockRanges } = wrapMarkdownBlocksWithActions(
		blocks,
		{
			comment: commentable,
		},
	);
	const sanitizeOptions = {
		ADD_ATTR: [
			"data-mermaid-id",
			"data-code-block-id",
			"data-block-id",
			"data-source-line-start",
			"data-source-line-end",
		],
		FORBID_TAGS: ["embed", "iframe", "object", "script", "style"],
	};
	const sanitizedHtml =
		policy.kind === "description"
			? DOMPurify.sanitize(bodyHtml, {
					...sanitizeOptions,
					FORBID_ATTR: ["style"],
				})
			: DOMPurify.sanitize(bodyHtml, sanitizeOptions);
	const html =
		policy.kind === "description"
			? finalizeDescriptionHtml(sanitizedHtml, policy.projectWebUrl)
			: sanitizedHtml;
	return { html, mermaidSources, codeSources, blockRanges };
}

function MermaidThemeRenderer({
	rendered,
	containerRef,
}: {
	rendered: RenderedMarkdownOutput | null;
	containerRef: { current: HTMLDivElement | null };
}) {
	const mermaidTheme: MermaidTheme =
		useColorTheme() === "light" ? "default" : "dark";

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

export const MarkdownDocument = memo(function MarkdownDocument({
	source,
	policy,
	commentable,
	onTagBlock,
	onCommentBlock,
}: MarkdownDocumentProps) {
	const projectUrl =
		policy.kind === "description" ? policy.projectWebUrl : null;
	const parsed = useMemo(() => {
		try {
			return {
				error: null,
				value: renderMarkdown(
					source,
					policy.kind === "description" && projectUrl !== null
						? { kind: "description", projectWebUrl: projectUrl }
						: { kind: "file" },
					commentable,
				),
			};
		} catch (reason: unknown) {
			return {
				error: reason instanceof Error ? reason.message : String(reason),
				value: null,
			};
		}
	}, [source, policy.kind, projectUrl, commentable]);
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
			const selection: MarkdownBlockRange = {
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
	}, [parsed.value, source, onTagBlock, onCommentBlock]);

	const commitDrag = (current: MarkdownDragState) => {
		const { startLine, endLine } = markdownDragRange(
			current.origin,
			current.end,
		);
		const selection: MarkdownBlockRange = {
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
		</div>
	);
});
