import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HostDiscussion } from "../../../../ports/git-host";
import { ChatTagSchema, type DescriptionChatTag } from "../../chat-tags";
import type { Draft } from "../../state";
import type { FromChatContext } from "../from-chat";
import { OverviewPane, type OverviewPaneProps } from "./OverviewPane";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const projectWebUrl = "https://gitlab.example.com/group/project";
const mediaToken = "review-local-token";
const discussions: HostDiscussion[] = [
	{
		id: "general-discussion-1",
		resolved: false,
		position: null,
		notes: [
			{
				id: "note-1",
				author: "reviewer",
				body: "Please clarify this part.",
				createdAt: "2026-08-24T00:00:00Z",
				system: false,
			},
		],
	},
];
const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.replaceChildren();
});

function mountOverview(props: Partial<OverviewPaneProps> = {}): {
	container: HTMLDivElement;
} {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<OverviewPane
				description="A merge request description."
				projectWebUrl={projectWebUrl}
				mediaToken={mediaToken}
				discussions={[]}
				onTagDescription={() => {}}
				{...props}
			/>,
		),
	);
	return { container };
}

test("shows Description before General discussion", () => {
	const { container } = mountOverview();
	const headings = [...container.querySelectorAll("h2")].map((heading) =>
		heading.textContent?.trim(),
	);

	expect(headings).toEqual(["Description", "General discussion"]);
	expect(container.querySelector('[aria-label="Overview"]')).not.toBeNull();
	expect(container.textContent).toContain("A merge request description.");
});

test("uses available width for Overview and description Markdown", () => {
	const { container } = mountOverview();
	const overview = container.querySelector('[aria-label="Overview"]');
	const content = overview?.querySelector(
		"[data-overview-scroll]",
	)?.firstElementChild;
	const markdown = overview?.querySelector(".overview-markdown");

	expect(content?.className).toContain("w-full");
	expect(content?.className).not.toContain("max-w-4xl");
	expect(markdown?.className).toContain("overview-markdown");
});

test("uses larger section headers and a right-aligned Tag file action", () => {
	const { container } = mountOverview();
	const descriptionHeading = container.querySelector("#description-heading");
	const discussionHeading = container.querySelector(
		"#general-discussion-heading",
	);
	const tagButton = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Tag whole description"]',
	);

	expect(descriptionHeading?.className).toContain("text-xl");
	expect(discussionHeading?.className).toContain("text-xl");
	expect(tagButton?.textContent?.trim()).toBe("Tag file");
	expect(tagButton?.parentElement?.className).toContain("justify-between");
});

test("tags the whole description as a validated chat tag", () => {
	const description = "Complete merge request description.";
	let tagged: DescriptionChatTag | undefined;
	const { container } = mountOverview({
		description,
		onTagDescription: (tag) => {
			tagged = tag;
		},
	});
	const button = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Tag whole description"]',
	);

	act(() => button?.click());

	expect(ChatTagSchema.parse(tagged)).toEqual({
		kind: "description",
		quote: description,
	});
});

test("tags Markdown block ranges and has no inline comment action", () => {
	let tagged: DescriptionChatTag | undefined;
	const { container } = mountOverview({
		description: "# First block\n\nSecond block",
		onTagDescription: (tag) => {
			tagged = tag;
		},
	});
	const tagButtons = container.querySelectorAll<HTMLButtonElement>(
		".markdown-block-tag",
	);
	const secondBlockTag = tagButtons[1];

	expect(tagButtons).toHaveLength(2);
	expect(container.querySelectorAll(".markdown-block-comment")).toHaveLength(0);
	if (!secondBlockTag) throw new Error("second Markdown block tag missing");
	act(() =>
		secondBlockTag.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		),
	);

	expect(ChatTagSchema.parse(tagged)).toEqual({
		kind: "description",
		startLine: 3,
		endLine: 3,
		quote: "Second block",
	});
});

test("shows empty states for a blank description and no discussions", () => {
	const { container } = mountOverview({
		description: " \n\t",
		discussions: [],
	});
	const discussionHeading = container.querySelector<HTMLHeadingElement>(
		"#general-discussion-heading",
	);

	expect(container.textContent).toContain("No description provided.");
	expect(
		container.querySelector('button[aria-label="Tag whole description"]'),
	).toBeNull();
	expect(container.textContent).toContain("No general discussion yet.");
	expect(
		discussionHeading?.parentElement?.querySelector("span")?.textContent,
	).toBe("0");
});

test("forwards Explain clicks with the general discussion id", () => {
	let explainedId = "";
	const { container } = mountOverview({
		discussions,
		onExplainDiscussion: (id) => {
			explainedId = id;
		},
	});
	const button = container.querySelector<HTMLButtonElement>(
		'button[data-action="explain"]',
	);

	act(() => button?.click());

	expect(explainedId).toBe("general-discussion-1");
});

function makeDraft(
	id: string,
	selection: Draft["selection"],
	filePath: string,
	overrides: Partial<Pick<Draft, "status" | "error">> = {},
): Draft {
	return {
		id,
		body: "Draft body",
		selection,
		filePath,
		status: "draft",
		error: null,
		postedDiscussionId: null,
		staleSince: null,
		...overrides,
	};
}

test("pins the labeled comment composer region outside the Overview scroll area", () => {
	let createCount = 0;
	const { container } = mountOverview({
		commentComposer: {
			onCreateGeneralComment: () => {
				createCount += 1;
			},
			onCancelDraft: () => {},
			onEditDraft: () => {},
			onSendDraft: () => {},
			onRetryDraft: () => {},
		},
	});
	const composer = container.querySelector(
		'section[aria-label="Merge request comment"]',
	);
	const createButton = composer?.querySelector("button");

	expect(composer).not.toBeNull();
	expect(
		container.querySelector("[data-overview-scroll]")?.contains(composer),
	).toBe(false);
	expect(composer?.textContent).toContain("Comment on this merge request…");
	expect(container.querySelector('[role="contentinfo"]')).toBeNull();

	act(() => createButton?.click());

	expect(createCount).toBe(1);
});

test("does not render the comment composer without its complete callback contract", () => {
	const { container } = mountOverview();

	expect(
		container.querySelector('section[aria-label="Merge request comment"]'),
	).toBeNull();
});

test("renders only unposted general drafts in the composer with its actions", () => {
	const fromChat: FromChatContext = {
		availability: { kind: "ready", chatLabel: "Review chat" },
		generations: {},
		onGenerate: () => {},
		onStop: () => {},
	};
	const drafts = [
		makeDraft("general-draft", { kind: "general" }, ""),
		makeDraft("posted-general-draft", { kind: "general" }, "", {
			status: "posted",
		}),
		makeDraft("file-draft", { kind: "file", path: "src/app.ts" }, "src/app.ts"),
		makeDraft(
			"line-draft",
			{ path: "src/app.ts", side: "new", startLine: 1, endLine: 1 },
			"src/app.ts",
		),
		makeDraft(
			"markdown-draft",
			{
				kind: "markdown",
				path: "README.md",
				startLine: 1,
				endLine: 1,
				quote: "Text",
			},
			"README.md",
		),
	];
	const { container } = mountOverview({
		drafts,
		fromChat,
		commentComposer: {
			onCreateGeneralComment: () => {},
			onCancelDraft: () => {},
			onEditDraft: () => {},
			onSendDraft: () => {},
			onRetryDraft: () => {},
		},
	});
	const composer = container.querySelector(
		'section[aria-label="Merge request comment"]',
	);
	const articles = composer?.querySelectorAll("article") ?? [];

	expect(
		[...articles].map((article) => article.getAttribute("data-draft-id")),
	).toEqual(["general-draft"]);
	expect(
		composer?.querySelector('[aria-label="Draft editor mode"]'),
	).not.toBeNull();
	expect(
		composer?.querySelector('button[aria-label="From chat"]'),
	).not.toBeNull();
	expect(composer?.textContent).toContain("Merge request");
	expect(composer?.textContent).not.toContain("Comment on this merge request…");
});

test("shows a failed general draft error and retries that draft", () => {
	const retriedIds: string[] = [];
	const { container } = mountOverview({
		drafts: [
			makeDraft("failed-general-draft", { kind: "general" }, "", {
				status: "failed",
				error: "glab unauthenticated",
			}),
		],
		commentComposer: {
			onCreateGeneralComment: () => {},
			onCancelDraft: () => {},
			onEditDraft: () => {},
			onSendDraft: () => {},
			onRetryDraft: (id) => retriedIds.push(id),
		},
	});
	const composer = container.querySelector(
		'section[aria-label="Merge request comment"]',
	);
	const retryButton = [...(composer?.querySelectorAll("button") ?? [])].find(
		(button) => button.textContent?.includes("Retry"),
	);

	expect(composer?.textContent).toContain("glab unauthenticated");
	expect(retryButton).not.toBeUndefined();

	act(() => retryButton?.click());

	expect(retriedIds).toEqual(["failed-general-draft"]);
});
