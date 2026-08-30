import type { AgentEvent } from "../../ports/review-agent";
import { type AgentExec, defaultAgentExec } from "./exec";

export type JsonRecord = Record<string, unknown>;
export type ParsedLine =
	| { tag: "provider"; value: JsonRecord }
	| { tag: "event"; event: AgentEvent };

type AgentOptions = {
	binary?: string;
	model?: string;
	exec?: AgentExec;
};

export type AgentConfig = {
	binary: string;
	model?: string;
	execFn: AgentExec;
};

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function diagnostic(eventType: string | null, raw: unknown): AgentEvent {
	return {
		kind: "diagnostic",
		code: "unknown_event",
		message: eventType
			? `Unknown agent event type: ${eventType}`
			: "Unknown agent event type",
		eventType,
		raw,
	};
}

export function malformed(provider: string, message: string): AgentEvent {
	return {
		kind: "error",
		message: `Malformed ${provider} agent event: ${message}`,
	};
}

export function nestedMessage(
	value: unknown,
	keys: readonly string[],
): string | null {
	if (typeof value === "string" && value.trim()) return value;
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	const record = value as JsonRecord;
	for (const key of keys) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) return candidate;
		if (
			candidate !== null &&
			typeof candidate === "object" &&
			!Array.isArray(candidate)
		) {
			const nested = nestedMessage(candidate, keys);
			if (nested) return nested;
		}
	}
	return null;
}

export function parseJson(line: string, provider: string): ParsedLine {
	let value: unknown;
	try {
		value = JSON.parse(line) as unknown;
	} catch {
		return {
			tag: "event",
			event: {
				kind: "error",
				message: `Malformed ${provider} agent event: invalid JSON (${line})`,
			},
		};
	}
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return { tag: "event", event: malformed(provider, "expected an object") };
	return { tag: "provider", value: value as JsonRecord };
}

export function resolveAgentConfig<T extends AgentOptions>(
	execOrOptions: AgentExec | T,
	options: T,
	defaultBinary: string,
): AgentConfig {
	if (typeof execOrOptions === "function") {
		return {
			execFn: execOrOptions,
			binary: options.binary ?? defaultBinary,
			model: options.model,
		};
	}
	return {
		execFn: execOrOptions.exec ?? defaultAgentExec,
		binary: execOrOptions.binary ?? defaultBinary,
		model: execOrOptions.model,
	};
}

export async function preflight(
	exec: AgentExec,
	binary: string,
): Promise<void> {
	for await (const _line of exec(binary, ["--version"], {
		cwd: process.cwd(),
	})) {
		// Consuming stream waits for process and surfaces its exit status.
	}
}
