import {
	type FormEvent,
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useMemo,
	useRef,
} from "react";
import type { HostDiscussion } from "../../../../ports/git-host";
import { renderMarkdownHtml } from "../../../../shared/markdown";
import type { ChatEntry, ChatTag } from "../../store";

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
	streamingText: string;
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
	creatingChat?: boolean;
	draft: string;
	onDraftChange: (value: string) => void;
	onSend: (message: string) => void;
	onStop: () => void;
	onRemoveTag: (tag: ChatTag) => void;
	onClearTags?: () => void;
	onOpenFileRef?: (path: string) => void;
}

function tagLabel(tag: ChatTag): string {
	return `${tag.path}:${tag.side}:${tag.startLine}-${tag.endLine}`;
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
function chatLabel(chat: ChatSummary, index: number): string {
	return chat.title || `New chat ${index + 1}`;
}

export function ChatPane({
	transcript,
	tags,
	discussions = [],
	streamingText,
	tools,
	error,
	sending,
	stopping,
	busy = false,
	chats,
	activeChatId,
	onSelectChat,
	onNewChat,
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
	const activeChatIndex = chats.findIndex((chat) => chat.id === activeChatId);
	const activeChat = activeChatIndex >= 0 ? chats[activeChatIndex] : null;
	const activeLabel = activeChat
		? chatLabel(activeChat, activeChatIndex)
		: "No chats";

	const isBusy = sending || busy;
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
		onSend(value);
		onDraftChange("");
	};

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		submit();
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			submit();
		}
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
							{discussion.notes.map((note) => (
								<p key={note.id}>
									<strong>{note.author}</strong>: {note.body}
								</p>
							))}
						</article>
					))}
				</details>
			) : null}
			<header className="column-header chat-header">
				<div className="chat-header-row">
					<div>
						<p className="eyebrow">Agent chat</p>
						<h2>Ask about this review</h2>
					</div>
					<button
						type="button"
						className="chat-new"
						onClick={onNewChat}
						disabled={creatingChat}
						title="Start a new agent conversation"
					>
						{creatingChat ? "Creating…" : "New chat"}
					</button>
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
				<p>Chat persists with this merge request.</p>
			</header>
			<div className="chat-messages" aria-live="polite">
				{transcript.length === 0 && !streamingText && !isBusy ? (
					<p className="placeholder">
						Ask what changed, or select lines in a hunk for context.
					</p>
				) : null}
				{isBusy && !sending && !streamingText ? (
					<p className="placeholder">A turn is still running for this chat.</p>
				) : null}
				{transcript.map((entry) => (
					<article
						className={`chat-message ${entry.role === "user" ? "user" : "assistant"}`}
						key={`${entry.at}-${entry.role}-${entry.sessionId ?? "new"}-${entry.text}`}
					>
						<strong>{roleLabel(entry.role)}</strong>
						<ChatMessageBody
							text={entry.text || "(No response)"}
							onOpenFileRef={onOpenFileRef}
						/>
						{entry.tags.length > 0 ? (
							<ul className="chat-message-tags">
								{entry.tags.map((tag) => (
									<li
										key={`${tag.path}-${tag.side}-${tag.startLine}-${tag.endLine}`}
									>
										{tagLabel(tag)}
									</li>
								))}
							</ul>
						) : null}
					</article>
				))}
				{streamingText ? (
					<article className="chat-message assistant chat-streaming">
						<strong>
							Assistant{sending ? " · streaming" : " · partial reply"}
						</strong>
						<ChatMessageBody
							text={streamingText}
							onOpenFileRef={onOpenFileRef}
						/>
					</article>
				) : null}
				{tools.length > 0 ? (
					<section className="chat-tools" aria-label="Agent tool activity">
						<strong>Tool activity</strong>
						<ul>
							{tools.map((tool) => (
								<li key={`${tool.id}-${tool.name}`}>
									{tool.name} · {tool.phase === "start" ? "running" : "done"}
								</li>
							))}
						</ul>
					</section>
				) : null}
				{error ? (
					<p className="chat-error" role="alert">
						{error}
					</p>
				) : null}
			</div>
			<form className="chat-composer" onSubmit={handleSubmit}>
				{tags.length > 0 ? (
					<fieldset className="chat-tags">
						<legend>Line context tags</legend>
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
								key={`${tag.path}-${tag.side}-${tag.startLine}-${tag.endLine}-${tag.hunk}`}
								title={tag.hunk}
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
					disabled={isBusy}
					rows={4}
				/>
				<div className="chat-composer-actions">
					<button type="submit" disabled={isBusy || draft.trim().length === 0}>
						Send
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
				<p className="chat-composer-hint">
					{isBusy
						? stopping
							? "Stopping agent; partial reply will be kept."
							: sending
								? "Agent is reading the review worktree…"
								: "A turn is still running for this chat."
						: "Ctrl/⌘ + Enter to send."}
				</p>
			</form>
		</aside>
	);
}
