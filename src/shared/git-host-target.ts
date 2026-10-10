import type { GitHostProvider, GitHostTarget } from "../ports/git-host";
import type { MrRef } from "./mr-url";

function remoteHost(remote: string | null): string | null {
	const value = remote?.trim();
	if (!value) return null;

	if (value.includes("://")) {
		try {
			return new URL(value).hostname.toLowerCase() || null;
		} catch {
			return null;
		}
	}

	const match = /^(?:[^@\s/]+@)?([^:\s/]+):/.exec(value);
	return match?.[1]?.toLowerCase() ?? null;
}

export function gitHostTargetForRemote(remote: string | null): GitHostTarget {
	return remoteHost(remote) === "github.com"
		? { provider: "github", host: "github.com" }
		: { provider: "gitlab" };
}

export function gitHostTargetForReview(
	provider: GitHostProvider,
	ref: MrRef,
): GitHostTarget {
	return provider === "github"
		? { provider, host: ref.host }
		: { provider: "gitlab" };
}
