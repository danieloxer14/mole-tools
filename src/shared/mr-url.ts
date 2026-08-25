import { PortError } from "../core/errors";

export interface MrRef {
	host: string;
	projectPath: string;
	iid: number;
}

function invalidUrl(url: string): PortError {
	return new PortError(`Invalid merge request URL: ${url}`);
}

/** Parse a GitLab merge-request URL into its host, project path, and IID. */
export function parseMrUrl(input: string): MrRef {
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

export function encodeProjectPath(projectPath: string): string {
	return encodeURIComponent(projectPath);
}
