import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { Draft } from "../../state";
import { CommentDraft, type CommentDraftProps } from "./CommentDraft";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

test("opens an empty comment draft in Write with the selector in the header", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={{
				id: "draft-1",
				body: "",
				selection: {
					path: "src/app.ts",
					side: "new",
					startLine: 5,
					endLine: 5,
				},
				filePath: "src/app.ts",
				status: "draft",
				error: null,
				postedDiscussionId: null,
				staleSince: null,
			}}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
		/>,
	);
	const container = document.createElement("div");
	container.innerHTML = markup;
	const article = container.querySelector("article");
	const header = article?.querySelector("header");
	const badge = header?.querySelector('[data-slot="badge"]');
	const selector = header?.querySelector('[aria-label="Draft editor mode"]');
	const preview = header?.querySelector<HTMLButtonElement>(
		'button[aria-label="Preview"]',
	);
	const write = header?.querySelector<HTMLButtonElement>(
		'button[aria-label="Write"]',
	);

	expect(container.querySelector("textarea")).not.toBeNull();
	expect(
		container.querySelector('textarea[aria-label="Comment draft"]'),
	).not.toBeNull();
	expect(article?.getAttribute("data-status")).toBe("draft");
	expect(
		container.querySelectorAll('[aria-label="Draft editor mode"]'),
	).toHaveLength(1);
	expect(selector?.previousElementSibling).toBe(badge);
	expect(selector?.parentElement).toBe(badge?.parentElement);
	expect(preview?.getAttribute("aria-pressed")).toBe("false");
	expect(write?.getAttribute("aria-pressed")).toBe("true");
	expect(preview?.querySelector(".sr-only")?.textContent).toBe("Preview");
	expect(write?.querySelector(".sr-only")?.textContent).toBe("Write");
	expect(preview?.getAttribute("title")).toBeNull();
	expect(write?.getAttribute("title")).toBeNull();
	expect(
		article?.lastElementChild?.querySelector(
			'[aria-label="Draft editor mode"]',
		),
	).toBeNull();
	expect(markup).toContain('disabled=""');
});

test("starts non-empty drafts in Preview and renders Markdown", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={{
				id: "draft-preview",
				body: "# Draft heading\n\n**Important**\n\n- item\n\n`inline`",
				selection: {
					path: "src/app.ts",
					side: "new",
					startLine: 5,
					endLine: 5,
				},
				filePath: "src/app.ts",
				status: "draft",
				error: null,
				postedDiscussionId: null,
				staleSince: null,
			}}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
		/>,
	);
	const container = document.createElement("div");
	container.innerHTML = markup;
	const preview = container.querySelector<HTMLButtonElement>(
		'header button[aria-label="Preview"]',
	);
	const write = container.querySelector<HTMLButtonElement>(
		'header button[aria-label="Write"]',
	);

	expect(container.querySelector("textarea")).toBeNull();
	expect(markup).toContain("<h1>Draft heading</h1>");
	expect(markup).toContain("<strong>Important</strong>");
	expect(markup).toContain("<li>item</li>");
	expect(markup).toContain("<code>inline</code>");
	expect(
		container.querySelectorAll('[aria-label="Draft editor mode"]'),
	).toHaveLength(1);
	expect(preview?.getAttribute("aria-pressed")).toBe("true");
	expect(write?.getAttribute("aria-pressed")).toBe("false");
});

test("marks failed drafts and keeps their selector and Retry actions together", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={{
				id: "draft-failed",
				body: "Needs another try",
				selection: {
					path: "src/app.ts",
					side: "new",
					startLine: 5,
					endLine: 5,
				},
				filePath: "src/app.ts",
				status: "failed",
				error: "Posting failed",
				postedDiscussionId: null,
				staleSince: null,
			}}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
			fromChat={fromChat()}
		/>,
	);
	const container = document.createElement("div");
	container.innerHTML = markup;
	const article = container.querySelector("article");
	const header = article?.querySelector("header");
	const badge = header?.querySelector('[data-slot="badge"]');
	const selector = header?.querySelector('[aria-label="Draft editor mode"]');
	const footer = article?.lastElementChild;
	const cancel = [...container.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === "Cancel",
	);
	const fromChatButton = container.querySelector(
		'button[aria-label="From chat"]',
	);
	const retry = [...container.querySelectorAll("button")].find((button) =>
		button.textContent?.includes("Retry"),
	);

	expect(article?.getAttribute("data-status")).toBe("failed");
	expect(container.textContent).toContain("Posting failed");
	expect(container.textContent).toContain("Retry");
	expect(
		container.querySelectorAll('[aria-label="Draft editor mode"]'),
	).toHaveLength(1);
	expect(selector?.previousElementSibling).toBe(badge);
	expect(fromChatButton?.parentElement).toBe(retry?.parentElement);
	expect(cancel?.parentElement).toBe(
		footer?.firstElementChild as HTMLElement | null,
	);
	expect(fromChatButton?.parentElement).toBe(
		footer?.lastElementChild as HTMLElement | null,
	);
});

test("does not expose the selector while a draft is sending", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={draftFor("Sending comment", "sending")}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
		/>,
	);
	const container = document.createElement("div");
	container.innerHTML = markup;
	const article = container.querySelector("article");

	expect(article?.getAttribute("data-status")).toBe("sending");
	expect(container.textContent).toContain("Sending…");
	expect(
		container.querySelectorAll('[aria-label="Draft editor mode"]'),
	).toHaveLength(0);
	expect(container.querySelector('button[aria-label="Preview"]')).toBeNull();
	expect(container.querySelector('button[aria-label="Write"]')).toBeNull();
	expect(container.querySelector("textarea")).toBeNull();
});

test("keeps the shared mode selector for diff-line and Markdown-block drafts", () => {
	const drafts: Draft[] = [
		draftFor("Shared draft"),
		{
			...draftFor("Shared draft"),
			selection: {
				kind: "markdown",
				path: "src/app.ts",
				startLine: 5,
				endLine: 6,
				quote: "Shared draft",
			},
		},
	];

	for (const draft of drafts) {
		const markup = renderToStaticMarkup(
			<CommentDraft
				draft={draft}
				onCancel={() => {}}
				onEdit={() => {}}
				onSend={() => {}}
				onRetry={() => {}}
				fromChat={fromChat()}
			/>,
		);
		const container = document.createElement("div");
		container.innerHTML = markup;
		const article = container.querySelector("article");

		expect(
			container.querySelectorAll('[aria-label="Draft editor mode"]'),
		).toHaveLength(1);
		expect(article?.lastElementChild?.textContent).toContain("Cancel");
		expect(article?.lastElementChild?.textContent).toContain("From chat");
		expect(article?.lastElementChild?.textContent).toContain("Send");
	}
});

test("bounds long draft paths and Markdown regions without removing draft actions", () => {
	const longPath =
		"packages/review/features/comments/components/very-long-draft-file-name.ts";
	const body = [
		`Please inspect ${longPath} and https://example.test/${"draft-segment".repeat(16)}.`,
		"",
		"```text",
		"long fenced draft content",
		"```",
		"",
		"| file | detail |",
		"| --- | --- |",
		`| ${longPath} | table content |`,
	].join("\n");
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={{
				id: "draft-long",
				body,
				selection: {
					path: longPath,
					side: "new",
					startLine: 5,
					endLine: 5,
				},
				filePath: longPath,
				status: "draft",
				error: null,
				postedDiscussionId: null,
				staleSince: null,
			}}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
		/>,
	);
	const container = document.createElement("div");
	container.innerHTML = markup;
	const article = container.querySelector<HTMLElement>(
		'[data-draft-id="draft-long"]',
	);
	const markdown = article?.querySelector<HTMLElement>(".comment-markdown");
	const tableWrap = markdown?.querySelector<HTMLElement>(
		".rendered-table-wrap",
	);

	expect(article?.className).toContain("min-w-0");
	expect(article?.className).toContain("max-w-full");
	expect(article?.className).toContain("overflow-hidden");
	expect(markdown?.className).toContain("min-w-0");
	expect(markdown?.className).toContain("[overflow-wrap:anywhere]");
	expect(markdown?.querySelector("pre")).not.toBeNull();
	expect(tableWrap?.className).toContain("max-w-full");
	expect(container.textContent).toContain(longPath);
	expect(container.textContent).toContain("Send");
});
function draftFor(
	body = "",
	status: Draft["status"] = "draft",
	error: string | null = null,
): Draft {
	return {
		id: "draft-from-chat",
		body,
		selection: {
			path: "src/app.ts",
			side: "new",
			startLine: 5,
			endLine: 5,
		},
		filePath: "src/app.ts",
		status,
		error,
		postedDiscussionId: null,
		staleSince: null,
	};
}

function fromChat(
	generation: NonNullable<
		CommentDraftProps["fromChat"]
	>["generation"] = undefined,
): NonNullable<CommentDraftProps["fromChat"]> {
	return {
		availability: { kind: "ready", chatLabel: "Review chat" },
		generation,
		onGenerate: () => {},
		onStop: () => {},
	};
}

test("shows From chat with a ready tooltip and calls onGenerate", async () => {
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	let generated: string | null = null;
	try {
		act(() => {
			root.render(
				<CommentDraft
					draft={draftFor()}
					onCancel={() => {}}
					onEdit={() => {}}
					onSend={() => {}}
					onRetry={() => {}}
					fromChat={{
						...fromChat(),
						onGenerate: (id) => {
							generated = id;
						},
					}}
				/>,
			);
		});
		const button = container.querySelector<HTMLButtonElement>(
			'button[aria-label="From chat"]',
		);
		expect(button).not.toBeNull();
		await act(async () => {
			button?.focus();
			await Bun.sleep(0);
		});
		const tooltip = document.body.querySelector(
			'[data-slot="tooltip-content"]',
		);
		expect(tooltip?.textContent).toBe("Generate comment from Review chat");
		act(() => button?.click());
		expect(generated as string | null).toBe("draft-from-chat");
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("disables From chat with its availability reason", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={draftFor()}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
			fromChat={{
				...fromChat(),
				availability: {
					kind: "disabled",
					reason: "Wait for the chat reply to finish",
				},
			}}
		/>,
	);
	const container = document.createElement("div");
	container.innerHTML = markup;
	const button = [...container.querySelectorAll("button")].find((candidate) =>
		candidate.textContent?.includes("From chat"),
	);
	expect(button?.hasAttribute("disabled")).toBe(true);
});

test("running generation turns its control into a hoverable stop action", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={draftFor()}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
			fromChat={fromChat({ status: "running" })}
		/>,
	);
	const container = document.createElement("div");
	container.innerHTML = markup;
	expect(container.textContent).toContain("Generating…");
	expect(
		container.querySelectorAll('button[aria-label="Stop generating comment"]'),
	).toHaveLength(1);
	const generatingButton = container.querySelector(
		'button[aria-label="Stop generating comment"]',
	);
	expect(generatingButton?.getAttribute("aria-busy")).toBe("true");
	expect(generatingButton?.className).toContain("group");
	expect(generatingButton?.className).toContain("w-36");
	expect(generatingButton?.querySelectorAll("svg")).toHaveLength(2);
	expect(container.querySelectorAll("button")).toHaveLength(5);
	expect(
		[...container.querySelectorAll("button")].some(
			(button) => button.textContent?.trim() === "Stop",
		),
	).toBe(false);
	expect(container.querySelector("textarea")?.disabled).toBe(true);
	const send = [...container.querySelectorAll("button")].find((candidate) =>
		candidate.textContent?.includes("Send"),
	);
	expect(send?.hasAttribute("disabled")).toBe(true);
});

test("shows accessible icon tooltips and switches failed draft modes locally", async () => {
	const source = "# Existing heading\n\n**Important**";
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const edits: string[] = [];
	const button = (label: string) =>
		container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

	try {
		act(() => {
			root.render(
				<CommentDraft
					draft={draftFor(source, "failed", "Posting failed")}
					onCancel={() => {}}
					onEdit={(_id, body) => edits.push(body)}
					onSend={() => {}}
					onRetry={() => {}}
				/>,
			);
		});
		expect(
			container.querySelector("article")?.getAttribute("data-status"),
		).toBe("failed");

		const preview = button("Preview");
		const write = button("Write");
		expect(
			preview?.querySelector("svg")?.classList.contains("lucide-pilcrow"),
		).toBe(true);
		expect(write?.querySelector("svg")?.classList.contains("lucide-diff")).toBe(
			true,
		);
		expect(preview?.querySelector(".sr-only")?.textContent).toBe("Preview");
		expect(write?.querySelector(".sr-only")?.textContent).toBe("Write");
		expect(preview?.getAttribute("title")).toBeNull();
		expect(write?.getAttribute("title")).toBeNull();
		expect(preview?.getAttribute("aria-pressed")).toBe("true");
		expect(write?.getAttribute("aria-pressed")).toBe("false");
		expect(container.querySelector("h1")?.textContent).toBe("Existing heading");
		expect(container.querySelector("textarea")).toBeNull();

		await act(async () => {
			document.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
			);
			preview?.focus();
			await Bun.sleep(0);
		});
		expect(document.activeElement).toBe(preview);
		expect(
			document.body.querySelector('[data-slot="tooltip-content"]')?.textContent,
		).toBe("Preview");

		await act(async () => {
			preview?.blur();
			write?.focus();
			await Bun.sleep(0);
		});
		expect(
			document.body.querySelector('[data-slot="tooltip-content"]')?.textContent,
		).toBe("Write");

		act(() => write?.click());
		expect(button("Preview")?.getAttribute("aria-pressed")).toBe("false");
		expect(button("Write")?.getAttribute("aria-pressed")).toBe("true");
		expect(
			container.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Comment draft"]',
			)?.value,
		).toBe(source);
		expect(edits).toEqual([]);

		act(() => button("Preview")?.click());
		expect(button("Preview")?.getAttribute("aria-pressed")).toBe("true");
		expect(button("Write")?.getAttribute("aria-pressed")).toBe("false");
		expect(container.querySelector("textarea")).toBeNull();
		expect(container.querySelector("h1")?.textContent).toBe("Existing heading");
		expect(
			container.querySelector(".comment-markdown strong")?.textContent,
		).toBe("Important");
		expect(edits).toEqual([]);
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("keeps Cancel left and groups From chat with Send at right", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const actions: string[] = [];
	try {
		act(() => {
			root.render(
				<CommentDraft
					draft={draftFor("Ready to send")}
					onCancel={(id) => actions.push(`cancel:${id}`)}
					onEdit={() => {}}
					onSend={(id) => actions.push(`send:${id}`)}
					onRetry={() => {}}
					fromChat={{
						...fromChat(),
						onGenerate: (id) => actions.push(`generate:${id}`),
					}}
				/>,
			);
		});
		const article = container.querySelector("article");
		const footer = article?.lastElementChild;
		const cancel = [...container.querySelectorAll("button")].find(
			(candidate) => candidate.textContent?.trim() === "Cancel",
		);
		const fromChatButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="From chat"]',
		);
		const send = [...container.querySelectorAll("button")].find((candidate) =>
			candidate.textContent?.includes("Send"),
		);

		expect(cancel?.parentElement).toBe(
			footer?.firstElementChild as HTMLElement | null,
		);
		expect(fromChatButton?.parentElement).toBe(send?.parentElement);
		expect(fromChatButton?.parentElement).toBe(
			footer?.lastElementChild as HTMLElement | null,
		);
		act(() => {
			cancel?.click();
			fromChatButton?.click();
			send?.click();
		});
		expect(actions).toEqual([
			"cancel:draft-from-chat",
			"generate:draft-from-chat",
			"send:draft-from-chat",
		]);
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("keeps Retry with From chat and calls Retry for failed drafts", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const actions: string[] = [];
	try {
		act(() => {
			root.render(
				<CommentDraft
					draft={draftFor("Failed draft", "failed", "Posting failed")}
					onCancel={(id) => actions.push(`cancel:${id}`)}
					onEdit={() => {}}
					onSend={() => {}}
					onRetry={(id) => actions.push(`retry:${id}`)}
					fromChat={{
						...fromChat(),
						onGenerate: (id) => actions.push(`generate:${id}`),
					}}
				/>,
			);
		});
		const article = container.querySelector("article");
		const footer = article?.lastElementChild;
		const cancel = [...container.querySelectorAll("button")].find(
			(candidate) => candidate.textContent?.trim() === "Cancel",
		);
		const fromChatButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="From chat"]',
		);
		const retry = [...container.querySelectorAll("button")].find((candidate) =>
			candidate.textContent?.includes("Retry"),
		);

		expect(cancel?.parentElement).toBe(
			footer?.firstElementChild as HTMLElement | null,
		);
		expect(fromChatButton?.parentElement).toBe(retry?.parentElement);
		expect(fromChatButton?.parentElement).toBe(
			footer?.lastElementChild as HTMLElement | null,
		);
		act(() => {
			cancel?.click();
			fromChatButton?.click();
			retry?.click();
		});
		expect(actions).toEqual([
			"cancel:draft-from-chat",
			"generate:draft-from-chat",
			"retry:draft-from-chat",
		]);
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("clicking the generating control stops generation", () => {
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	let stopped: string | null = null;
	try {
		act(() => {
			root.render(
				<CommentDraft
					draft={draftFor()}
					onCancel={() => {}}
					onEdit={() => {}}
					onSend={() => {}}
					onRetry={() => {}}
					fromChat={{
						...fromChat({ status: "running" }),
						onStop: (id) => {
							stopped = id;
						},
					}}
				/>,
			);
		});
		act(() =>
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Stop generating comment"]',
				)
				?.click(),
		);
		expect(stopped as string | null).toBe("draft-from-chat");
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("failed generation shows a prefixed destructive alert", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={draftFor("Existing draft", "draft", "Posting failed")}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
			fromChat={fromChat({ status: "failed", error: "Agent stopped" })}
		/>,
	);
	const container = document.createElement("div");
	container.innerHTML = markup;
	expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
	expect(container.textContent).toContain("Posting failed");
	expect(container.textContent).toContain(
		"Couldn't generate comment: Agent stopped",
	);
});

test("omits From chat when no context is supplied", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={draftFor()}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
		/>,
	);
	expect(markup).not.toContain("From chat");
});
