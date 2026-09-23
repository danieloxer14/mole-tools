import type {
	PromptAgentName,
	PromptVersionMeta,
} from "../../adapters/prompts/frontmatter";

export interface AgentSelection {
	agent: PromptAgentName;
	model: string | null;
}

export function effectiveAgentSelection(
	version: PromptVersionMeta,
	fallback: { agent: PromptAgentName; model?: string | null },
): AgentSelection {
	if (version.agent === null) {
		return {
			agent: fallback.agent,
			model: version.model ?? fallback.model ?? null,
		};
	}
	return { agent: version.agent, model: version.model };
}
