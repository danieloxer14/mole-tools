import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatEntry } from "../../store";
import { ChatPane } from "./ChatPane";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const interactiveRoots: Root[] = [];

afterEach(() => {
	for (const root of interactiveRoots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.replaceChildren();
});
function parseMarkup(markup: string): HTMLDivElement {
	const container = document.createElement("div");
	container.innerHTML = markup;
	return container;
}

function transcriptEntry(
	role: "user" | "assistant",
	text: string,
	skills: ChatEntry["skills"] = [],
): ChatEntry {
	return {
		role,
		text,
		tags: [],
		skills,
		at: `${role}-${text}`,
		sessionId: "session-1",
		partial: false,
	};
}

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
					agent: null,
					model: null,
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
			onSend={() => undefined}
			onStop={() => {}}
			onRemoveTag={() => {}}
		/>,
	);

	const container = parseMarkup(markup);
	const trigger = container.querySelector<HTMLButtonElement>(
		'button[aria-label="General discussions"]',
	);
	expect(trigger?.getAttribute("aria-expanded")).toBe("false");
	expect(container.querySelector('[data-resolved="false"]')).not.toBeNull();
	expect(container.textContent).toContain("Please rename this.");
});

test("renders one switcher item per chat with active and busy state", async () => {
	let selectedChatId = "";
	const rendered = renderInteractive({
		chats: [
			{
				id: "chat-1",
				title: "",
				agent: null,
				model: null,
				createdAt: "2026-08-24T00:00:00Z",
				busy: false,
			},
			{
				id: "chat-2",
				title: "Investigate API",
				createdAt: "2026-08-24T01:00:00Z",
				busy: true,
				agent: "claude",
				model: "opus",
			},
		],
		activeChatId: "chat-2",
		onSelectChat: (chatId) => {
			selectedChatId = chatId;
		},
	});

	const trigger = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Switch chat"]',
	);
	expect(trigger).not.toBeNull();
	expect(trigger?.className).toContain("text-xs");
	await act(async () => {
		trigger?.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});

	const menuItems = [
		...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	];
	expect(menuItems).toHaveLength(2);
	expect(menuItems[0]?.className).toContain("text-xs");
	expect(menuItems[0]?.textContent).not.toContain("· claude");
	expect(menuItems[1]?.textContent).toContain("· claude · opus");
	expect(menuItems[0]?.querySelector("span span")?.className).toContain(
		"[overflow-wrap:anywhere]",
	);
	expect(menuItems[0]?.textContent).toContain("New chat 1");
	expect(menuItems[1]?.textContent).toContain("Investigate API");
	expect(menuItems[0]?.dataset.active).toBe("false");
	expect(menuItems[1]?.dataset.active).toBe("true");
	expect(
		document.body.querySelector('[aria-label="Turn running"]'),
	).not.toBeNull();
	expect(
		rendered.container.querySelector('button[aria-label="New chat"]'),
	).not.toBeNull();
	expect(
		rendered.container.querySelector('button[aria-label="Clear chat"]'),
	).toBeNull();

	await act(async () => {
		menuItems[0]?.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	expect(selectedChatId).toBe("chat-1");
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

	const container = parseMarkup(markup);
	const button = container.querySelector<HTMLButtonElement>(
		'button[aria-label="New chat"]',
	);
	expect(button).not.toBeNull();
	expect(button?.getAttribute("aria-busy")).toBe("true");
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
					agent: null,
					model: null,
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
			onSend={() => undefined}
			onStop={() => {}}
			onRemoveTag={() => {}}
		/>,
	);

	const container = parseMarkup(markup);
	const textarea = container.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Chat message"]',
	);
	expect(textarea?.value).toBe("unsent question");
	expect(textarea?.getAttribute("placeholder")).toBe(
		"Ask about this merge request (type / to open skills)",
	);
});

test("composer has no skill button beside Send", () => {
	const container = parseMarkup(renderComposer());
	expect(
		container.querySelector('form button[aria-label="Insert skill"]'),
	).toBeNull();
	expect(container.querySelector('form button[type="submit"]')).not.toBeNull();
});

test("renders composer keyboard hint as compact two visible lines", () => {
	const markup = renderComposer();
	const container = parseMarkup(markup);
	const textarea = container.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Chat message"]',
	);
	const hint = container.querySelector<HTMLElement>("p.flex.flex-col");
	const hintLines = [
		...container.querySelectorAll<HTMLElement>("p.flex.flex-col > span"),
	];
	const keys = [
		...container.querySelectorAll<HTMLElement>("p.flex.flex-col kbd"),
	];

	expect(textarea).not.toBeNull();
	expect(textarea?.getAttribute("aria-label")).toBe("Chat message");
	expect(hint?.className).toContain("gap-1");
	expect(hint?.className).toContain("text-[11px]");
	expect(hint?.className).toContain("leading-tight");
	expect(hintLines).toHaveLength(2);
	expect(keys).toHaveLength(2);
	expect(keys.every((key) => key.className.includes("text-[11px]"))).toBe(true);
	expect(keys.every((key) => key.className.includes("h-5"))).toBe(true);
	expect(hintLines[0]?.textContent).toContain("Enter");
	expect(hintLines[0]?.textContent).toContain("to send");
	expect(hintLines[1]?.textContent).toContain("Shift+Enter");
	expect(hintLines[1]?.textContent).toContain("for a new line");
});

test("bounds long agent paths in message markdown and context tags", () => {
	const longPath =
		"packages/review/features/agent/components/very-long-file-name.ts";
	const markup = renderComposer({
		transcript: [
			{
				role: "assistant",
				text: `See \`${longPath}:42\`.`,
				tags: [],
				at: "2026-08-24T00:00:00Z",
				sessionId: "session-1",
			},
		],
		tags: [{ kind: "file", path: longPath }],
	});
	const container = parseMarkup(markup);
	const message = container.querySelector('[data-role="assistant"]');
	const markdown = message?.querySelector(".rendered-markdown");
	expect(message?.className).toContain("min-w-0");
	expect(message?.className).toContain("max-w-full");
	expect(message?.className).toContain("overflow-hidden");
	expect(message?.parentElement?.className).toContain("min-h-0");
	expect(message?.parentElement?.className).toContain("flex-1");
	expect(message?.parentElement?.className).toContain("overflow-x-hidden");
	expect(message?.parentElement?.className).toContain("overflow-y-auto");
	const tag = [
		...container.querySelectorAll<HTMLElement>('[data-slot="badge"]'),
	].find((element) => element.textContent?.includes(longPath));

	expect(markdown?.className).toContain("min-w-0");
	expect(markdown?.className).toContain("[overflow-wrap:anywhere]");
	expect(tag?.className).toContain("max-w-full");
	expect(tag?.className).toContain("[overflow-wrap:anywhere]");
	expect(tag?.className).toContain("justify-start");
	expect(tag?.className).toContain("leading-normal");
	expect(container.textContent).toContain(longPath);
});

test("collapses referenced multi-line skill text to a transcript chip", () => {
	const skillText = "CHECK THE TESTS\nRUN THE TESTS";
	const container = parseMarkup(
		renderComposer({
			transcript: [
				transcriptEntry(
					"user",
					`Please inspect:\n\n${skillText}\n\nThen summarize.`,
					[{ name: "review-it", version: 1, text: skillText }],
				),
			],
		}),
	);
	const message = container.querySelector<HTMLElement>(
		'[data-role="user"] .rendered-markdown',
	);
	const chips = message?.querySelectorAll<HTMLSpanElement>(
		'span.skill-tag[data-skill-name="review-it"]',
	);

	expect(chips).toHaveLength(1);
	expect(chips?.[0]?.textContent).toBe("/review-it");
	expect(message?.textContent).toContain("Please inspect:");
	expect(message?.textContent).toContain("Then summarize.");
	expect(message?.textContent).not.toContain("CHECK THE TESTS");
	expect(message?.textContent).not.toContain("RUN THE TESTS");
});

test("renders persisted skill invocations from exact source positions", () => {
	const entries: ChatEntry[] = [
		{
			...transcriptEntry("user", "Keep  here", [
				{ name: "empty-one", version: 1, text: "" },
			]),
			sourceText: "Keep /empty-one here",
			skillInvocations: [{ name: "empty-one", start: 5, end: 15 }],
		},
		{
			...transcriptEntry("user", "shared body shared body", [
				{ name: "same-one", version: 1, text: "shared body" },
				{ name: "same-two", version: 1, text: "shared body" },
			]),
			sourceText: "/same-one /same-two",
			skillInvocations: [
				{ name: "same-one", start: 0, end: 9 },
				{ name: "same-two", start: 10, end: 19 },
			],
		},
		{
			...transcriptEntry("user", "/literal-two", [
				{ name: "literal-one", version: 1, text: "/literal-two" },
			]),
			sourceText: "/literal-one",
			skillInvocations: [{ name: "literal-one", start: 0, end: 12 }],
		},
	];
	const currentSkills = [
		"empty-one",
		"same-one",
		"same-two",
		"literal-one",
		"literal-two",
	].map((name) => ({
		name,
		activeVersion: 1,
		versions: [1],
		lastUsedAt: null,
	}));
	const container = parseMarkup(
		renderComposer({ transcript: entries, skills: currentSkills }),
	);
	const messages = [
		...container.querySelectorAll<HTMLElement>(
			'[data-role="user"] .rendered-markdown',
		),
	];

	expect(messages[0]?.textContent).toContain("Keep /empty-one here");
	expect(
		messages[0]?.querySelector('.skill-tag[data-skill-name="empty-one"]')
			?.textContent,
	).toBe("/empty-one");
	const sameTags = [...(messages[1]?.querySelectorAll(".skill-tag") ?? [])].map(
		(tag) => tag.textContent,
	);
	expect(sameTags).toEqual(["/same-one", "/same-two"]);
	expect(messages[2]?.textContent).toContain("/literal-one");
	const literalTags = [
		...(messages[2]?.querySelectorAll(".skill-tag") ?? []),
	].map((tag) => tag.textContent);
	expect(literalTags).toEqual(["/literal-one"]);
});

test("does not retroactively tag legacy literal tokens from current skills", () => {
	const legacy = transcriptEntry("user", "Please /late-skill now");
	const container = parseMarkup(
		renderComposer({
			transcript: [legacy],
			skills: [
				{
					name: "late-skill",
					activeVersion: 1,
					versions: [1],
					lastUsedAt: null,
				},
			],
		}),
	);
	const message = container.querySelector<HTMLElement>(
		'[data-role="user"] .rendered-markdown',
	);

	expect(message?.textContent).toContain("Please /late-skill now");
	expect(message?.querySelector(".skill-tag")).toBeNull();
});

test("renders optimistic user skill tokens but leaves assistant tokens unchanged", () => {
	const userText = "Please /review-it now";
	const assistant = transcriptEntry("assistant", userText);
	const skills = [
		{
			name: "review-it",
			activeVersion: 1,
			versions: [1],
			lastUsedAt: null,
		},
	];
	const container = parseMarkup(
		renderComposer({
			transcript: [
				{ ...transcriptEntry("user", userText), optimistic: true },
				assistant,
			],
			skills,
		}),
	);
	const userMessage = container.querySelector<HTMLElement>(
		'[data-role="user"] .rendered-markdown',
	);
	const assistantMessage = container.querySelector<HTMLElement>(
		'[data-role="assistant"] .rendered-markdown',
	);
	const baseline = parseMarkup(
		renderComposer({ transcript: [assistant] }),
	).querySelector<HTMLElement>('[data-role="assistant"] .rendered-markdown');

	expect(
		userMessage?.querySelector<HTMLSpanElement>(
			'span.skill-tag[data-skill-name="review-it"]',
		)?.textContent,
	).toBe("/review-it");
	expect(assistantMessage?.querySelector(".skill-tag")).toBeNull();
	expect(assistantMessage?.innerHTML).toBe(baseline?.innerHTML);
});

test("keeps markup unchanged for user entries with empty refs and no skill tokens", () => {
	const text = "Skill-free message.\n\nNothing to expand.";
	const skill = {
		name: "review-it",
		activeVersion: 1,
		versions: [1],
		lastUsedAt: null,
	};
	const userMessage = parseMarkup(
		renderComposer({
			transcript: [transcriptEntry("user", text)],
			skills: [skill],
		}),
	).querySelector<HTMLElement>('[data-role="user"] .rendered-markdown');
	const baseline = parseMarkup(
		renderComposer({ transcript: [transcriptEntry("assistant", text)] }),
	).querySelector<HTMLElement>('[data-role="assistant"] .rendered-markdown');

	expect(userMessage?.innerHTML).toBe(baseline?.innerHTML);
	expect(userMessage?.querySelector(".skill-tag")).toBeNull();
});

test("keeps the agent pane growth and scroll regions bounded", () => {
	const container = parseMarkup(renderComposer());
	const pane = container.querySelector<HTMLElement>("aside");
	const transcript = container.querySelector<HTMLElement>(
		"div.min-h-0.min-w-0.flex-1",
	);
	const header = container.querySelector<HTMLElement>("header");
	const composer = container.querySelector<HTMLFormElement>("form");

	expect(pane?.className).toContain("h-full");
	expect(pane?.className).toContain("min-h-0");
	expect(pane?.className).toContain("min-w-0");
	expect(pane?.className).toContain("overflow-hidden");
	expect(header?.className).toContain("shrink-0");
	expect(header?.className).toContain("min-w-0");
	expect(transcript).not.toBeNull();
	expect(transcript?.className).toContain("min-h-0");
	expect(transcript?.className).toContain("flex-1");
	expect(transcript?.className).toContain("overflow-x-hidden");
	expect(transcript?.className).toContain("overflow-y-auto");
	expect(composer?.className).toContain("shrink-0");
	expect(composer?.className).toContain("min-w-0");
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
					agent: null,
					model: null,
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
			onSend={() => undefined}
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
						agent: null,
						model: null,
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
				onSend={() => undefined}
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

test("reopens slash picker after selected skill draft is cleared", () => {
	const skills = [
		{
			name: "review-newest",
			activeVersion: 1,
			versions: [1],
			lastUsedAt: "2026-09-23T12:00:00.000Z",
		},
	];
	let draft = "";
	const onDraftChange = (value: string) => {
		draft = value;
	};
	const rendered = renderInteractive({ draft, skills, onDraftChange });
	const textarea = rendered.container.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Chat message"]',
	);
	if (!textarea) throw new Error("Chat composer did not render a textarea");

	const inputText = (value: string) => {
		Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(textarea, value);
		textarea.setSelectionRange(value.length, value.length);
		textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
	};

	act(() => inputText("/"));
	rendered.rerender({ draft, skills, onDraftChange });
	expect(rendered.container.querySelector('[role="listbox"]')).not.toBeNull();
	act(() =>
		textarea.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Enter",
			}),
		),
	);
	rendered.rerender({ draft, skills, onDraftChange });
	expect(textarea.value).toBe("/review-newest ");
	expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();

	draft = "";
	rendered.rerender({ draft, skills, onDraftChange });
	expect(textarea.value).toBe("");
	act(() => inputText("/"));
	rendered.rerender({ draft, skills, onDraftChange });
	expect(textarea.value).toBe("/");
	expect(rendered.container.querySelector('[role="listbox"]')).not.toBeNull();
});

test("keeps persisted assistant card DOM stable across history refresh", () => {
	const entry = {
		role: "assistant" as const,
		text: "Completed answer",
		tags: [],
		at: "2026-08-24T00:00:00Z",
		sessionId: "session-1",
	};
	const rendered = renderInteractive({ transcript: [entry] });
	const firstCard = rendered.container.querySelector('[data-role="assistant"]');
	expect(firstCard).not.toBeNull();
	act(() => {
		rendered.rerender({ transcript: [{ ...entry }] });
	});
	expect(rendered.container.querySelector('[data-role="assistant"]')).toBe(
		firstCard,
	);
});
test("renders Thinking state without disabling the editable composer", () => {
	const markup = renderComposer({ sending: true, busy: true, draft: "draft" });

	expect(markup).toMatch(/<textarea[^>]*>draft<\/textarea>/);
	expect(parseMarkup(markup).querySelector("textarea")?.disabled).toBe(false);
	expect(markup).toMatch(
		/<button[^>]*type="submit"[^>]*disabled[^>]*aria-busy="true"/,
	);
	expect(markup).toContain("Thinking");
	const container = parseMarkup(markup);
	const busyIcon = container.querySelector('button[aria-busy="true"] svg');
	expect(busyIcon?.getAttribute("class")).toContain("animate-spin");
	expect(busyIcon?.getAttribute("aria-hidden")).toBe("true");
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
				skills: [],
				at: "2026-08-24T00:00:00Z",
				sessionId: "session-1",
				partial: false,
			},
			{
				role: "assistant",
				text: "First answer",
				tags: [],
				skills: [],
				at: "2026-08-24T00:00:01Z",
				sessionId: "session-1",
				partial: false,
			},
			{
				role: "assistant",
				text: "Partial answer",
				tags: [],
				skills: [],
				at: "2026-08-24T00:00:02Z",
				sessionId: "session-1",
				partial: true,
			},
			{
				role: "assistant",
				text: "",
				tags: [],
				skills: [],
				at: "2026-08-24T00:00:03Z",
				sessionId: "session-1",
				partial: false,
			},
		],
		streamingSegments: ["Live before", "", "Live before"],
		sending: true,
		busy: true,
	});

	expect(markup.match(/data-role="assistant"/g)).toHaveLength(4);
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
	const container = parseMarkup(markup);
	expect(container.querySelector('[role="alert"]')?.textContent).toContain(
		"Agent failed",
	);
	expect(markup).toContain("Assistant · partial reply");
	expect(markup).not.toContain("Tool activity");
});

test("does not submit Enter while busy but submits only plain Enter while idle", () => {
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
	const busyEnter = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key: "Enter",
	});
	const busyShiftEnter = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key: "Enter",
		shiftKey: true,
	});
	busyTextarea?.dispatchEvent(busyEnter);
	busyTextarea?.dispatchEvent(busyShiftEnter);
	expect(busySends).toBe(0);
	expect(busyTextarea?.disabled).toBe(false);
	expect(busyEnter.defaultPrevented).toBe(true);
	expect(busyShiftEnter.defaultPrevented).toBe(false);

	let idleSends = 0;
	const idleRender = renderInteractive({
		draft: "send this",
		onSend: () => {
			idleSends += 1;
		},
	});
	const idleTextarea = idleRender.container.querySelector("textarea");
	const idleShiftEnter = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key: "Enter",
		shiftKey: true,
	});
	idleTextarea?.dispatchEvent(idleShiftEnter);
	expect(idleSends).toBe(0);
	expect(idleShiftEnter.defaultPrevented).toBe(false);

	const idleEnter = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key: "Enter",
	});
	idleTextarea?.dispatchEvent(idleEnter);
	expect(idleSends).toBe(1);
	expect(idleEnter.defaultPrevented).toBe(true);
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
		new window.KeyboardEvent("keydown", {
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
test("exposes semantic message and streaming state", () => {
	const markup = renderComposer({
		transcript: [
			{
				role: "user",
				text: "What changed?",
				tags: [],
				skills: [],
				at: "2026-08-24T00:00:00Z",
				sessionId: "session-1",
			},
			{
				role: "assistant",
				text: "First answer",
				tags: [],
				at: "2026-08-24T00:00:01Z",
				skills: [],
				sessionId: "session-1",
			},
		],
		streamingSegments: ["Live before"],
		sending: true,
		busy: true,
	});
	const container = parseMarkup(markup);
	expect(container.querySelector('[data-role="user"]')).not.toBeNull();
	expect(container.querySelector('[data-role="assistant"]')).not.toBeNull();
	const streaming = container.querySelector(
		'[data-role="assistant"][data-streaming="true"]',
	);
	expect(streaming).not.toBeNull();
	expect(streaming?.textContent).toContain("Live before");
	expect(streaming?.querySelector('span[aria-hidden="true"]')).not.toBeNull();
});

test("opens file references from rendered assistant markdown", () => {
	let openedPath = "";
	const rendered = renderInteractive({
		transcript: [
			{
				role: "assistant",
				text: "See `src/index.ts:12`.",
				tags: [],
				at: "2026-08-24T00:00:00Z",
				sessionId: "session-1",
			},
		],
		onOpenFileRef: (path) => {
			openedPath = path;
		},
	});
	const link = rendered.container.querySelector<HTMLAnchorElement>(
		'a[data-file-path="src/index.ts"]',
	);
	act(() => {
		link?.click();
	});
	expect(openedPath).toBe("src/index.ts");
});
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
					agent: null,
					model: null,
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
			onSend={() => undefined}
			onStop={() => {}}
			onRemoveTag={() => {}}
			{...props}
		/>,
	);
}

test("renders an Explain button on general discussions when a handler is supplied", () => {
	const markup = renderGeneralDiscussions({ onExplainDiscussion: () => {} });

	const container = parseMarkup(markup);
	const buttons = [
		...container.querySelectorAll<HTMLButtonElement>(
			'button[data-action="explain"]',
		),
	];
	expect(buttons).toHaveLength(2);
	for (const id of ["discussion-1", "discussion-2"]) {
		const card = container.querySelector<HTMLElement>(
			`[data-discussion-id="${id}"]`,
		);
		expect(card).not.toBeNull();
		expect(card?.querySelector('button[data-action="explain"]')).not.toBeNull();
		expect(card?.textContent).toContain("Explain");
	}
	expect(buttons.every((button) => !button.disabled)).toBe(true);
});

test("disables general Explain buttons when explainDisabled is set", () => {
	const markup = renderGeneralDiscussions({
		onExplainDiscussion: () => {},
		explainDisabled: true,
	});

	const container = parseMarkup(markup);
	const buttons = [
		...container.querySelectorAll<HTMLButtonElement>(
			'button[data-action="explain"]',
		),
	];
	expect(buttons).toHaveLength(2);
	expect(buttons.every((button) => button.disabled)).toBe(true);
});

test("omits Explain on general discussions when no handler is supplied", () => {
	const markup = renderGeneralDiscussions();

	const container = parseMarkup(markup);
	expect(
		container.querySelector('[data-discussion-id="discussion-1"]'),
	).not.toBeNull();
	expect(container.querySelector('button[data-action="explain"]')).toBeNull();
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

	const container = parseMarkup(markup);
	expect(container.querySelector("h1")?.textContent).toBe("General note");
	expect(container.querySelector("li")?.textContent).toBe("item");
	expect(container.querySelector("pre code")?.textContent).toContain(
		"general code",
	);
	expect(container.textContent).toContain("click");
	expect(container.querySelector("[onclick]")).toBeNull();
});
test("bounds long general discussion content and keeps code and table regions internal", () => {
	const longPath =
		"packages/review/features/comments/components/very-long-general-file-name.ts";
	const body = [
		`Please inspect ${longPath} and https://example.test/${"path-segment".repeat(16)}.`,
		"",
		"```text",
		"long fenced content that remains inside its own scrollable pre region",
		"```",
		"",
		"| file | detail |",
		"| --- | --- |",
		`| ${longPath} | table content |`,
	].join("\n");
	const markup = renderGeneralDiscussions({
		discussions: [
			{
				...generalDiscussions[0],
				notes: [{ ...generalDiscussions[0].notes[0], body }],
			},
		],
	});
	const container = parseMarkup(markup);
	const card = container.querySelector<HTMLElement>(
		'[data-discussion-id="discussion-1"]',
	);
	const markdown = card?.querySelector<HTMLElement>(".comment-markdown");
	const tableWrap = markdown?.querySelector<HTMLElement>(
		".rendered-table-wrap",
	);

	const panel = container.querySelector<HTMLElement>("#general-discussions");
	expect(panel?.className).toContain("min-h-0");
	expect(panel?.className).toContain("max-h-[40vh]");
	expect(panel?.className).toContain("overflow-x-hidden");
	expect(panel?.className).toContain("overflow-y-auto");
	expect(card?.className).toContain("min-w-0");
	expect(card?.className).toContain("max-w-full");
	expect(card?.className).toContain("overflow-hidden");
	expect(markdown?.className).toContain("min-w-0");
	expect(markdown?.className).toContain("[overflow-wrap:anywhere]");
	expect(markdown?.querySelector("pre")).not.toBeNull();
	expect(tableWrap?.className).toContain("max-w-full");
	expect(container.textContent).toContain(longPath);
});

test("groups general Explain in compact actions and preserves its callback", () => {
	let explained = "";
	const rendered = renderInteractive({
		discussions: generalDiscussions,
		onExplainDiscussion: (discussionId) => {
			explained = discussionId;
		},
	});
	const group = rendered.container.querySelector<HTMLElement>(
		'[data-action-group="discussion-actions"]',
	);
	const button = rendered.container.querySelector<HTMLButtonElement>(
		'button[data-action="explain"]',
	);

	expect(group?.className).toContain("flex");
	expect(group?.className).toContain("shrink-0");
	expect(button?.className).toContain("bg-primary");
	act(() => button?.click());
	expect(explained).toBe("discussion-1");
});

test("marks general Explain as busy while disabled", () => {
	const container = parseMarkup(
		renderGeneralDiscussions({
			onExplainDiscussion: () => {},
			explainDisabled: true,
		}),
	);
	const button = container.querySelector<HTMLButtonElement>(
		'button[data-action="explain"]',
	);

	expect(button?.disabled).toBe(true);
	expect(button?.getAttribute("aria-busy")).toBe("true");
	expect(button?.querySelector("svg.animate-spin")).not.toBeNull();
});
