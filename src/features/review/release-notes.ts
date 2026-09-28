import { isNewerVersion, parseVersion } from "../../shared/app-version";

export interface ReleaseNotes {
	version: string;
	description: string;
	features: string[];
	improvements: string[];
	fixes: string[];
}

const RELEASE_KEYS = [
	"version",
	"description",
	"features",
	"improvements",
	"fixes",
] as const;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const MARKUP_PATTERN =
	/<[^>]*>|!?\[[^\]]*\]\([^)]*\)|(?:\*\*|__|~~|`)|(?:\*[^*\s][^*]*\*|(?:^|\s)_[^_\s][^_]*_)|(^|\s)(?:#{1,6}\s|>\s|[-*+]\s|\d+\.\s)/;

function isPlainText(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.trim() !== value ||
		MARKUP_PATTERN.test(value)
	) {
		return false;
	}
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 0x1f || code === 0x7f) return false;
	}
	return true;
}

export function parseReleaseCatalog(value: unknown): ReleaseNotes[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error("Release catalog must be a non-empty array");
	}

	const seen = new Set<string>();
	const releases = value.map((entry, index): ReleaseNotes => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			throw new Error(`Release ${index} must be an object`);
		}

		const keys = Object.keys(entry);
		if (
			keys.length !== RELEASE_KEYS.length ||
			RELEASE_KEYS.some((key) => !Object.hasOwn(entry, key))
		) {
			throw new Error(
				`Release ${index} must contain exactly the required fields`,
			);
		}

		const release = entry as Record<string, unknown>;
		if (
			typeof release.version !== "string" ||
			!VERSION_PATTERN.test(release.version) ||
			parseVersion(release.version) === null
		) {
			throw new Error(`Release ${index} has an invalid version`);
		}
		if (seen.has(release.version)) {
			throw new Error(
				`Release catalog contains duplicate version ${release.version}`,
			);
		}
		seen.add(release.version);

		if (!isPlainText(release.description)) {
			throw new Error(`Release ${index} has an invalid description`);
		}

		const categories = ["features", "improvements", "fixes"] as const;
		for (const category of categories) {
			if (
				!Array.isArray(release[category]) ||
				!release[category].every(isPlainText)
			) {
				throw new Error(`Release ${index} has invalid ${category}`);
			}
		}

		return {
			version: release.version,
			description: release.description,
			features: release.features as string[],
			improvements: release.improvements as string[],
			fixes: release.fixes as string[],
		};
	});

	for (let index = 1; index < releases.length; index += 1) {
		const previous = releases[index - 1];
		const current = releases[index];
		if (
			!previous ||
			!current ||
			!isNewerVersion(previous.version, current.version)
		) {
			throw new Error("Release catalog must be strictly descending");
		}
	}

	return releases;
}
