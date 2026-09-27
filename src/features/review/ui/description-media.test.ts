import { expect, test } from "bun:test";
import {
	finalizeDescriptionHtml,
	isVideoUrl,
	projectWebUrl,
	resolveDescriptionUrl,
	VIDEO_EXTENSIONS,
} from "./description-media";

const mediaToken = "review-local-token";
const projectUrl = "https://gitlab.example.com/group/api";
const uploadSecret = "0123456789abcdef0123456789abcdef";

test("builds the project web URL from the merge request origin and project path", () => {
	expect(
		projectWebUrl({
			webUrl: "https://gitlab.example.com/group/api/-/merge_requests/42",
			projectPath: "group/api",
		}),
	).toBe(projectUrl);
});

test("preserves GitLab deployment prefix in project web URL", () => {
	expect(
		projectWebUrl({
			webUrl: "https://gitlab.com/gitlab/group/api/-/merge_requests/42",
			projectPath: "group/api",
		}),
	).toBe("https://gitlab.com/gitlab/group/api");
});

test("resolves relative description URLs against the GitLab project", () => {
	expect(resolveDescriptionUrl("/uploads/a.png", projectUrl)).toBe(
		"https://gitlab.example.com/group/api/uploads/a.png",
	);
	expect(resolveDescriptionUrl("/-/project/7/uploads/x.mp4", projectUrl)).toBe(
		"https://gitlab.example.com/-/project/7/uploads/x.mp4",
	);
	expect(resolveDescriptionUrl("docs/a.md", projectUrl)).toBe(
		"https://gitlab.example.com/group/api/docs/a.md",
	);
});

test("leaves empty, absolute, protocol-relative, fragment, and mailto URLs unchanged", () => {
	for (const url of [
		"",
		"   ",
		"https://elsewhere.example/a.png",
		"//cdn.example/a.png",
		"#section",
		"mailto:team@example.com",
	]) {
		expect(resolveDescriptionUrl(url, projectUrl)).toBe(url);
	}
});

test("detects supported video extensions case-insensitively before query or hash", () => {
	expect(VIDEO_EXTENSIONS).toEqual(["mp4", "m4v", "mov", "webm", "ogv"]);

	for (const extension of VIDEO_EXTENSIONS) {
		expect(isVideoUrl(`x.${extension}`)).toBe(true);
		expect(isVideoUrl(`x.${extension.toUpperCase()}`)).toBe(true);
		expect(isVideoUrl(`x.${extension}?a=1`)).toBe(true);
		expect(isVideoUrl(`x.${extension}#t`)).toBe(true);
	}
});

test("rejects unsupported and non-terminal video extensions", () => {
	for (const url of [
		"x.png",
		"x.mp4.png",
		"x.mp3",
		"x.webmx",
		"mp4",
		"x.ogg",
	]) {
		expect(isVideoUrl(url)).toBe(false);
	}
});

test("finalizes description media and external links", () => {
	const html = finalizeDescriptionHtml(
		'<img src="/uploads/a.png"><video src="media/v.mp4" poster="/uploads/poster.jpg"></video><source src="/uploads/b.webm"><a href="docs/a.md">relative</a><a href="https://elsewhere.example/page">external</a><a href="mailto:team@example.com">email</a>',
		projectUrl,
		mediaToken,
	);
	const template = document.createElement("template");
	template.innerHTML = html;

	expect(template.content.querySelector("img")?.getAttribute("src")).toBe(
		"https://gitlab.example.com/group/api/uploads/a.png",
	);
	expect(template.content.querySelector("video")?.getAttribute("src")).toBe(
		"https://gitlab.example.com/group/api/media/v.mp4",
	);
	expect(template.content.querySelector("video")?.getAttribute("poster")).toBe(
		"https://gitlab.example.com/group/api/uploads/poster.jpg",
	);
	expect(template.content.querySelector("source")?.getAttribute("src")).toBe(
		"https://gitlab.example.com/group/api/uploads/b.webm",
	);

	const relativeLink = template.content.querySelector('a[href$="docs/a.md"]');
	expect(relativeLink?.getAttribute("href")).toBe(
		"https://gitlab.example.com/group/api/docs/a.md",
	);
	expect(relativeLink?.getAttribute("target")).toBe("_blank");
	expect(relativeLink?.getAttribute("rel")).toBe("noopener noreferrer");

	const externalLink = template.content.querySelector(
		'a[href="https://elsewhere.example/page"]',
	);
	expect(externalLink?.getAttribute("target")).toBe("_blank");
	expect(externalLink?.getAttribute("rel")).toBe("noopener noreferrer");

	const mailtoLink = template.content.querySelector('a[href^="mailto:"]');
	expect(mailtoLink?.getAttribute("href")).toBe("mailto:team@example.com");
	expect(mailtoLink?.hasAttribute("target")).toBe(false);
	expect(mailtoLink?.hasAttribute("rel")).toBe(false);
});

test("rewrites only project GitLab upload media to tokenized local URLs", () => {
	const html = finalizeDescriptionHtml(
		`<img src="/uploads/${uploadSecret}/clip%20one.png"><video poster="https://gitlab.example.com/group/api/uploads/${uploadSecret}/poster.png"></video><source src="https://gitlab.example.com/group/other/uploads/${uploadSecret}/other.webm"><img src="https://elsewhere.example/uploads/${uploadSecret}/external.png"><img src="/uploads/not-a-secret/file.mp4"><a href="/uploads/${uploadSecret}/linked.png">direct link</a>`,
		projectUrl,
		mediaToken,
	);
	const template = document.createElement("template");
	template.innerHTML = html;

	expect(template.content.querySelector("img")?.getAttribute("src")).toBe(
		`/api/description-media/${uploadSecret}/clip%20one.png?t=${mediaToken}`,
	);
	expect(template.content.querySelector("video")?.getAttribute("poster")).toBe(
		`/api/description-media/${uploadSecret}/poster.png?t=${mediaToken}`,
	);
	expect(template.content.querySelector("source")?.getAttribute("src")).toBe(
		`https://gitlab.example.com/group/other/uploads/${uploadSecret}/other.webm`,
	);
	expect(template.content.querySelectorAll("img")[1]?.getAttribute("src")).toBe(
		`https://elsewhere.example/uploads/${uploadSecret}/external.png`,
	);
	expect(template.content.querySelectorAll("img")[2]?.getAttribute("src")).toBe(
		"https://gitlab.example.com/group/api/uploads/not-a-secret/file.mp4",
	);
	expect(template.content.querySelector("a")?.getAttribute("href")).toBe(
		`https://gitlab.example.com/group/api/uploads/${uploadSecret}/linked.png`,
	);
});
