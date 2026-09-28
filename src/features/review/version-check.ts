import { logger } from "../../core/logger";
import {
	APP_VERSION,
	isNewerVersion,
	parseVersion,
} from "../../shared/app-version";
import { parseReleaseCatalog, type ReleaseNotes } from "./release-notes";

export const RELEASE_CATALOG_URL =
	"https://raw.githubusercontent.com/danieloxer14/mole-tools/main/releases.json";
export const VERSION_CHECK_TIMEOUT_MS = 5000;

export interface VersionStatus {
	current: string;
	latest: string | null;
	updateAvailable: boolean;
	releases: ReleaseNotes[];
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
		if (parseVersion(current) === null) {
			throw new Error("Installed version is invalid");
		}

		const response = await fetcher(RELEASE_CATALOG_URL, {
			headers: {
				"user-agent": `mole-tools/${current}`,
			},
			signal: AbortSignal.timeout(
				options.timeoutMs ?? VERSION_CHECK_TIMEOUT_MS,
			),
		});

		if (!response.ok) {
			throw new Error(`Release catalog request failed (${response.status})`);
		}

		const catalog = parseReleaseCatalog(await response.json());
		const latest = catalog[0];
		if (!latest) {
			throw new Error("Release catalog is empty");
		}
		const releases = catalog.filter((release) =>
			isNewerVersion(release.version, current),
		);

		return {
			current,
			latest: latest.version,
			updateAvailable: releases.length > 0,
			releases,
		};
	} catch (error) {
		logger.debug("review.version-check-failed", { error });
		return { current, latest: null, updateAvailable: false, releases: [] };
	}
}
