import { loadPrompt } from "../../adapters/prompts/loader";
import type { Context } from "../../core/context";
import { AbortError } from "../../core/errors";
import type { Issue } from "../../ports/issue-tracker";
import type { FileDiff } from "../../ports/vcs";
import { checkFormat } from "../../shared/format";
import { buildMergeRequestPrompt, parseMergeRequestOutput, type ParsedMergeRequest } from "./prompt";

const MAX_GENERATE_ATTEMPTS = 3;

export interface GenerateMergeRequestInput {
	issue?: Issue | null;
	commits: string[];
	diff: FileDiff[];
}

/** Generate an MR candidate, retrying only when the title violates format rules. */
export async function generateMergeRequest(
	ctx: Context,
	input: GenerateMergeRequestInput,
): Promise<ParsedMergeRequest> {
	const system = await loadPrompt("mr-system");
	const prompt = buildMergeRequestPrompt({ ...input, system });
	let violations: string[] = [];

	for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
		const raw = await ctx.ui.stream(
			ctx.llm.generate({
				model: ctx.config.ollama.mrModel ?? ctx.config.ollama.commitModel,
				system,
				prompt,
				task: "merge-request",
			}),
			"Generating merge request",
		);
		const candidate = parseMergeRequestOutput(raw);
		const check = checkFormat(candidate.title);
		if (check.ok) return candidate;
		violations = check.violations;
	}

	throw new AbortError(
		`Merge request title failed format checks after ${MAX_GENERATE_ATTEMPTS} attempts:\n${violations.join("\n")}`,
	);
}

export const generateMr = generateMergeRequest;
