import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HostDiscussion } from "../../../../ports/git-host";
import { ChatTagSchema, type DescriptionChatTag } from "../../chat-tags";
import { OverviewPane, type OverviewPaneProps } from "./OverviewPane";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const projectWebUrl = "https://gitlab.example.com/group/project";
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
