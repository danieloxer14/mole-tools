import type { Issue } from "../../ports/issue-tracker";
import type { FileDiff } from "../../ports/vcs";

function renderDiff(files: FileDiff[]): string {
	return files
		.map((f) =>
			f.statOnly
				? `${f.path} (+${f.insertions}/-${f.deletions})`
				: `${f.path}\n${f.patch}`,
		)
		.join("\n\n");
}

export function buildCommitPrompt(
	system: string,
	issue: Issue | null,
	diff: FileDiff[],
): string {
	const sections = [system];
	if (issue) {
		sections.push(
			`Ticket ${issue.key}: ${issue.summary}\n${issue.description}`,
		);
	}
	sections.push(`Diff:\n${renderDiff(diff)}`);
	return sections.join("\n\n");
}
