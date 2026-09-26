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

export const AgentEffortSchema = z.union([
	z.enum(OMP_EFFORTS),
	z.enum(CLAUDE_EFFORTS),
]);

export type OmpEffort = (typeof OMP_EFFORTS)[number];
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
export type AgentEffort = z.infer<typeof AgentEffortSchema>;
export type EffortAgentName = "omp" | "claude";

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
	agent: EffortAgentName,
	value: unknown,
): value is AgentEffort;
export function isAgentEffort(agent: EffortAgentName, value: unknown): boolean {
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
	agent: EffortAgentName,
	value: unknown,
): asserts value is AgentEffort;
export function assertAgentEffort(
	agent: EffortAgentName,
	value: unknown,
): void {
	if (!isAgentEffort(agent, value)) {
		throw new TypeError(
			`${agent} effort must be one of: ${EFFORTS_BY_AGENT[agent].join(", ")}`,
		);
	}
}
