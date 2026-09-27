import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VIDEO_EXTENSIONS } from "../description-media";
import {
	MarkdownDocument,
	type MarkdownRenderPolicy,
} from "./MarkdownDocument";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const uploadSecret = "0123456789abcdef0123456789abcdef";
const mediaToken = "review-local-token";
const localMedia = (filename: string) =>
	`/api/description-media/${uploadSecret}/${filename}?t=${mediaToken}`;
const DESCRIPTION_POLICY: MarkdownRenderPolicy = {
	kind: "description",
	projectWebUrl: "https://gitlab.example.com/group/api",
	mediaToken,
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
		`<img src="/uploads/${uploadSecret}/a.png" width="325">`,
		`![i](/uploads/${uploadSecret}/i.png)`,
		...VIDEO_EXTENSIONS.map(
			(extension) => `![v](/uploads/${uploadSecret}/v.${extension})`,
		),
		`<video><source src="/uploads/${uploadSecret}/b.webm"></video>`,
		"<script>alert('unsafe')</script>",
		'<iframe src="https://example.com/embed"></iframe>',
	].join("\n\n");
	const { container, root } = mountMarkdown(source, DESCRIPTION_POLICY);
	try {
		const rawImage = container.querySelector<HTMLImageElement>(
			`img[src="${localMedia("a.png")}"]`,
		);
		expect(rawImage).not.toBeNull();
		expect(rawImage?.getAttribute("width")).toBe("325");

		const markdownImage = container.querySelector<HTMLImageElement>(
			`img[src="${localMedia("i.png")}"]`,
		);
		expect(markdownImage).not.toBeNull();
		for (const extension of VIDEO_EXTENSIONS) {
			const video = container.querySelector<HTMLVideoElement>(
				`video[src="${localMedia(`v.${extension}`)}"]`,
			);
			expect(video).not.toBeNull();
			expect(video?.hasAttribute("controls")).toBe(true);
		}

		const rawVideo = container.querySelector("video:not([src])");
		const rawSource = rawVideo?.querySelector("source");
		expect(rawVideo).not.toBeNull();
		expect(rawSource?.getAttribute("src")).toBe(localMedia("b.webm"));
		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("iframe")).toBeNull();
	} finally {
		unmountMarkdown(root, container);
	}
});

test("applies GitLab dimensions to video Markdown and keeps tag source intact", () => {
	const source = [
		`![clip](/uploads/${uploadSecret}/clip.webm){width=900 height=507}`,
		"",
		`![poster](/uploads/${uploadSecret}/poster.png){width=900 height=507}`,
		"",
		`![invalid](/uploads/${uploadSecret}/invalid.webm){width=auto height=507}`,
	].join("\n");
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
		const video = container.querySelector<HTMLVideoElement>(
			`video[src="${localMedia("clip.webm")}"]`,
		);
		const blocks = container.querySelectorAll(".markdown-block");
		const videoBlock = blocks[0];
		const imageBlock = blocks[1];
		const invalidVideoBlock = blocks[2];
		expect(blocks).toHaveLength(3);

		expect(video?.getAttribute("width")).toBe("900");
		expect(video?.getAttribute("height")).toBe("507");
		expect(videoBlock?.textContent).not.toContain("{width=900 height=507}");
		expect(imageBlock?.textContent).toContain("{width=900 height=507}");
		expect(invalidVideoBlock?.textContent).toContain("{width=auto height=507}");

		const tagButton = videoBlock?.querySelector<HTMLButtonElement>(
			".markdown-block-tag",
		);
		if (!tagButton) throw new Error("video Markdown tag action missing");
		act(() =>
			tagButton.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		expect(tagged).toEqual({
			startLine: 1,
			endLine: 1,
			quote: `![clip](/uploads/${uploadSecret}/clip.webm){width=900 height=507}`,
		});
	} finally {
		unmountMarkdown(root, container);
	}
});

test("description Markdown does not use code-file left padding", () => {
	const { container, root } = mountMarkdown("Description", DESCRIPTION_POLICY);
	try {
		expect(
			container.querySelector(".rendered-markdown")?.classList.contains("pl-4"),
		).toBe(false);
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

test("file policy escapes raw HTML and keeps code-file left padding", () => {
	const source = '<img src="/uploads/file.png" width="325">';
	const filePolicy: MarkdownRenderPolicy = { kind: "file" };
	const { container, root } = mountMarkdown(source, filePolicy, true);
	try {
		expect(container.querySelector(".rendered-markdown img")).toBeNull();
		expect(
			container.querySelector(".rendered-markdown")?.classList.contains("pl-4"),
		).toBe(true);
		expect(
			container.querySelector(".rendered-markdown")?.textContent,
		).toContain(source);
	} finally {
		unmountMarkdown(root, container);
	}
});
