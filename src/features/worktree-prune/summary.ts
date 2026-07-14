import type { Context } from "../../core/context";

const SUMMARY_TIMEOUT_MS = 10_000;

/**
 * Produce a short explanation of changes that would be lost by deleting a
 * worktree. This is deliberately best-effort: pruning must remain usable when
 * no LLM provider is available or the provider fails.
 */
export async function summarizeWorktree(
	ctx: Context,
	snapshot: string,
	timeoutMs = SUMMARY_TIMEOUT_MS,
): Promise<string> {
	try {
		const model = ctx.config.models.commit.name;
		const generation = collect(
			ctx.llm.generate({
				model,
				system:
					"Summarize the changes in a Git worktree concisely for a user deciding whether to delete it.",
				prompt: `Here is the worktree's git status and diff snapshot:\n\n${snapshot}\n\nSummarize what would be lost.`,
				task: "worktree-summary",
			}),
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<string>((resolve) => {
			timer = setTimeout(() => resolve(""), timeoutMs);
		});
		try {
			return (await Promise.race([generation, timeout])).trim();
		} finally {
			if (timer) clearTimeout(timer);
		}
	} catch {
		return "";
	}
}

async function collect(chunks: AsyncIterable<string>): Promise<string> {
	let result = "";
	for await (const chunk of chunks) result += chunk;
	return result;
}
