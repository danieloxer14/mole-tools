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
			streamingText=""
			tools={[]}
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
			streamingText=""
			tools={[]}
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
			streamingText=""
			tools={[]}
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
			streamingText=""
			tools={[]}
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
}

function renderInteractive(
	props: Partial<Parameters<typeof ChatPane>[0]> = {},
): InteractiveRender {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	interactiveRoots.push(root);
	act(() => {
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
				streamingText=""
				tools={[]}
				error={null}
				sending={false}
				stopping={false}
				onSend={() => {}}
				onStop={() => {}}
				onRemoveTag={() => {}}
				{...props}
			/>,
		);
	});
	return { container, root };
}

test("hints that Enter submits and Shift+Enter adds a new line", () => {
	const markup = renderComposer();

	expect(markup).toContain("Enter to send, Shift+Enter for a new line.");
	expect(markup).not.toContain("Ctrl");
	expect(markup).not.toContain("⌘");
	expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
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

test("disables the composer and shows the busy hint while a turn runs", () => {
	const markup = renderComposer({ sending: true });

	expect(markup).toMatch(/<textarea[^>]*disabled/);
	expect(markup).not.toContain("Enter to send, Shift+Enter for a new line.");
	expect(markup).toContain("Agent is reading the review worktree…");
	expect(markup).toContain(">Stop</button>");
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
			streamingText=""
			tools={[]}
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
