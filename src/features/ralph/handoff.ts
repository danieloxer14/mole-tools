export const RALPH_ITERATION_SUMMARY_START = "RALPH_ITERATION_SUMMARY";
export const RALPH_ITERATION_SUMMARY_END = "END_RALPH_ITERATION_SUMMARY";
export const MAX_ITERATION_SUMMARY_LENGTH = 2000;

/** Trim a handoff summary to Ralph's output-policy limit. */
export function trimIterationSummary(summary: string): string {
	return summary.trim().slice(0, MAX_ITERATION_SUMMARY_LENGTH);
}

/**
 * Extract the first paired iteration-summary marker block from worker output.
 * Missing or unpaired markers produce the empty fallback.
 */
export function parseIterationSummary(output: string): string {
	let searchFrom = 0;
	while (true) {
		const start = output.indexOf(RALPH_ITERATION_SUMMARY_START, searchFrom);
		if (start < 0) return "";

		const contentStart = start + RALPH_ITERATION_SUMMARY_START.length;
		const end = output.indexOf(RALPH_ITERATION_SUMMARY_END, contentStart);
		const nextStart = output.indexOf(
			RALPH_ITERATION_SUMMARY_START,
			contentStart,
		);
		if (end < 0 || (nextStart >= 0 && nextStart < end)) {
			if (nextStart < 0) return "";
			searchFrom = nextStart;
			continue;
		}

		return trimIterationSummary(output.slice(contentStart, end));
	}
}

export function iterationSummaryPrompt(summary: string): string {
	const trimmed = trimIterationSummary(summary);
	return trimmed || "(none — first iteration)";
}
