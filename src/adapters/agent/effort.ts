import { z } from "zod";

export const OMP_EFFORTS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"auto",
] as const;

export const CLAUDE_EFFORTS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export const CODEX_EFFORTS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
] as const;

export const CODEX_EFFORTS_BY_MODEL = {
	"gpt-6-sol": CODEX_EFFORTS,
	"gpt-6-astra": CODEX_EFFORTS,
	"gpt-5.6-sol": CODEX_EFFORTS,
	"gpt-5.6-terra": CODEX_EFFORTS,
	"gpt-6-luna": ["low", "medium", "high", "xhigh", "max"],
	"gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
	"gpt-5.5": ["low", "medium", "high", "xhigh"],
} as const satisfies Record<string, readonly CodexEffort[]>;

export const AgentEffortSchema = z.union([
	z.enum(OMP_EFFORTS),
	z.enum(CLAUDE_EFFORTS),
	z.enum(CODEX_EFFORTS),
]);

export type OmpEffort = (typeof OMP_EFFORTS)[number];
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
export type CodexEffort = (typeof CODEX_EFFORTS)[number];
export type AgentEffort = z.infer<typeof AgentEffortSchema>;
export type EffortAgentName = "omp" | "claude" | "codex";

export function codexEffortsForModel(
	model: string | null | undefined,
): readonly CodexEffort[] {
	if (!model || !Object.hasOwn(CODEX_EFFORTS_BY_MODEL, model)) return [];
	return CODEX_EFFORTS_BY_MODEL[model as keyof typeof CODEX_EFFORTS_BY_MODEL];
}

const EFFORTS_BY_AGENT = {
	omp: OMP_EFFORTS,
	claude: CLAUDE_EFFORTS,
} as const;

export function isAgentEffort(agent: "omp", value: unknown): value is OmpEffort;
export function isAgentEffort(
	agent: "claude",
	value: unknown,
): value is ClaudeEffort;
export function isAgentEffort(
	agent: "codex",
	value: unknown,
	model?: string | null,
): value is CodexEffort;
export function isAgentEffort(
	agent: EffortAgentName,
	value: unknown,
	model?: string | null,
): value is AgentEffort;
export function isAgentEffort(
	agent: EffortAgentName,
	value: unknown,
	model?: string | null,
): boolean {
	if (agent === "codex") {
		return (codexEffortsForModel(model) as readonly unknown[]).includes(value);
	}
	return (EFFORTS_BY_AGENT[agent] as readonly unknown[]).includes(value);
}

export function assertAgentEffort(
	agent: "omp",
	value: unknown,
): asserts value is OmpEffort;
export function assertAgentEffort(
	agent: "claude",
	value: unknown,
): asserts value is ClaudeEffort;
export function assertAgentEffort(
	agent: "codex",
	value: unknown,
	model?: string | null,
): asserts value is CodexEffort;
export function assertAgentEffort(
	agent: EffortAgentName,
	value: unknown,
	model?: string | null,
): asserts value is AgentEffort;
export function assertAgentEffort(
	agent: EffortAgentName,
	value: unknown,
	model?: string | null,
): void {
	if (!isAgentEffort(agent, value, model)) {
		const supported =
			agent === "codex" ? codexEffortsForModel(model) : EFFORTS_BY_AGENT[agent];
		throw new TypeError(
			`${agent} effort must be one of: ${supported.join(", ")}`,
		);
	}
}
