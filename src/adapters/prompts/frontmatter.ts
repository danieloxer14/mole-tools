import { PortError } from "../../core/errors";

export const PROMPT_AGENT_NAMES = ["omp", "claude", "codex"] as const;
export type PromptAgentName = (typeof PROMPT_AGENT_NAMES)[number];

export function formatAgentNames(names: readonly string[]): string {
	if (names.length === 1) return names[0] ?? "";
	if (names.length === 2) return `${names[0]} or ${names[1]}`;
	return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
}

export interface PromptVersionMeta {
	agent: PromptAgentName | null;
	model: string | null;
}

export interface PromptFile extends PromptVersionMeta {
	text: string;
}

const FRONTMATTER_LINE = /^(agent|model):[ \t]*(.*?)[ \t]*$/;

export function parsePromptFile(raw: string, source: string): PromptFile {
	const lines = raw.split("\n");
	const strippedLines: string[] = [];
	for (const line of lines) {
		strippedLines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
	}
	if (strippedLines[0] !== "---") {
		return { text: raw, agent: null, model: null };
	}

	const closingIndex = strippedLines.findIndex(
		(line, index) => index > 0 && line === "---",
	);
	if (closingIndex < 0) return { text: raw, agent: null, model: null };

	const metadataLines = strippedLines.slice(1, closingIndex);

	for (const line of metadataLines) {
		if (line.trim().length === 0) continue;
		if (!FRONTMATTER_LINE.test(line)) {
			return { text: raw, agent: null, model: null };
		}
	}

	let agent: PromptAgentName | null = null;
	let model: string | null = null;
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
					`Invalid prompt metadata in ${source}: agent must be ${formatAgentNames(PROMPT_AGENT_NAMES)}`,
				);
			}
			agent = value as PromptAgentName;
		} else {
			if (value.length === 0) {
				throw new PortError(
					`Invalid prompt metadata in ${source}: model must not be empty`,
				);
			}
			model = value;
		}
	}

	let closingEnd = 0;
	for (let index = 0; index <= closingIndex; index++) {
		closingEnd += lines[index]?.length ?? 0;
		if (index < closingIndex) closingEnd += 1;
	}
	const text = raw[closingEnd] === "\n" ? raw.slice(closingEnd + 1) : "";
	return { text, agent, model };
}

export function serializePromptFile(file: PromptFile): string {
	if (file.agent === null && file.model === null) return file.text;
	return (
		"---\n" +
		(file.agent === null ? "" : `agent: ${file.agent}\n`) +
		(file.model === null ? "" : `model: ${file.model}\n`) +
		"---\n" +
		file.text
	);
}
