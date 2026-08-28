import { resolveLlmProvider } from "../../adapters/config/schema";
import {
	loadPrompt,
	loadPromptWithFallback,
} from "../../adapters/prompts/loader";
import type { Context } from "../../core/context";
import { AbortError } from "../../core/errors";
import type { Issue } from "../../ports/issue-tracker";
import type { FileDiff } from "../../ports/vcs";
import { checkFormat } from "../../shared/format";
import {
	buildMergeRequestPrompt,
	type ParsedMergeRequest,
	parseMergeRequestOutput,
} from "./prompt";

const MAX_GENERATE_ATTEMPTS = 3;

export type MergeRequestMode = "code" | "plan";

export async function loadMergeRequestPrompt(
	mode: MergeRequestMode = "code",
	dir?: string,
): Promise<string> {
	if (mode === "plan") return loadPrompt("mr-plan", dir);
	return loadPromptWithFallback(["mr-code", "mr-system"], dir);
}

export interface GenerateMergeRequestInput {
	issue?: Issue | null;
	commits: string[];
	diff: FileDiff[];
	context?: string;
	mode?: MergeRequestMode;
	/** Optional prompt directory for isolated generation tests. */
	promptSourceDir?: string;
}

/** Generate an MR candidate, retrying only when the title violates format rules. */
export async function generateMergeRequest(
	ctx: Context,
	input: GenerateMergeRequestInput,
): Promise<ParsedMergeRequest> {
	const system = await loadMergeRequestPrompt(
		input.mode,
		input.promptSourceDir,
	);
	const prompt = buildMergeRequestPrompt({ ...input, system });
	const llm = ctx.getLlmFor("mergeRequest");
	const { providerKey, model } = resolveLlmProvider(ctx.config, "mergeRequest");

	let violations: string[] = [];

	for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
		const raw = await ctx.ui.stream(
			llm.generate({
				providerKey,
				model,
				system,
				prompt,
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
