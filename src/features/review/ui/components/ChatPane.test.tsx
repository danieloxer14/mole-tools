import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPane } from "./ChatPane";

const dom = new Window();
Object.assign(globalThis, {
	window: dom,
	document: dom.document,
	navigator: dom.navigator,
	Node: dom.Node,
	HTMLElement: dom.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const interactiveRoots: Root[] = [];

afterEach(() => {
	for (const root of interactiveRoots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.replaceChildren();
});

test("renders general discussions collapsed by default", () => {
	const markup = renderToStaticMarkup(
		<ChatPane
			transcript={[]}
			tags={[]}
			chats={[
				{
					id: "chat-1",
					title: "First chat",
					createdAt: "2026-08-24T00:00:00Z",
					busy: false,
				},
			]}
			activeChatId="chat-1"
			onSelectChat={() => {}}
			onNewChat={() => {}}
			onOpenSettings={() => {}}
			draft=""
			onDraftChange={() => {}}
			discussions={[
				{
					id: "discussion-1",
					resolved: false,
					position: null,
					notes: [
						{
							id: "note-1",
							author: "reviewer",
							body: "Please rename this.",
							createdAt: "2026-08-24T00:00:00Z",
							system: false,
						},
					],
				},
			]}
			streamingSegments={[]}
			error={null}
			sending={false}
			stopping={false}
			onSend={() => {}}
			onStop={() => {}}
			onRemoveTag={() => {}}
		/>,
	);

	expect(markup).toContain(
		'<details class="discussion-list" aria-label="General discussions">',
	);
	expect(markup).toContain("<summary>General discussions</summary>");
	expect(markup).not.toMatch(/<details[^>]*\sopen(?:=|[\s>])/);
	expect(markup).toContain("Please rename this.");
});

test("renders one switcher item per chat with active and busy state", () => {
	const markup = renderToStaticMarkup(
		<ChatPane
			transcript={[]}
			tags={[]}
			chats={[
				{
					id: "chat-1",
					title: "",
					createdAt: "2026-08-24T00:00:00Z",
					busy: false,
				},
				{
					id: "chat-2",
					title: "Investigate API",
					createdAt: "2026-08-24T01:00:00Z",
					busy: true,
				},
			]}
			activeChatId="chat-2"
			onSelectChat={() => {}}
			onNewChat={() => {}}
			onOpenSettings={() => {}}
			draft=""
			onDraftChange={() => {}}
			streamingSegments={[]}
			error={null}
			sending={false}
			stopping={false}
			onSend={() => {}}
			onStop={() => {}}
			onRemoveTag={() => {}}
		/>,
	);

	expect(markup.match(/class="chat-switcher-item"/g)).toHaveLength(2);
	expect(markup).toContain("<h2>Agent</h2>");
	expect(markup).toContain("New chat 1");
	expect(markup).toContain('aria-current="true"');
	expect(markup.match(/aria-label="Turn running"/g)).toHaveLength(1);
	expect(markup).toContain("New chat");
	expect(markup).not.toContain("Clear chat");
});

test("wires rendered chat header controls to actions", () => {
	let newChatCalls = 0;
	let settingsCalls = 0;
	const rendered = renderInteractive({
		onNewChat: () => {
			newChatCalls += 1;
		},
		onOpenSettings: () => {
			settingsCalls += 1;
		},
	});

	const newChatButton = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="New chat"]',
	);
	const settingsButton = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Settings"]',
	);
	expect(newChatButton).not.toBeNull();
	expect(settingsButton).not.toBeNull();

	act(() => {
		newChatButton?.click();
		settingsButton?.click();
	});

	expect(newChatCalls).toBe(1);
	expect(settingsCalls).toBe(1);
});

test("disables and marks new chat busy while creating", () => {
	const markup = renderComposer({ creatingChat: true });

	expect(markup).toMatch(
		/<button[^>]*aria-label="New chat"[^>]*disabled(?:="")?[^>]*aria-busy="true"/,
	);
	expect(markup).toContain('class="icon-button-spinner"');
});

test("renders parent-owned composer draft", () => {
	const markup = renderToStaticMarkup(
		<ChatPane
			transcript={[]}
			tags={[]}
			chats={[
				{
					id: "chat-1",
					title: "First chat",
					createdAt: "2026-08-24T00:00:00Z",
					busy: false,
				},
			]}
			activeChatId="chat-1"
			onSelectChat={() => {}}
			onNewChat={() => {}}
			onOpenSettings={() => {}}
			draft="unsent question"
			onDraftChange={() => {}}
			streamingSegments={[]}
			error={null}
			sending={false}
			stopping={false}
			onSend={() => {}}
			onStop={() => {}}
			onRemoveTag={() => {}}
		/>,
	);

	expect(markup).toContain(">unsent question</textarea>");
});

function renderComposer(
	props: Partial<Parameters<typeof ChatPane>[0]> = {},
): string {
	return renderToStaticMarkup(
		<ChatPane
			transcript={[]}
			tags={[]}
			chats={[
				{
					id: "chat-1",
					title: "First chat",
					createdAt: "2026-08-24T00:00:00Z",
					busy: false,
				},
			]}
			activeChatId="chat-1"
			onSelectChat={() => {}}
			onNewChat={() => {}}
			onOpenSettings={() => {}}
			draft=""
			onDraftChange={() => {}}
			streamingSegments={[]}
			error={null}
			sending={false}
			stopping={false}
			onSend={() => {}}
			onStop={() => {}}
			onRemoveTag={() => {}}
			{...props}
		/>,
	);
}

interface InteractiveRender {
	container: HTMLDivElement;
	root: Root;
	rerender: (props: Partial<Parameters<typeof ChatPane>[0]>) => void;
}

function renderInteractive(
	props: Partial<Parameters<typeof ChatPane>[0]> = {},
): InteractiveRender {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	interactiveRoots.push(root);
	const render = (nextProps: Partial<Parameters<typeof ChatPane>[0]>) => {
		root.render(
			<ChatPane
				transcript={[]}
				tags={[]}
				chats={[
					{
						id: "chat-1",
						title: "First chat",
						createdAt: "2026-08-24T00:00:00Z",
						busy: false,
					},
				]}
				activeChatId="chat-1"
				onSelectChat={() => {}}
				onNewChat={() => {}}
				onOpenSettings={() => {}}
				draft=""
				onDraftChange={() => {}}
				streamingSegments={[]}
				error={null}
				sending={false}
				stopping={false}
				onSend={() => {}}
				onStop={() => {}}
				onRemoveTag={() => {}}
				{...nextProps}
			/>,
		);
	};
	act(() => render(props));
	return {
		container,
		root,
		rerender: (nextProps) => act(() => render(nextProps)),
	};
}
function setTranscriptMetrics(
	element: HTMLElement,
	metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
	writes?: { count: number },
) {
	Object.defineProperties(element, {
		scrollHeight: {
			configurable: true,
			get: () => metrics.scrollHeight,
		},
		clientHeight: {
			configurable: true,
			get: () => metrics.clientHeight,
		},
		scrollTop: {
			configurable: true,
			get: () => metrics.scrollTop,
			set: (value: number) => {
				if (writes) writes.count += 1;
				metrics.scrollTop = value;
			},
		},
	});
}

test("follows transcript bottom, preserves upward reading, and sends from older history", () => {
	const rendered = renderInteractive({ streamingSegments: ["first"] });
	const messages = rendered.container.querySelector(".chat-messages");
	expect(messages).not.toBeNull();
	if (!messages) return;
	const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
	const writes = { count: 0 };
	setTranscriptMetrics(messages, metrics, writes);
	messages.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));

	metrics.scrollHeight = 1100;
	rendered.rerender({ streamingSegments: ["first updated"] });
	expect(metrics.scrollTop).toBe(700);

	metrics.scrollTop = 500;
	messages.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
	metrics.scrollHeight = 1200;
	rendered.rerender({ streamingSegments: ["new output"] });
	expect(metrics.scrollTop).toBe(500);

	metrics.scrollTop = 784;
	messages.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
	metrics.scrollHeight = 1300;
	rendered.rerender({ streamingSegments: ["output at threshold"] });
	expect(metrics.scrollTop).toBe(900);

	metrics.scrollTop = 883;
	messages.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
	metrics.scrollHeight = 1400;
	rendered.rerender({
		streamingSegments: ["output above threshold"],
		draft: "send this",
	});
	expect(metrics.scrollTop).toBe(883);

	const textarea = rendered.container.querySelector("textarea");
	expect(textarea).not.toBeNull();
	if (!textarea) return;
	const writesBeforeSend = writes.count;
	textarea.value = "send this";
	textarea.dispatchEvent(
		new dom.window.KeyboardEvent("keydown", {
			bubbles: true,
			key: "Enter",
		}),
	);
	expect(writes.count).toBe(writesBeforeSend);
	expect(metrics.scrollTop).toBe(883);
	metrics.scrollHeight = 1500;
	rendered.rerender({
		streamingSegments: ["after explicit send"],
		draft: "send this",
	});
	expect(writes.count).toBe(writesBeforeSend + 1);
	expect(metrics.scrollTop).toBe(1100);
	metrics.scrollHeight = 1600;
	rendered.rerender({
		streamingSegments: ["after explicit send updated"],
		draft: "send this",
	});
	expect(writes.count).toBe(writesBeforeSend + 2);
	expect(metrics.scrollTop).toBe(1200);
});
test("switching chats forces selected transcript to its latest message", () => {
	const rendered = renderInteractive();
	const messages = rendered.container.querySelector(".chat-messages");
	expect(messages).not.toBeNull();
	if (!messages) return;
	const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 };
	setTranscriptMetrics(messages, metrics);
	messages.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
	rendered.rerender({
		activeChatId: "chat-2",
		chats: [
			{
				id: "chat-1",
				title: "First chat",
				createdAt: "2026-08-24T00:00:00Z",
				busy: false,
			},
			{
				id: "chat-2",
				title: "Second chat",
				createdAt: "2026-08-24T01:00:00Z",
				busy: false,
			},
		],
	});
	expect(metrics.scrollTop).toBe(600);
});

test("keeps persisted card DOM stable when history objects refresh", () => {
	const entry = {
		role: "assistant" as const,
		text: "Completed answer",
		tags: [],
		at: "2026-08-24T00:00:00Z",
		sessionId: "session-1",
		partial: false,
	};
	const rendered = renderInteractive({ transcript: [entry] });
	const firstCard = rendered.container.querySelector(".chat-message");
	expect(firstCard).not.toBeNull();

	rendered.rerender({
		transcript: [{ ...entry }],
	});

	expect(rendered.container.querySelector(".chat-message")).toBe(firstCard);
});
test("keeps idle keyboard hint but removes busy hint below composer", () => {
	const idleMarkup = renderComposer();
	expect(idleMarkup).toContain("Enter to send, Shift+Enter for a new line.");
	expect(idleMarkup).toContain(
		"Ask what changed, or select lines in a hunk for context.",
	);

	const busyMarkup = renderComposer({ sending: true, busy: true });
	expect(busyMarkup).not.toContain(
		"Enter to send, Shift+Enter for a new line.",
	);
});
test("renders one whole-file chip per file tag path", () => {
	const markup = renderComposer({
		tags: [
			{ kind: "file", path: "src/whole.ts" },
			{
				kind: "markdown",
				path: "README.md",
				startLine: 4,
				endLine: 6,
				quote: "## Heading",
			},
		],
	});

	expect(markup).toContain("src/whole.ts (whole file)");
	expect(markup).toContain("README.md:4-6");
	expect(markup).toContain("Whole file");
	expect(markup).toContain(
		'aria-label="Remove src/whole.ts (whole file) context"',
	);
});

test("renders Thinking state without disabling the editable composer", () => {
	const markup = renderComposer({ sending: true, busy: true, draft: "draft" });

	expect(markup).toMatch(/<textarea[^>]*>draft<\/textarea>/);
	expect(markup).not.toMatch(/<textarea[^>]*disabled/);
	expect(markup).toMatch(
		/<button[^>]*type="submit"[^>]*disabled[^>]*aria-busy="true"/,
	);
	expect(markup).toContain("Thinking");
	const busySubmit =
		markup.match(/<button[^>]*type="submit"[^>]*>([\s\S]*?)<\/button>/)?.[1] ??
		"";
	expect(busySubmit).toContain('class="chat-spinner"');
	expect(busySubmit).not.toContain("Thinking");
	expect(markup).toContain('role="status"');
	expect(markup).toContain('class="chat-spinner" aria-hidden="true"');
	expect(markup).not.toContain("Agent is reading the review worktree…");
	expect(markup).toContain(">Stop</button>");
});

test("renders separate assistant cards, partial labels, and no empty cards", () => {
	const markup = renderComposer({
		transcript: [
			{
				role: "user",
				text: "What changed?",
				tags: [],
				at: "2026-08-24T00:00:00Z",
				sessionId: "session-1",
				partial: false,
			},
			{
				role: "assistant",
				text: "First answer",
				tags: [],
				at: "2026-08-24T00:00:01Z",
				sessionId: "session-1",
				partial: false,
			},
			{
				role: "assistant",
				text: "Partial answer",
				tags: [],
				at: "2026-08-24T00:00:02Z",
				sessionId: "session-1",
				partial: true,
			},
			{
				role: "assistant",
				text: "",
				tags: [],
				at: "2026-08-24T00:00:03Z",
				sessionId: "session-1",
				partial: false,
			},
		],
		streamingSegments: ["Live before", "", "Live before"],
		sending: true,
		busy: true,
	});

	expect(markup.match(/class="chat-message assistant/g)).toHaveLength(4);
	expect(markup).toContain("First answer");
	expect(markup).toContain("Assistant · partial reply");
	expect(markup.match(/Live before/g)).toHaveLength(2);
	expect(markup).not.toContain("(No response)");
	expect(markup).not.toContain("Assistant · streaming");
});

test("keeps errors visible without turning them into transcript cards", () => {
	const markup = renderComposer({
		error: "Agent failed",
		streamingSegments: ["Partial answer"],
	});
	expect(markup).toContain(
		'<p class="chat-error" role="alert">Agent failed</p>',
	);
	expect(markup).toContain("Assistant · partial reply");
	expect(markup).not.toContain("Tool activity");
});

test("does not submit Enter while busy but submits plain Enter while idle", () => {
	let busySends = 0;
	const busyRender = renderInteractive({
		draft: "queued draft",
		sending: true,
		busy: true,
		onSend: () => {
			busySends += 1;
		},
	});
	const busyTextarea = busyRender.container.querySelector("textarea");
	expect(busyTextarea).not.toBeNull();
	const busyEnter = new dom.window.KeyboardEvent("keydown", {
		bubbles: true,
		key: "Enter",
	});
	const busyShiftEnter = new dom.window.KeyboardEvent("keydown", {
		bubbles: true,
		key: "Enter",
		shiftKey: true,
	});
	busyTextarea?.dispatchEvent(busyEnter);
	busyTextarea?.dispatchEvent(busyShiftEnter);
	expect(busySends).toBe(0);
	expect(busyTextarea?.disabled).toBe(false);
	expect(busyEnter.defaultPrevented).toBe(false);
	expect(busyShiftEnter.defaultPrevented).toBe(false);

	let idleSends = 0;
	const idleRender = renderInteractive({
		draft: "send this",
		onSend: () => {
			idleSends += 1;
		},
	});
	const idleTextarea = idleRender.container.querySelector("textarea");
	const idleEnter = new dom.window.KeyboardEvent("keydown", {
		bubbles: true,
		key: "Enter",
	});
	idleTextarea?.dispatchEvent(idleEnter);
	expect(idleSends).toBe(1);
});
test("leaves parent-owned draft clearing to the accepted send path", () => {
	let draftChanges = 0;
	let sends = 0;
	const rendered = renderInteractive({
		draft: "send this",
		onDraftChange: () => {
			draftChanges += 1;
		},
		onSend: () => {
			sends += 1;
		},
	});
	const textarea = rendered.container.querySelector("textarea");
	expect(textarea).not.toBeNull();
	textarea?.dispatchEvent(
		new dom.window.KeyboardEvent("keydown", {
			bubbles: true,
			key: "Enter",
		}),
	);
	expect(sends).toBe(1);
	expect(draftChanges).toBe(0);
});
const generalDiscussions = [
	{
		id: "discussion-1",
		resolved: false,
		position: null,
		notes: [
			{
				id: "note-1",
				author: "reviewer",
				body: "Please rename this.",
				createdAt: "2026-08-24T00:00:00Z",
				system: false,
			},
		],
	},
	{
		id: "discussion-2",
		resolved: true,
		position: null,
		notes: [
			{
				id: "note-2",
				author: "reviewer",
				body: "Looks good now.",
				createdAt: "2026-08-24T00:00:00Z",
				system: false,
			},
		],
	},
];

function renderGeneralDiscussions(
	props: Partial<Parameters<typeof ChatPane>[0]> = {},
): string {
	return renderToStaticMarkup(
		<ChatPane
			transcript={[]}
			tags={[]}
			chats={[
				{
					id: "chat-1",
					title: "First chat",
					createdAt: "2026-08-24T00:00:00Z",
					busy: false,
				},
			]}
			activeChatId="chat-1"
			onSelectChat={() => {}}
			onNewChat={() => {}}
			onOpenSettings={() => {}}
			draft=""
			onDraftChange={() => {}}
			discussions={generalDiscussions}
			streamingSegments={[]}
			error={null}
			sending={false}
			stopping={false}
			onSend={() => {}}
			onStop={() => {}}
			onRemoveTag={() => {}}
			{...props}
		/>,
	);
}

test("renders an Explain button on general discussions when a handler is supplied", () => {
	const markup = renderGeneralDiscussions({ onExplainDiscussion: () => {} });

	expect(markup.match(/data-action="explain"/g)).toHaveLength(2);
	for (const id of ["discussion-1", "discussion-2"]) {
		const card = markup.match(
			new RegExp(
				`<article[^>]*data-discussion-id="${id}"[^>]*>[\\s\\S]*?</article>`,
			),
		)?.[0];
		expect(card).toBeDefined();
		expect(card).toContain('data-action="explain"');
		expect(card).toContain(">Explain</button>");
	}
	expect(markup).not.toMatch(
		/<button[^>]*data-action="explain"[^>]*\sdisabled/,
	);
});

test("disables general Explain buttons when explainDisabled is set", () => {
	const markup = renderGeneralDiscussions({
		onExplainDiscussion: () => {},
		explainDisabled: true,
	});

	const buttons =
		markup.match(/<button[^>]*data-action="explain"[^>]*>/g) ?? [];
	expect(buttons).toHaveLength(2);
	for (const button of buttons) {
		expect(button).toMatch(/\sdisabled(?:=""|[\s>])/);
	}
});

test("omits Explain on general discussions when no handler is supplied", () => {
	const markup = renderGeneralDiscussions();

	expect(markup).toContain('data-discussion-id="discussion-1"');
	expect(markup).not.toContain('data-action="explain"');
});

test("renders general discussion Markdown through the sanitized comment renderer", () => {
	const markup = renderGeneralDiscussions({
		discussions: [
			{
				id: "markdown-general-discussion",
				resolved: false,
				position: null,
				notes: [
					{
						id: "markdown-general-note",
						author: "reviewer",
						body: [
							"# General note",
							"",
							"_Important_",
							"",
							"- item",
							"",
							"```text",
							"general code",
							"```",
							"",
							'<span onclick="alert(1)">click</span>',
						].join("\n"),
						createdAt: "2026-01-01T00:00:00.000Z",
						system: false,
					},
				],
			},
		],
	});

	expect(markup).toContain("<h1>General note</h1>");
	expect(markup).toContain("<li>item</li>");
	expect(markup).toContain("<pre><code");
	expect(markup).toContain("<em>Important</em>");
	expect(markup).toContain(">click</span>");
	expect(markup).not.toContain("onclick");
});
