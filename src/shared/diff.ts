import type { FileDiff } from "../ports/vcs";

export function filterDiff(
	files: FileDiff[],
	ignoreGlobs: string[],
): FileDiff[] {
	const globs = ignoreGlobs.map((g) => new Bun.Glob(g));
	return files.map((file) => {
		const ignored = globs.some((glob) => glob.match(file.path));
		if (!ignored) return file;
		return { ...file, statOnly: true, patch: null };
	});
}
