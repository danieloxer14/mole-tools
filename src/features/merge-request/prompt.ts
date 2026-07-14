import type { Issue } from "../../ports/issue-tracker";
import type { FileDiff } from "../../ports/vcs";

export interface MergeRequestPromptInput {
	system: string;
	issue?: Issue | null;
	commits: string[];
	diff: FileDiff[];
}

function renderDiff(files: FileDiff[]): string {
	return files
		.map((file) =>
			file.statOnly
				? `${file.path} (+${file.insertions}/-${file.deletions})`
				: `${file.path}\n${file.patch ?? ""}`,
		)
		.join("\n\n");
}

/** Build the complete context sent to the MR model. */
export function buildMergeRequestPrompt(
	input: MergeRequestPromptInput,
): string {
	const sections = [input.system];
	if (input.issue) {
		sections.push(
			`Here are the Jira work item details:\nTicket ${input.issue.key}: ${input.issue.summary}\n${input.issue.description}`,
		);
	}
	sections.push(
		`Here are the commits on this branch:\n${input.commits.length ? input.commits.join("\n") : "(none)"}`,
	);
	sections.push(`Here is the merge-base diff:\n${renderDiff(input.diff)}`);
	sections.push(
		"Respond with a first-line title in Conventional Commits format, followed by a blank line and a free-form Markdown description.",
	);
	return sections.join("\n\n");
}

// Short alias kept for feature code and callers that use the product name.
export const buildMrPrompt = buildMergeRequestPrompt;

export interface ParsedMergeRequest {
	title: string;
	body: string;
}

/**
 * Parse the model's title/body contract. A missing `Title:` marker is valid:
 * the first non-empty line is the title and everything after it is the body.
 */
export function parseMergeRequestOutput(output: string): ParsedMergeRequest {
	const lines = output.trim().split("\n");
	let title = (lines.shift() ?? "").trim();
	if (/^title\s*:/i.test(title))
		title = title.replace(/^title\s*:\s*/i, "").trim();
	if (lines[0]?.trim() === "") lines.shift();
	return {
		title: title.replace(/[\r\n]+/g, " ").trim(),
		body: lines.join("\n").trim(),
	};
}

export const parseMrOutput = parseMergeRequestOutput;
