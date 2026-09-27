import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VIDEO_EXTENSIONS } from "../description-media";
import {
	MarkdownDocument,
	type MarkdownRenderPolicy,
} from "./MarkdownDocument";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DESCRIPTION_POLICY: MarkdownRenderPolicy = {
	kind: "description",
	projectWebUrl: "https://gitlab.example.com/group/api",
};

function mountMarkdown(
	source: string,
	policy: MarkdownRenderPolicy,
	commentable = false,
	onTagBlock?: (range: {
		startLine: number;
		endLine: number;
		quote: string;
	}) => void,
): { container: HTMLDivElement; root: Root } {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => {
		root.render(
			<MarkdownDocument
				source={source}
				policy={policy}
				commentable={commentable}
				onTagBlock={onTagBlock}
			/>,
		);
	});
	return { container, root };
}

function unmountMarkdown(root: Root, container: HTMLDivElement): void {
	act(() => root.unmount());
	container.remove();
}

test("renders and resolves description images, videos, and safe raw media", () => {
	const source = [
		'<img src="/uploads/a.png" width="325">',
		"![i](/uploads/i.png)",
		...VIDEO_EXTENSIONS.map((extension) => `![v](/uploads/v.${extension})`),
		'<video><source src="/uploads/b.webm"></video>',
		"<script>alert('unsafe')</script>",
		'<iframe src="https://example.com/embed"></iframe>',
	].join("\n\n");
	const { container, root } = mountMarkdown(source, DESCRIPTION_POLICY);
	try {
		const rawImage = container.querySelector<HTMLImageElement>(
			'img[src="https://gitlab.example.com/group/api/uploads/a.png"]',
		);
		expect(rawImage).not.toBeNull();
		expect(rawImage?.getAttribute("width")).toBe("325");

		const markdownImage = container.querySelector<HTMLImageElement>(
			'img[src="https://gitlab.example.com/group/api/uploads/i.png"]',
		);
		expect(markdownImage).not.toBeNull();
		for (const extension of VIDEO_EXTENSIONS) {
			const video = container.querySelector<HTMLVideoElement>(
				`video[src="https://gitlab.example.com/group/api/uploads/v.${extension}"]`,
			);
			expect(video).not.toBeNull();
			expect(video?.hasAttribute("controls")).toBe(true);
		}

		const rawVideo = container.querySelector("video:not([src])");
		const rawSource = rawVideo?.querySelector("source");
		expect(rawVideo).not.toBeNull();
		expect(rawSource?.getAttribute("src")).toBe(
			"https://gitlab.example.com/group/api/uploads/b.webm",
		);
		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("iframe")).toBeNull();
	} finally {
		unmountMarkdown(root, container);
	}
});

test("description blocks omit Comment and tag source range on Enter", () => {
	const source = "# First block\n\nSecond block";
	let tagged: { startLine: number; endLine: number; quote: string } | undefined;
	const { container, root } = mountMarkdown(
		source,
		DESCRIPTION_POLICY,
		false,
		(range) => {
			tagged = range;
		},
	);
	try {
		expect(container.querySelectorAll(".markdown-block-comment")).toHaveLength(
			0,
		);
		const tags = container.querySelectorAll<HTMLButtonElement>(
			".markdown-block-tag",
		);
		expect(tags).toHaveLength(2);
		const secondTag = tags[1];
		expect(secondTag).toBeDefined();
		if (!secondTag) throw new Error("second Markdown block tag missing");

		act(() => {
			secondTag.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(tagged).toEqual({
			startLine: 3,
			endLine: 3,
			quote: "Second block",
		});
	} finally {
		unmountMarkdown(root, container);
	}
});

test("file policy escapes raw HTML instead of rendering it", () => {
	const source = '<img src="/uploads/file.png" width="325">';
	const filePolicy: MarkdownRenderPolicy = { kind: "file" };
	const { container, root } = mountMarkdown(source, filePolicy, true);
	try {
		expect(container.querySelector(".rendered-markdown img")).toBeNull();
		expect(
			container.querySelector(".rendered-markdown")?.textContent,
		).toContain(source);
	} finally {
		unmountMarkdown(root, container);
	}
});
