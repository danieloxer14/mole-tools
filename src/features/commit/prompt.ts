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
	context?: string,
): string {
	const sections = [system];
	if (context) {
		sections.push(`Additional user context:\n${context}`);
	}
	if (issue) {
		sections.push(
			`Here is the work item details:\nTicket ${issue.key}: ${issue.summary}\n${issue.description}`,
		);
	}
	sections.push(`Here is the changelog:\n${renderDiff(diff)}`);
	return sections.join("\n\n");
}
