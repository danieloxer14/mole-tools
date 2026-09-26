import { PortError } from "../../core/errors";
import {
	type AgentEffort,
	AgentEffortSchema,
	isAgentEffort,
} from "../agent/effort";

export const PROMPT_AGENT_NAMES = ["omp", "claude"] as const;
export type PromptAgentName = (typeof PROMPT_AGENT_NAMES)[number];

export interface PromptVersionMeta {
	agent: PromptAgentName | null;
	model: string | null;
	effort: AgentEffort | null;
}

export interface PromptFile extends PromptVersionMeta {
	text: string;
}

const FRONTMATTER_LINE = /^(agent|model|effort):[ \t]*(.*?)[ \t]*$/;

export function parsePromptFile(raw: string, source: string): PromptFile {
	const lines = raw.split("\n");
	const strippedLines: string[] = [];
	for (const line of lines) {
		strippedLines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
	}
	if (strippedLines[0] !== "---") {
		return { text: raw, agent: null, model: null, effort: null };
	}

	const closingIndex = strippedLines.findIndex(
		(line, index) => index > 0 && line === "---",
	);
	if (closingIndex < 0)
		return { text: raw, agent: null, model: null, effort: null };

	const metadataLines = strippedLines.slice(1, closingIndex);

	for (const line of metadataLines) {
		if (line.trim().length === 0) continue;
		if (!FRONTMATTER_LINE.test(line)) {
			if (/^effort\b/.test(line.trimStart())) {
				throw new PortError(
					`Invalid prompt metadata in ${source}: malformed effort`,
				);
			}
			return { text: raw, agent: null, model: null, effort: null };
		}
	}

	let agent: PromptAgentName | null = null;
	let model: string | null = null;
	let effort: AgentEffort | null = null;
	const seen = new Set<string>();
	for (const line of metadataLines) {
		if (line.trim().length === 0) continue;
		const match = FRONTMATTER_LINE.exec(line);
		if (!match) continue;
		const [, key, value] = match;
		if (seen.has(key)) {
			throw new PortError(
				`Invalid prompt metadata in ${source}: duplicate key ${key}`,
			);
		}
		seen.add(key);
		if (key === "agent") {
			if (!PROMPT_AGENT_NAMES.includes(value as PromptAgentName)) {
				throw new PortError(
					`Invalid prompt metadata in ${source}: agent must be omp or claude`,
				);
			}
			agent = value as PromptAgentName;
		} else if (key === "model") {
			if (value.length === 0) {
				throw new PortError(
					`Invalid prompt metadata in ${source}: model must not be empty`,
				);
			}
			model = value;
		} else if (value === "" || value === "null") {
			effort = null;
		} else {
			const parsedEffort = AgentEffortSchema.safeParse(value);
			if (!parsedEffort.success) {
				throw new PortError(
					`Invalid prompt metadata in ${source}: unsupported effort`,
				);
			}
			effort = parsedEffort.data;
		}
	}

	if (agent !== null && effort !== null && !isAgentEffort(agent, effort)) {
		throw new PortError(
			`Invalid prompt metadata in ${source}: effort is not supported by ${agent}`,
		);
	}

	let closingEnd = 0;
	for (let index = 0; index <= closingIndex; index++) {
		closingEnd += lines[index]?.length ?? 0;
		if (index < closingIndex) closingEnd += 1;
	}
	const text = raw[closingEnd] === "\n" ? raw.slice(closingEnd + 1) : "";
	return { text, agent, model, effort };
}

export function serializePromptFile(file: PromptFile): string {
	if (file.agent === null && file.model === null && file.effort === null)
		return file.text;
	return (
		"---\n" +
		(file.agent === null ? "" : `agent: ${file.agent}\n`) +
		(file.model === null ? "" : `model: ${file.model}\n`) +
		(file.effort === null ? "" : `effort: ${file.effort}\n`) +
		"---\n" +
		file.text
	);
}
