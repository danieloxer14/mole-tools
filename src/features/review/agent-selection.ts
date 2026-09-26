import { type AgentEffort, isAgentEffort } from "../../adapters/agent/effort";
import type {
	PromptAgentName,
	PromptVersionMeta,
} from "../../adapters/prompts/frontmatter";

export interface AgentSelection {
	agent: PromptAgentName;
	model: string | null;
	effort: AgentEffort | null;
}

type PromptSelectionMeta = Omit<PromptVersionMeta, "effort"> & {
	effort?: AgentEffort | null;
};

export function effectiveAgentSelection(
	version: PromptSelectionMeta,
	fallback: {
		agent: PromptAgentName;
		model?: string | null;
		effort?: AgentEffort | null;
	},
	modelEfforts?: readonly string[],
): AgentSelection {
	const selection =
		version.agent === null
			? {
					agent: fallback.agent,
					model: version.model ?? fallback.model ?? null,
					effort: version.effort ?? fallback.effort ?? null,
				}
			: {
					agent: version.agent,
					model: version.model,
					effort: version.effort ?? null,
				};
	if (
		selection.effort !== null &&
		!isAgentEffort(selection.agent, selection.effort)
	) {
		throw new TypeError(`Unsupported effort for ${selection.agent}`);
	}
	if (
		selection.effort !== null &&
		modelEfforts !== undefined &&
		!modelEfforts.includes(selection.effort)
	) {
		if (version.agent === null && version.effort === null) {
			return { ...selection, effort: null };
		}
		throw new TypeError(
			`Effort ${selection.effort} is not supported by the selected model`,
		);
	}
	return selection;
}
