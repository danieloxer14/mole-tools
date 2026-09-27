import { logger } from "../../core/logger";
import {
	APP_VERSION,
	isNewerVersion,
	parseVersion,
} from "../../shared/app-version";

export const LATEST_RELEASE_URL =
	"https://api.github.com/repos/danieloxer14/mole-tools/releases/latest";
export const VERSION_CHECK_TIMEOUT_MS = 5000;

export interface VersionStatus {
	current: string;
	latest: string | null;
	updateAvailable: boolean;
}

export interface CheckForUpdateOptions {
	current?: string;
	fetcher?: typeof fetch;
	timeoutMs?: number;
}

export async function checkForUpdate(
	options: CheckForUpdateOptions = {},
): Promise<VersionStatus> {
	const current = options.current ?? APP_VERSION;
	const fetcher = options.fetcher ?? globalThis.fetch;

	try {
		const response = await fetcher(LATEST_RELEASE_URL, {
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": `mole-tools/${current}`,
			},
			signal: AbortSignal.timeout(
				options.timeoutMs ?? VERSION_CHECK_TIMEOUT_MS,
			),
		});

		if (!response.ok) {
			throw new Error(`Release lookup failed (${response.status})`);
		}

		const body: unknown = await response.json();
		if (
			typeof body !== "object" ||
			body === null ||
			!("tag_name" in body) ||
			typeof body.tag_name !== "string" ||
			parseVersion(body.tag_name) === null
		) {
			throw new Error("Release lookup returned an invalid tag_name");
		}

		const latest = body.tag_name.replace(/^v/, "");
		return {
			current,
			latest,
			updateAvailable: isNewerVersion(latest, current),
		};
	} catch (error) {
		logger.debug("review.version-check-failed", { error });
		return { current, latest: null, updateAvailable: false };
	}
}
