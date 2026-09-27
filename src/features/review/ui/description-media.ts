export function projectWebUrl(mr: {
	webUrl: string;
	projectPath: string;
}): string {
	const webUrl = new URL(mr.webUrl);
	const encodedProjectPath = mr.projectPath
		.split("/")
		.map(encodeURIComponent)
		.join("/");
	const mergeRequestRoute = `${encodedProjectPath}/-/merge_requests/`;
	const routeIndex = webUrl.pathname.lastIndexOf(mergeRequestRoute);

	if (routeIndex !== -1) {
		return `${webUrl.origin}${webUrl.pathname.slice(0, routeIndex + encodedProjectPath.length)}`;
	}

	return `${webUrl.origin}/${mr.projectPath}`;
}

export function resolveDescriptionUrl(url: string, projectUrl: string): string {
	if (url.trim() === "") return url;
	if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
	if (url.startsWith("//") || url.startsWith("#")) return url;
	if (url.startsWith("/uploads/")) return projectUrl + url;
	if (url.startsWith("/")) return new URL(projectUrl).origin + url;
	return new URL(url, `${projectUrl}/`).href;
}

export const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "ogv"] as const;

export function isVideoUrl(url: string): boolean {
	const queryOrHash = url.search(/[?#]/);
	const path = queryOrHash === -1 ? url : url.slice(0, queryOrHash);
	const dot = path.lastIndexOf(".");
	if (dot === -1) return false;

	const extension = path.slice(dot + 1).toLowerCase();
	return (VIDEO_EXTENSIONS as readonly string[]).includes(extension);
}

export function finalizeDescriptionHtml(
	html: string,
	projectUrl: string,
): string {
	const template = document.createElement("template");
	template.innerHTML = html;

	const urlAttributes = [
		["img[src]", "src"],
		["video[src]", "src"],
		["video[poster]", "poster"],
		["source[src]", "src"],
		["a[href]", "href"],
	] as const;

	for (const [selector, attribute] of urlAttributes) {
		for (const element of template.content.querySelectorAll(selector)) {
			const value = element.getAttribute(attribute);
			if (value === null) continue;

			const resolvedUrl = resolveDescriptionUrl(value, projectUrl);
			element.setAttribute(attribute, resolvedUrl);
			if (
				selector === "a[href]" &&
				(resolvedUrl.startsWith("http:") || resolvedUrl.startsWith("https:"))
			) {
				element.setAttribute("target", "_blank");
				element.setAttribute("rel", "noopener noreferrer");
			}
		}
	}

	return template.innerHTML;
}
