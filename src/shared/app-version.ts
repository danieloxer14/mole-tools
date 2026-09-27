import packageJson from "../../package.json";

export const APP_VERSION: string = packageJson.version;

export function parseVersion(value: string): [number, number, number] | null {
	const normalized = value.replace(/^v/, "");
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized);

	if (!match) {
		return null;
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(candidate: string, installed: string): boolean {
	const candidateVersion = parseVersion(candidate);
	const installedVersion = parseVersion(installed);

	if (!candidateVersion || !installedVersion) {
		return false;
	}

	for (let index = 0; index < candidateVersion.length; index += 1) {
		if (candidateVersion[index] > installedVersion[index]) {
			return true;
		}

		if (candidateVersion[index] < installedVersion[index]) {
			return false;
		}
	}

	return false;
}
