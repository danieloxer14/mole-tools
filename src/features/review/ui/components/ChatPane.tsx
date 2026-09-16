import {
	type FormEvent,
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
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
import { CogIcon, PlusIcon } from "./Icons";
import {
	isTranscriptAtBottom,
	scrollTranscriptToBottom,
} from "./transcript-scroll";

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

	if (parsed.error) {
		return <p className="chat-message-body">{text}</p>;
	}
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: delegates clicks for agent-generated file-ref links embedded in sanitized markdown; the links are the actual interactive targets.
		// biome-ignore lint/a11y/useKeyWithClickEvents: delegated target is a real <a>, which already carries native keyboard activation.
		<div
			className="chat-message-body rendered-markdown"
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
/** Transcript entries append in order; position keeps refreshed history objects mounted. */
function transcriptKeyForPosition(position: number): string {
	return `transcript-${position}`;
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
	streamingSegments,
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
	const switcher = useRef<HTMLDetailsElement | null>(null);
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
		transcriptElement,
	]);
	const handleTranscriptScroll = () => {
		const element = transcriptElement.current;
		if (element) followTranscript.current = isTranscriptAtBottom(element);
	};
	useEffect(() => {
		const element = switcher.current;
		if (!element) return;
		const close = (event: Event) => {
			if (!element.open) return;
			if (
				event.type === "pointerdown" &&
				event.target instanceof Node &&
				element.contains(event.target)
			) {
				return;
			}
			if (
				event.type === "keydown" &&
				(event as KeyboardEvent).key !== "Escape"
			) {
				return;
			}
			element.open = false;
		};
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", close);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", close);
		};
	}, []);

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
		<aside className="right-column">
			{discussions.length > 0 ? (
				<details className="discussion-list" aria-label="General discussions">
					<summary>General discussions</summary>
					{discussions.map((discussion) => (
						<article
							className={`discussion ${
								discussion.resolved ? "resolved" : "unresolved"
							}`}
							key={discussion.id}
							data-discussion-id={discussion.id}
						>
							<strong>
								{discussion.resolved ? "Resolved" : "Unresolved"} discussion
							</strong>
							{onExplainDiscussion ? (
								<button
									type="button"
									className="discussion-explain"
									data-action="explain"
									disabled={explainDisabled}
									onClick={() => onExplainDiscussion(discussion.id)}
								>
									Explain
								</button>
							) : null}
							{discussion.notes.map((note) => (
								<div key={note.id} className="chat-general-note">
									<strong>{note.author}</strong>
									<CommentMarkdown body={note.body} />
								</div>
							))}
						</article>
					))}
				</details>
			) : null}
			<header className="column-header chat-header">
				<div className="chat-header-row">
					<h2>Agent</h2>
					<div className="chat-header-actions">
						<IconButton
							label="New chat"
							tooltip="Start a new agent conversation"
							busy={creatingChat}
							disabled={creatingChat}
							onClick={onNewChat}
						>
							<PlusIcon />
						</IconButton>
						<IconButton
							label="Settings"
							tooltip="Settings"
							onClick={onOpenSettings}
						>
							<CogIcon />
						</IconButton>
					</div>
				</div>
				<details className="chat-switcher" ref={switcher}>
					<summary aria-label="Switch chat">
						<span className="chat-switcher-current">{activeLabel}</span>
						<span className="chat-switcher-count">{chats.length}</span>
					</summary>
					<ul>
						{chats.map((chat, index) => (
							<li key={chat.id}>
								<button
									type="button"
									className="chat-switcher-item"
									aria-current={chat.id === activeChatId ? "true" : undefined}
									onClick={() => {
										onSelectChat(chat.id);
										if (switcher.current) switcher.current.open = false;
									}}
								>
									{chat.busy ? (
										<span
											className="chat-switcher-busy"
											role="img"
											aria-label="Turn running"
										>
											●
										</span>
									) : null}
									<span className="chat-switcher-title">
										{chatLabel(chat, index)}
									</span>
									<span className="chat-switcher-meta">
										{new Date(chat.createdAt).toLocaleTimeString()}
									</span>
								</button>
							</li>
						))}
					</ul>
				</details>
			</header>
			<div
				className="chat-messages"
				ref={transcriptElement}
				onScroll={handleTranscriptScroll}
			>
				{transcript.length === 0 &&
				!isBusy &&
				streamingSegments.every((segment) => segment.length === 0) ? (
					<p className="placeholder">
						Ask what changed, or select lines in a hunk for context.
					</p>
				) : null}
				{transcript.map((entry, index) => {
					if (entry.role === "assistant" && entry.text.length === 0)
						return null;
					return (
						<article
							className={`chat-message ${entry.role === "user" ? "user" : "assistant"}`}
							key={transcriptKeyForPosition(index)}
							aria-live={entry.role === "assistant" ? "polite" : undefined}
						>
							<strong>
								{entry.role === "assistant" && entry.partial
									? "Assistant · partial reply"
									: roleLabel(entry.role)}
							</strong>
							<ChatMessageBody
								text={entry.text}
								onOpenFileRef={onOpenFileRef}
							/>
							{entry.tags.length > 0 ? (
								<ul className="chat-message-tags">
									{entry.tags.map((tag) => (
										<li key={tagKey(tag)}>{tagLabel(tag)}</li>
									))}
								</ul>
							) : null}
						</article>
					);
				})}
				{streamingSegments.map((segment, index) =>
					segment.length > 0 ? (
						<article
							className="chat-message assistant chat-streaming"
							key={streamingKeys.current[index]}
						>
							<strong>
								{index === streamingSegments.length - 1 && !sending
									? "Assistant · partial reply"
									: "Assistant"}
							</strong>
							<ChatMessageBody text={segment} onOpenFileRef={onOpenFileRef} />
						</article>
					) : null,
				)}
				{error ? (
					<p className="chat-error" role="alert">
						{error}
					</p>
				) : null}
				{isBusy ? (
					<div className="chat-thinking" role="status">
						<span className="chat-spinner" aria-hidden="true" />
						Thinking
					</div>
				) : null}
			</div>
			<form className="chat-composer" onSubmit={handleSubmit}>
				{tags.length > 0 ? (
					<fieldset className="chat-tags">
						<legend>Context tags</legend>
						{onClearTags ? (
							<button
								type="button"
								className="chat-tags-clear"
								onClick={onClearTags}
							>
								Clear all
							</button>
						) : null}
						{tags.map((tag) => (
							<span
								className="chat-tag"
								key={tagKey(tag)}
								title={
									isFileChatTag(tag)
										? "Whole file"
										: isMarkdownChatTag(tag)
											? (tag.quote ?? "")
											: tag.hunk
								}
							>
								{tagLabel(tag)}
								<button
									type="button"
									aria-label={`Remove ${tagLabel(tag)} context`}
									onClick={() => onRemoveTag(tag)}
								>
									×
								</button>
							</span>
						))}
					</fieldset>
				) : null}
				<textarea
					aria-label="Chat message"
					placeholder="Ask about this merge request"
					value={draft}
					onChange={(event) => onDraftChange(event.target.value)}
					onKeyDown={handleKeyDown}
					rows={4}
				/>
				<div className="chat-composer-actions">
					<button
						type="submit"
						className="chat-send"
						disabled={isBusy || draft.trim().length === 0}
						aria-busy={isBusy}
						aria-label={isBusy ? "Thinking" : undefined}
					>
						{isBusy ? (
							<span className="chat-spinner" aria-hidden="true" />
						) : (
							"Send"
						)}
					</button>
					{isBusy ? (
						<button
							type="button"
							className="chat-stop"
							onClick={onStop}
							disabled={stopping}
						>
							{stopping ? "Stopping…" : "Stop"}
						</button>
					) : null}
				</div>
				{!isBusy ? (
					<p className="chat-composer-hint">
						Enter to send, Shift+Enter for a new line.
					</p>
				) : null}
			</form>
		</aside>
	);
}
