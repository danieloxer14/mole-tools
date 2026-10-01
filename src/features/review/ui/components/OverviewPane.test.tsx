import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HostDiscussion } from "../../../../ports/git-host";
import {
	ChatTagSchema,
	type DescriptionChatTag,
	type OnePagerChatTag,
	OnePagerChatTagSchema,
} from "../../chat-tags";
import type { OnePagerView } from "../use-one-pager";
import {
	OverviewPane,
	type OverviewPaneProps,
	type OverviewTab,
} from "./OverviewPane";

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
	const content = overview?.firstElementChild;
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

test("keeps the legacy Overview markup when one pager is not supplied", () => {
	const { container } = mountOverview();

	expect(container.querySelector("h2#description-heading")?.textContent).toBe(
		"Description",
	);
	expect(container.textContent).toContain("Tag file");
	expect(container.textContent).toContain("General discussion");
	expect(
		container.querySelector('[aria-label="Overview sections"]'),
	).toBeNull();
});

const readyOnePagerView: OnePagerView = {
	status: "ready",
	markdown: "# Summary\n\nSecond one-pager block",
	error: null,
};

function onePagerProps(
	tab: OverviewTab,
	view: OnePagerView = readyOnePagerView,
	overrides: Partial<NonNullable<OverviewPaneProps["onePager"]>> = {},
): NonNullable<OverviewPaneProps["onePager"]> {
	return {
		tab,
		onTabChange: () => {},
		view,
		onCreate: () => {},
		onRegenerate: () => {},
		onTagOnePager: () => {},
		...overrides,
	};
}

test("shows Overview section tabs and keeps description actions and discussion together", () => {
	const { container } = mountOverview({
		discussions,
		onePager: onePagerProps("description"),
	});
	const sectionTabs = container.querySelector(
		'[aria-label="Overview sections"]',
	);

	expect(sectionTabs?.textContent).toContain("MR Description");
	expect(sectionTabs?.textContent).toContain("One pager");
	expect(container.querySelector("h2#description-heading")).toBeNull();
	expect(
		container.querySelector('button[aria-label="Tag whole description"]')
			?.textContent,
	).toContain("Tag file");
	expect(
		container.querySelector("#general-discussion-heading")?.textContent,
	).toBe("General discussion");
	expect(
		container.querySelector('[aria-label="Overview"]')?.textContent,
	).toContain("A merge request description.");
});

test("reports selected Overview tab changes", () => {
	let selectedTab: OverviewTab | undefined;
	const { container } = mountOverview({
		onePager: onePagerProps("description", readyOnePagerView, {
			onTabChange: (tab) => {
				selectedTab = tab;
			},
		}),
	});
	const onePagerTab = [
		...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
	].find((tab) => tab.textContent?.trim() === "One pager");

	act(() => onePagerTab?.click());

	expect(selectedTab).toBe("one-pager");
});

test("regenerates a ready one pager from its secondary action", () => {
	let regenerated = 0;
	const { container } = mountOverview({
		onePager: onePagerProps("one-pager", readyOnePagerView, {
			onRegenerate: () => {
				regenerated += 1;
			},
		}),
	});
	const button = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Regenerate one pager"]',
	);

	expect(button?.textContent?.trim()).toBe("Regenerate");
	act(() => button?.click());
	expect(regenerated).toBe(1);
});

test("does not offer regeneration when one pager is not ready", () => {
	for (const status of ["idle", "running"] as const) {
		const { container } = mountOverview({
			onePager: onePagerProps("one-pager", {
				status,
				markdown: null,
				error: null,
			}),
		});

		expect(
			container.querySelector('button[aria-label="Regenerate one pager"]'),
		).toBeNull();
		act(() => roots.at(-1)?.unmount());
		roots.pop();
	}
});

test("tags one-pager Markdown blocks as validated one-pager chat tags", () => {
	let tagged: OnePagerChatTag | undefined;
	const { container } = mountOverview({
		onePager: onePagerProps("one-pager", readyOnePagerView, {
			onTagOnePager: (tag) => {
				tagged = tag;
			},
		}),
	});
	const secondBlockTag = container.querySelectorAll<HTMLButtonElement>(
		".markdown-block-tag",
	)[1];

	if (!secondBlockTag) throw new Error("second one-pager Markdown tag missing");
	act(() =>
		secondBlockTag.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		),
	);

	expect(OnePagerChatTagSchema.parse(tagged)).toEqual({
		kind: "one-pager",
		startLine: 3,
		endLine: 3,
		quote: "Second one-pager block",
	});
});
