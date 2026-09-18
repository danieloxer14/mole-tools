import {
	Bot,
	Check,
	ChevronDown,
	CircleCheck,
	CircleDot,
	Eraser,
	Loader2,
	Plus,
	SendHorizontal,
	Settings,
	Sparkles,
	Square,
	Wrench,
	X,
} from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import type { HostDiscussion } from "../../../../ports/git-host";
import { renderMarkdownHtml } from "../../../../shared/markdown";
import {
	type ChatTag,
	isFileChatTag,
	isMarkdownChatTag,
} from "../../chat-tags";
import type { ChatEntry } from "../../store";
import { CommentMarkdown } from "./CommentMarkdown";
import { composerEnterAction } from "./composer-keydown";
import { IconButton } from "./IconButton";
import {
	isTranscriptAtBottom,
	scrollTranscriptToBottom,
} from "./transcript-scroll";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Kbd } from "./ui/kbd";
import { Textarea } from "./ui/textarea";
export interface ChatToolActivity {
	id: number;
	name: string;
	phase: "start" | "end";
}

export interface ChatSummary {
	id: string;
	title: string;
	createdAt: string;
	busy: boolean;
}

export interface ChatPaneProps {
	transcript: readonly ChatEntry[];
	tags: readonly ChatTag[];
	discussions?: readonly HostDiscussion[];
	onExplainDiscussion?: (discussionId: string) => void;
	explainDisabled?: boolean;
	streamingSegments: readonly string[];
	tools: readonly ChatToolActivity[];
	error: string | null;
	sending: boolean;
	stopping: boolean;
	/** True when either a local stream or a server-side turn is running. */
	busy?: boolean;
	chats: readonly ChatSummary[];
	activeChatId: string | null;
	onSelectChat: (chatId: string) => void;
	onNewChat: () => void;
	onOpenSettings: () => void;
	creatingChat?: boolean;
	draft: string;
	onDraftChange: (value: string) => void;
	onSend: (message: string) => boolean | undefined;
	onStop: () => void;
	onRemoveTag: (tag: ChatTag) => void;
	onClearTags?: () => void;
	onOpenFileRef?: (path: string) => void;
}

function tagLabel(tag: ChatTag): string {
	if (isFileChatTag(tag)) return `${tag.path} (whole file)`;
	return isMarkdownChatTag(tag)
		? `${tag.path}:${tag.startLine}-${tag.endLine}`
		: `${tag.path}:${tag.side}:${tag.startLine}-${tag.endLine}`;
}

function tagKey(tag: ChatTag): string {
	if (isFileChatTag(tag)) return `${tag.path}-file`;
	return isMarkdownChatTag(tag)
		? `${tag.path}-markdown-${tag.startLine}-${tag.endLine}`
		: `${tag.path}-${tag.side}-${tag.startLine}-${tag.endLine}-${tag.hunk}`;
}

// Line ranges sometimes come back with a typographic dash (en/em dash)
// instead of a hyphen-minus, so accept the common Unicode dash variants too.
// Path segments may include bracketed dynamic route segments, e.g. Next.js's
// `app/api/[product]/route.ts`.
const FILE_REF_PATTERN =
	/(?:[\w.[\]-]+\/)*[\w][\w.-]*\.[A-Za-z]{1,10}:\d+(?:[-\u2010-\u2015]\d+)?/g;

/**
 * Wraps file:line references inside rendered inline `<code>` spans with a
 * clickable button, entirely at the HTML-string level. `<pre>` (fenced code)
 * blocks are protected first so their contents are never touched. Building
 * this into the string at render time (rather than walking the live DOM in a
 * post-mount effect) means the buttons exist as soon as React commits the
 * markup — no dependency on a passive effect actually running.
 */
function linkifyFileReferencesInHtml(html: string): string {
	const preBlocks: string[] = [];
	const protectedHtml = html.replace(/<pre[\s\S]*?<\/pre>/g, (block) => {
		preBlocks.push(block);
		return `@@FILE_REF_PRE_BLOCK_${preBlocks.length - 1}@@`;
	});
	const linkified = protectedHtml.replace(
		/<code>([^<]*)<\/code>/g,
		(whole, inner: string) => {
			let matched = false;
			FILE_REF_PATTERN.lastIndex = 0;
			const rewritten = inner.replace(FILE_REF_PATTERN, (full: string) => {
				matched = true;
				const path = full
					.slice(0, full.lastIndexOf(":"))
					.replaceAll('"', "&quot;");
				return `<a href="#" class="file-ref-link" data-file-path="${path}">${full}</a>`;
			});
			return matched ? `<code>${rewritten}</code>` : whole;
		},
	);
	return linkified.replace(
		/@@FILE_REF_PRE_BLOCK_(\d+)@@/g,
		(_placeholder, index: string) => preBlocks[Number(index)] ?? "",
	);
}

function ChatMessageBody({
	text,
	onOpenFileRef,
}: {
	text: string;
	onOpenFileRef?: (path: string) => void;
}) {
	const parsed = useMemo(() => {
		try {
			return {
				error: null,
				html: linkifyFileReferencesInHtml(renderMarkdownHtml(text)),
			};
		} catch (reason: unknown) {
			return {
				error: reason instanceof Error ? reason.message : String(reason),
				html: null,
			};
		}
	}, [text]);

	const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement;
		const link = target.closest<HTMLElement>(".file-ref-link");
		if (!link) return;
		event.preventDefault();
		const path = link.dataset.filePath;
		if (path) onOpenFileRef?.(path);
	};

	if (parsed.error || parsed.html === null) {
		return (
			<p className="min-w-0 max-w-full [overflow-wrap:anywhere]">{text}</p>
		);
	}
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: delegates clicks for agent-generated file-ref links embedded in sanitized markdown; the links are the actual interactive targets.
		// biome-ignore lint/a11y/useKeyWithClickEvents: delegated target is a real <a>, which already carries native keyboard activation.
		<div
			className="rendered-markdown min-w-0 max-w-full [overflow-wrap:anywhere]"
			onClick={handleClick}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown output is sanitized with DOMPurify.
			dangerouslySetInnerHTML={{ __html: parsed.html }}
		/>
	);
}

function roleLabel(role: string): string {
	if (role === "user") return "You";
	if (role === "assistant") return "Assistant";
	return role;
}
function chatLabel(chat: ChatSummary, index: number): string {
	return chat.title || `New chat ${index + 1}`;
}

export function ChatPane({
	transcript,
	tags,
	discussions = [],
	onExplainDiscussion,
	explainDisabled = false,
	streamingSegments = [],
	tools = [],
	error,
	sending,
	stopping,
	busy = false,
	chats,
	activeChatId,
	onSelectChat,
	onNewChat,
	onOpenSettings,
	creatingChat = false,
	draft,
	onDraftChange,
	onSend,
	onStop,
	onRemoveTag,
	onClearTags,
	onOpenFileRef,
}: ChatPaneProps) {
	const transcriptElement = useRef<HTMLDivElement | null>(null);
	const followTranscript = useRef(true);
	const previousActiveChatId = useRef(activeChatId);
	const streamingKeySequence = useRef(0);
	const streamingKeys = useRef<string[]>([]);
	while (streamingKeys.current.length < streamingSegments.length) {
		streamingKeys.current.push(`streaming-${++streamingKeySequence.current}`);
	}
	if (streamingKeys.current.length > streamingSegments.length)
		streamingKeys.current.length = streamingSegments.length;

	const activeChatIndex = chats.findIndex((chat) => chat.id === activeChatId);
	const activeChat = activeChatIndex >= 0 ? chats[activeChatIndex] : null;
	const activeLabel = activeChat
		? chatLabel(activeChat, activeChatIndex)
		: "No chats";
	const isBusy = sending || busy;

	const forceScrollOnNextLayout = useRef(false);
	const scrollToBottom = useCallback((force = false) => {
		if (force) {
			followTranscript.current = true;
			forceScrollOnNextLayout.current = true;
			return;
		}
		const element = transcriptElement.current;
		if (!element || !followTranscript.current) return;
		scrollTranscriptToBottom(element);
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: transcript, streaming, error, and busy state intentionally trigger this layout effect; DOM refs carry mutable scroll state.
	useLayoutEffect(() => {
		const switchedChat = previousActiveChatId.current !== activeChatId;
		previousActiveChatId.current = activeChatId;
		const forceScroll = forceScrollOnNextLayout.current;
		forceScrollOnNextLayout.current = false;
		if (forceScroll || switchedChat) {
			followTranscript.current = true;
			const element = transcriptElement.current;
			if (element) scrollTranscriptToBottom(element);
			return;
		}
		scrollToBottom();
	}, [
		activeChatId,
		error,
		isBusy,
		scrollToBottom,
		streamingSegments,
		transcript,
	]);

	const handleTranscriptScroll = () => {
		const element = transcriptElement.current;
		if (element) followTranscript.current = isTranscriptAtBottom(element);
	};

	const submit = () => {
		const value = draft.trim();
		if (!value || isBusy) return;
		if (onSend(value) !== false) scrollToBottom(true);
	};

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		submit();
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		const action = composerEnterAction({
			key: event.key,
			shift: event.shiftKey,
			meta: event.metaKey,
			ctrl: event.ctrlKey,
			composing: event.nativeEvent.isComposing,
		});
		if (action.prevent) event.preventDefault();
		if (action.send) submit();
	};
	return (
		<aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l bg-sidebar">
			{discussions.length > 0 ? (
				<Collapsible className="min-w-0 shrink-0 border-b">
					<CollapsibleTrigger
						aria-label="General discussions"
						aria-controls="general-discussions"
						render={
							<button
								type="button"
								className="group flex w-full items-center gap-2 px-4 py-2 text-sm font-medium transition-colors duration-150 hover:bg-muted/60"
							>
								<ChevronDown
									className="size-4 shrink-0 -rotate-90 transition-transform duration-200 ease-out group-data-[panel-open]:rotate-0"
									aria-hidden
								/>
								<span className="min-w-0 flex-1 truncate text-left">
									General discussions
								</span>
								<Badge variant="outline">{discussions.length}</Badge>
							</button>
						}
					/>
					<CollapsibleContent
						keepMounted
						id="general-discussions"
						className="min-h-0 min-w-0 max-h-[40vh] max-w-full space-y-2 overflow-x-hidden overflow-y-auto px-4 pb-2"
					>
						{discussions.map((discussion) => (
							<article
								className="min-w-0 max-w-full overflow-hidden rounded-md border border-l-2 bg-card p-3 shadow-xs data-[resolved=true]:border-l-success data-[resolved=false]:border-l-warning"
								key={discussion.id}
								data-discussion-id={discussion.id}
								data-resolved={discussion.resolved ? "true" : "false"}
							>
								<div className="flex min-w-0 flex-wrap items-start gap-2">
									{discussion.resolved ? (
										<CircleCheck
											className="mt-0.5 size-4 shrink-0 text-success"
											aria-hidden
										/>
									) : (
										<CircleDot
											className="mt-0.5 size-4 shrink-0 text-warning"
											aria-hidden
										/>
									)}
									<strong className="min-w-0 flex-1 break-words whitespace-normal text-sm font-medium [overflow-wrap:anywhere]">
										{discussion.resolved ? "Resolved" : "Unresolved"} discussion
									</strong>
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
								</div>
								<div className="min-w-0 max-w-full divide-y divide-border">
									{discussion.notes.map((note) => (
										<div
											key={note.id}
											className="min-w-0 max-w-full overflow-hidden py-2 text-sm"
										>
											<div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
												<span className="min-w-0 break-words [overflow-wrap:anywhere]">
													{note.author}
												</span>
												<span className="break-words [overflow-wrap:anywhere]">
													· {new Date(note.createdAt).toLocaleTimeString()}
												</span>
											</div>
											<CommentMarkdown body={note.body} />
										</div>
									))}
								</div>
							</article>
						))}
					</CollapsibleContent>
				</Collapsible>
			) : null}
			<header className="min-w-0 shrink-0 space-y-3 border-b px-4 py-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<Bot className="size-4" aria-hidden />
						<h2 className="text-base font-semibold">Agent</h2>
					</div>
					<div className="flex items-center gap-1">
						<IconButton
							label="New chat"
							tooltip="Start a new agent conversation"
							busy={creatingChat}
							disabled={creatingChat}
							onClick={onNewChat}
						>
							<Plus aria-hidden />
						</IconButton>
						<IconButton
							label="Settings"
							tooltip="Settings"
							onClick={onOpenSettings}
						>
							<Settings aria-hidden />
						</IconButton>
					</div>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								type="button"
								variant="outline"
								size="xs"
								className="w-full min-w-0 max-w-full justify-between"
								aria-label="Switch chat"
							>
								<span className="min-w-0 flex-1 truncate text-left [overflow-wrap:anywhere]">
									{activeLabel}
								</span>
								<Badge variant="outline">{chats.length}</Badge>
								<ChevronDown className="size-4" aria-hidden />
							</Button>
						}
					/>
					<DropdownMenuContent className="w-[var(--anchor-width)] min-w-0 max-w-full text-xs">
						{chats.length === 0 ? (
							<DropdownMenuItem disabled>No chats</DropdownMenuItem>
						) : (
							chats.map((chat, index) => {
								const active = chat.id === activeChatId;
								return (
									<DropdownMenuItem
										key={chat.id}
										className="min-w-0 max-w-full text-xs"
										data-active={active ? "true" : "false"}
										aria-current={active ? "true" : undefined}
										onClick={() => onSelectChat(chat.id)}
									>
										{chat.busy ? (
											<Loader2
												className="size-4 animate-spin"
												role="img"
												aria-label="Turn running"
											/>
										) : (
											<span className="size-4 shrink-0" aria-hidden />
										)}
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="min-w-0 break-words whitespace-normal [overflow-wrap:anywhere]">
												{chatLabel(chat, index)}
											</span>
											<span className="shrink-0 text-[11px] text-muted-foreground">
												{new Date(chat.createdAt).toLocaleTimeString()}
											</span>
										</span>
										{active ? <Check className="size-4" aria-hidden /> : null}
									</DropdownMenuItem>
								);
							})
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</header>
			<div
				className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-4 py-3"
				ref={transcriptElement}
				onScroll={handleTranscriptScroll}
			>
				{transcript.length === 0 &&
				!isBusy &&
				streamingSegments.every((segment) => segment.length === 0) ? (
					<p className="text-sm text-muted-foreground">
						Ask what changed, or select lines in a hunk for context.
					</p>
				) : null}
				{transcript.map((entry) => {
					if (entry.role === "assistant" && entry.text.length === 0)
						return null;
					const role = entry.role === "user" ? "user" : "assistant";
					return (
						<article
							className={`min-w-0 max-w-full overflow-hidden rounded-md border p-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out ${
								role === "user"
									? "ml-6 border-primary/20 bg-primary/15"
									: "bg-card"
							}`}
							key={`${entry.sessionId ?? "legacy"}-${entry.at}`}
							data-role={role}
							aria-live={role === "assistant" ? "polite" : undefined}
						>
							<strong className="mb-1 block text-xs font-medium text-muted-foreground">
								{role === "assistant" && entry.partial
									? "Assistant · partial reply"
									: roleLabel(entry.role)}
							</strong>
							<ChatMessageBody
								text={entry.text}
								onOpenFileRef={onOpenFileRef}
							/>
							{entry.tags.length > 0 ? (
								<ul className="mt-2 flex min-w-0 max-w-full flex-wrap gap-1.5">
									{entry.tags.map((tag) => (
										<li className="min-w-0 max-w-full" key={tagKey(tag)}>
											<Badge
												variant="secondary"
												className="h-auto max-w-full min-w-0 shrink justify-start gap-1 overflow-visible text-left whitespace-normal break-words font-mono text-[11px] leading-normal [overflow-wrap:anywhere]"
											>
												<span className="min-w-0 break-words whitespace-normal text-left [overflow-wrap:anywhere]">
													{tagLabel(tag)}
												</span>
											</Badge>
										</li>
									))}
								</ul>
							) : null}
						</article>
					);
				})}
				{streamingSegments.map((segment, index) =>
					segment.length > 0 ? (
						<article
							className="min-w-0 max-w-full overflow-hidden rounded-md border bg-card p-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out"
							key={streamingKeys.current[index]}
							data-role="assistant"
							data-streaming="true"
							aria-live="polite"
						>
							<strong className="mb-1 block text-xs font-medium text-muted-foreground">
								{index === streamingSegments.length - 1 && !sending
									? "Assistant · partial reply"
									: "Assistant"}
							</strong>
							<ChatMessageBody text={segment} onOpenFileRef={onOpenFileRef} />
							<span
								aria-hidden
								className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary/80 align-text-bottom"
							/>
						</article>
					) : null,
				)}
				{tools.length > 0 ? (
					<section
						className="min-w-0 max-w-full space-y-1 text-xs text-muted-foreground"
						aria-label="Agent tool activity"
					>
						<div className="flex items-center gap-2 font-medium">
							<Wrench className="size-3.5" aria-hidden />
							<span>Tool activity</span>
						</div>
						<ul className="space-y-1">
							{tools.map((tool) => (
								<li
									className="flex min-w-0 items-start gap-2"
									key={`${tool.id}-${tool.name}`}
								>
									{tool.phase === "start" ? (
										<Loader2 className="size-3.5 animate-spin" aria-hidden />
									) : (
										<Check className="size-3.5 text-success" aria-hidden />
									)}
									<span className="min-w-0 flex-1 break-words whitespace-normal [overflow-wrap:anywhere]">
										{tool.name}
									</span>
									<span className="shrink-0">
										{tool.phase === "start" ? "running" : "done"}
									</span>
								</li>
							))}
						</ul>
					</section>
				) : null}
				{error ? (
					<Alert
						className="min-w-0 max-w-full overflow-hidden [overflow-wrap:anywhere]"
						variant="destructive"
					>
						{error}
					</Alert>
				) : null}
				{isBusy ? (
					<div
						className="flex items-center gap-2 text-xs text-muted-foreground"
						role="status"
					>
						<Loader2 className="size-4 animate-spin" aria-hidden="true" />
						<span>Thinking</span>
					</div>
				) : null}
			</div>
			<form
				className="min-w-0 shrink-0 space-y-2 border-t p-4"
				onSubmit={handleSubmit}
			>
				{tags.length > 0 ? (
					<div className="min-w-0 space-y-1.5">
						<div className="text-xs text-muted-foreground">Context tags</div>
						<div className="flex min-w-0 flex-wrap items-center gap-1.5">
							{tags.map((tag) => (
								<Badge
									key={tagKey(tag)}
									variant="secondary"
									className="h-auto max-w-full min-w-0 shrink justify-start gap-1 overflow-visible text-left whitespace-normal break-words font-mono text-[11px] leading-normal animate-in zoom-in-95 fade-in duration-150 ease-out [overflow-wrap:anywhere]"
									title={
										isFileChatTag(tag)
											? "Whole file"
											: isMarkdownChatTag(tag)
												? (tag.quote ?? "")
												: tag.hunk
									}
								>
									<span className="min-w-0 break-words whitespace-normal text-left [overflow-wrap:anywhere]">
										{tagLabel(tag)}
									</span>
									<IconButton
										label={`Remove tag ${tagLabel(tag)}`}
										size="icon-xs"
										onClick={() => onRemoveTag(tag)}
									>
										<X aria-hidden />
									</IconButton>
								</Badge>
							))}
							{onClearTags ? (
								<Button
									type="button"
									variant="ghost"
									size="xs"
									onClick={onClearTags}
								>
									<Eraser aria-hidden />
									Clear all
								</Button>
							) : null}
						</div>
					</div>
				) : null}
				<Textarea
					aria-label="Chat message"
					className="min-h-20 resize-none"
					placeholder="Ask about this merge request"
					value={draft}
					onChange={(event) => onDraftChange(event.target.value)}
					onKeyDown={handleKeyDown}
					rows={4}
				/>
				<div className="flex min-w-0 items-center justify-between gap-2">
					{!isBusy ? (
						<p className="flex min-w-0 flex-col gap-1 text-[11px] leading-tight text-muted-foreground">
							<span>
								<Kbd className="h-5 min-w-5 px-1 text-[11px]">Enter</Kbd> to
								send
							</span>
							<span>
								<Kbd className="h-5 min-w-5 px-1 text-[11px]">Shift+Enter</Kbd>{" "}
								for a new line
							</span>
						</p>
					) : (
						<span />
					)}
					<div className="flex items-center gap-2">
						<Button
							type="submit"
							size="sm"
							disabled={isBusy || draft.trim().length === 0}
							aria-busy={isBusy ? "true" : undefined}
							aria-label={isBusy ? "Thinking" : undefined}
						>
							{isBusy ? (
								<Loader2 className="animate-spin" aria-hidden="true" />
							) : (
								<SendHorizontal aria-hidden />
							)}
							<span>Send</span>
						</Button>
						{isBusy ? (
							<Button
								type="button"
								variant="destructive"
								size="sm"
								aria-label="Stop"
								onClick={onStop}
								disabled={stopping}
							>
								<Square aria-hidden />
								{stopping ? "Stopping…" : "Stop"}
							</Button>
						) : null}
					</div>
				</div>
			</form>
		</aside>
	);
}
