import { PortError } from "../core/errors";
import type { GitHostProvider } from "../ports/git-host";

export interface MrRef {
	host: string;
	projectPath: string;
	iid: number;
}

function invalidUrl(url: string): PortError {
	return new PortError(`Invalid merge request URL: ${url}`);
}

function parseHttpUrl(input: string): URL {
	if (
		typeof input !== "string" ||
		input.trim() !== input ||
		input.length === 0
	) {
		throw invalidUrl(String(input));
	}

	let parsed: URL;
	try {
		parsed = new URL(input);
	} catch {
		throw invalidUrl(input);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw invalidUrl(input);
	}

	return parsed;
}

/** Parse a GitLab merge-request URL into its host, project path, and IID. */
export function parseMrUrl(input: string): MrRef {
	const parsed = parseHttpUrl(input);

	const marker = "/-/merge_requests/";
	const markerIndex = parsed.pathname.indexOf(marker);
	if (markerIndex <= 0) throw invalidUrl(input);

	const rawProjectPath = parsed.pathname
		.slice(1, markerIndex)
		.replace(/\/$/, "");
	const rawIidPath = parsed.pathname.slice(markerIndex + marker.length);
	const iidMatch = rawIidPath.match(/^([^/]+)/);
	if (!iidMatch?.[1] || !/^[1-9][0-9]*$/.test(iidMatch[1])) {
		throw invalidUrl(input);
	}

	let projectPath: string;
	try {
		projectPath = decodeURIComponent(rawProjectPath);
	} catch {
		throw invalidUrl(input);
	}
	if (
		projectPath.length === 0 ||
		projectPath.startsWith("/") ||
		projectPath.endsWith("/") ||
		projectPath.split("/").some((segment) => segment.length === 0)
	) {
		throw invalidUrl(input);
	}

	const iid = Number(iidMatch[1]);
	if (!Number.isSafeInteger(iid) || iid <= 0) throw invalidUrl(input);

	return { host: parsed.host, projectPath, iid };
}

/** Parse a GitHub pull-request URL into its host, project path, and IID. */
export function parsePullRequestUrl(input: string): MrRef {
	const parsed = parseHttpUrl(input);

	let segments: string[];
	try {
		segments = parsed.pathname
			.split("/")
			.slice(1)
			.map((segment) => decodeURIComponent(segment));
	} catch {
		throw invalidUrl(input);
	}

	const iidSegment = segments[3];
	if (
		segments.length < 4 ||
		!segments[0] ||
		!segments[1] ||
		segments[2] !== "pull" ||
		typeof iidSegment !== "string" ||
		!/^[1-9][0-9]*$/.test(iidSegment)
	) {
		throw invalidUrl(input);
	}

	const iid = Number(iidSegment);
	if (!Number.isSafeInteger(iid)) throw invalidUrl(input);

	return {
		host: parsed.host,
		projectPath: `${segments[0]}/${segments[1]}`,
		iid,
	};
}

export function parseReviewUrl(input: string): {
	provider: GitHostProvider;
	ref: MrRef;
} {
	let isGitLabMr = false;
	if (typeof input === "string") {
		try {
			isGitLabMr = new URL(input).pathname.includes("/-/merge_requests/");
		} catch {
			// Let the provider-specific parser report the established URL error.
		}
	}

	if (isGitLabMr) {
		return { provider: "gitlab", ref: parseMrUrl(input) };
	}

	return { provider: "github", ref: parsePullRequestUrl(input) };
}

export function encodeProjectPath(projectPath: string): string {
	return encodeURIComponent(projectPath);
}
