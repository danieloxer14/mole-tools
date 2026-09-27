import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { HostDiscussion } from "../../../../ports/git-host";
import { GeneralDiscussionList } from "./GeneralDiscussions";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const discussions: HostDiscussion[] = [
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

function renderMarkup(
	props: Partial<Parameters<typeof GeneralDiscussionList>[0]> = {},
): string {
	return renderToStaticMarkup(
		<GeneralDiscussionList discussions={discussions} {...props} />,
	);
}

test("renders the same discussion cards and Explain action attributes", () => {
	const container = parseMarkup(
		renderMarkup({ onExplainDiscussion: () => {} }),
	);
	const cards = [...container.querySelectorAll<HTMLElement>("article")];

	expect(cards).toHaveLength(2);
	expect(cards[0]?.className).toBe(
		"min-w-0 max-w-full overflow-hidden rounded-md border border-l-2 bg-card p-3 shadow-xs data-[resolved=true]:border-l-success data-[resolved=false]:border-l-warning",
	);
	expect(cards[0]?.dataset.discussionId).toBe("discussion-1");
	expect(cards[0]?.dataset.resolved).toBe("false");
	expect(cards[1]?.dataset.discussionId).toBe("discussion-2");
	expect(cards[1]?.dataset.resolved).toBe("true");
	for (const card of cards) {
		expect(
			card.querySelector('[data-action-group="discussion-actions"]'),
		).not.toBeNull();
		const button = card.querySelector<HTMLButtonElement>(
			'button[data-action="explain"]',
		);
		expect(button?.textContent).toContain("Explain");
		expect(button?.disabled).toBe(false);
	}
});

test("omits Explain action when no callback is supplied", () => {
	const container = parseMarkup(renderMarkup());

	expect(container.querySelectorAll("article")).toHaveLength(2);
	expect(
		container.querySelector('[data-action-group="discussion-actions"]'),
	).toBe(null);
	expect(container.querySelector('button[data-action="explain"]')).toBeNull();
});

test("forwards the selected discussion id from Explain", () => {
	let explainedId = "";
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	interactiveRoots.push(root);
	act(() =>
		root.render(
			<GeneralDiscussionList
				discussions={discussions}
				onExplainDiscussion={(id) => {
					explainedId = id;
				}}
			/>,
		),
	);
	const button = container.querySelector<HTMLButtonElement>(
		'[data-discussion-id="discussion-1"] button[data-action="explain"]',
	);

	act(() => button?.click());

	expect(explainedId).toBe("discussion-1");
});

test("marks Explain as busy while disabled", () => {
	const container = parseMarkup(
		renderMarkup({
			onExplainDiscussion: () => {},
			explainDisabled: true,
		}),
	);
	const buttons = [
		...container.querySelectorAll<HTMLButtonElement>(
			'button[data-action="explain"]',
		),
	];

	expect(buttons).toHaveLength(2);
	for (const button of buttons) {
		expect(button.disabled).toBe(true);
		expect(button.getAttribute("aria-busy")).toBe("true");
		expect(button.querySelector("svg.animate-spin")).not.toBeNull();
	}
});

test("renders discussion notes with sanitized Markdown", () => {
	const container = parseMarkup(
		renderMarkup({
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
		}),
	);

	expect(container.querySelector("h1")?.textContent).toBe("General note");
	expect(container.querySelector("li")?.textContent).toBe("item");
	expect(container.querySelector("pre code")?.textContent).toContain(
		"general code",
	);
	expect(container.textContent).toContain("click");
	expect(container.querySelector("[onclick]")).toBeNull();
});

test("keeps long discussion content contained", () => {
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
	const firstDiscussion = discussions[0];
	const firstNote = firstDiscussion?.notes[0];
	if (!firstDiscussion || !firstNote)
		throw new Error("discussion fixture missing");
	const container = parseMarkup(
		renderMarkup({
			discussions: [
				{
					...firstDiscussion,
					notes: [{ ...firstNote, body }],
				},
			],
		}),
	);
	const list = container.querySelector<HTMLElement>("div");
	const card = container.querySelector<HTMLElement>(
		'[data-discussion-id="discussion-1"]',
	);
	const markdown = card?.querySelector<HTMLElement>(".comment-markdown");
	const tableWrap = markdown?.querySelector<HTMLElement>(
		".rendered-table-wrap",
	);

	expect(list?.className).toBe("min-w-0 max-w-full space-y-2");
	expect(card?.className).toContain("min-w-0");
	expect(card?.className).toContain("max-w-full");
	expect(card?.className).toContain("overflow-hidden");
	expect(markdown?.className).toContain("min-w-0");
	expect(markdown?.className).toContain("[overflow-wrap:anywhere]");
	expect(markdown?.querySelector("pre")).not.toBeNull();
	expect(tableWrap?.className).toContain("max-w-full");
	expect(container.textContent).toContain(longPath);
});
