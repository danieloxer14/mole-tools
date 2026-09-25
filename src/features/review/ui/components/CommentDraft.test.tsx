import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { Draft } from "../../state";
import { CommentDraft, type CommentDraftProps } from "./CommentDraft";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

test("opens an empty comment draft in its editor", () => {
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

	expect(markup).toContain("<textarea");
	expect(markup).toContain('aria-label="Comment draft"');
	expect(markup).toContain('data-status="draft"');
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

	expect(markup).not.toContain("<textarea");
	expect(markup).toContain("<h1>Draft heading</h1>");
	expect(markup).toContain("<strong>Important</strong>");
	expect(markup).toContain("<li>item</li>");
	expect(markup).toContain("<code>inline</code>");
	expect(markup).toContain('aria-label="Draft editor mode"');
	expect(markup).toContain('data-state="on"');
	expect(markup).toContain('data-state="off"');
});

test("marks failed drafts and keeps retry and editor mode controls", () => {
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
		/>,
	);

	expect(markup).toContain('data-status="failed"');
	expect(markup).toContain('role="alert"');
	expect(markup).toContain("Posting failed");
	expect(markup).toContain("Retry");
	expect(markup).toContain('data-state="on"');
	expect(markup).toContain('data-state="off"');
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
		expect(generated).toBe("draft-from-chat");
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

test("centers Preview and Write and groups From chat beside Send", () => {
	const markup = renderToStaticMarkup(
		<CommentDraft
			draft={draftFor()}
			onCancel={() => {}}
			onEdit={() => {}}
			onSend={() => {}}
			onRetry={() => {}}
			fromChat={fromChat()}
		/>,
	);
	const container = document.createElement("div");
	container.innerHTML = markup;
	const footer = container.querySelector("article > div.mt-2.grid");
	const toggle = container.querySelector('[aria-label="Draft editor mode"]');
	const fromChatButton = container.querySelector(
		'button[aria-label="From chat"]',
	);
	const sendButton = [...container.querySelectorAll("button")].find((button) =>
		button.textContent?.includes("Send"),
	);
	expect(footer?.children[1]).toBe(toggle);
	expect(fromChatButton?.closest(".flex")).toBe(sendButton?.parentElement);
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
		expect(stopped).toBe("draft-from-chat");
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
