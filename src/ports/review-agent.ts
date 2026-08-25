export type AgentDiagnosticCode = "unknown_event";
export type AgentEvent =
	| { kind: "session"; sessionId: string }
	| { kind: "text"; delta: string }
	| { kind: "tool"; name: string; phase: "start" | "end" }
	| { kind: "turn_end" }
	| { kind: "error"; message: string }
	| {
			kind: "diagnostic";
			code: AgentDiagnosticCode;
			message: string;
			eventType: string | null;
			raw: unknown;
	  };

export interface AgentTurn {
	/** Omit to begin a new conversation. */
	sessionId?: string;
	/** Working directory the agent is pinned to. */
	cwd: string;
	/** Absolute path to a file whose contents are appended to the system prompt. */
	systemPromptFile: string;
	message: string;
	/** When set, the agent may write inside this directory only. */
	writeDir?: string;
	signal?: AbortSignal;
}

export interface ReviewAgent {
	preflight(): Promise<void>;
	run(turn: AgentTurn): AsyncIterable<AgentEvent>;
}

/**
 * Decode one provider-neutral event line for ReviewAgent adapters.
 * Unknown event kinds become typed, nonfatal diagnostics so callers can
 * preserve stream order and report provider drift without ending a turn.
 * Malformed JSON or malformed known events remain typed error events.
 */
export function parseAgentEvent(line: string): AgentEvent {
	let value: unknown;
	try {
		value = JSON.parse(line) as unknown;
	} catch {
		return {
			kind: "error",
			message: `Malformed agent event: invalid JSON (${line})`,
		};
	}

	if (!isRecord(value)) {
		return {
			kind: "error",
			message: "Malformed agent event: expected an object",
		};
	}

	const kind = value.kind ?? value.type;
	if (typeof kind !== "string") return unknownEvent(null, value);

	switch (kind) {
		case "session": {
			const sessionId = value.sessionId ?? value.id;
			return typeof sessionId === "string"
				? { kind: "session", sessionId }
				: malformed("session event requires a string sessionId");
		}
		case "text":
			return typeof value.delta === "string"
				? { kind: "text", delta: value.delta }
				: malformed("text event requires a string delta");
		case "tool":
			return typeof value.name === "string" && isToolPhase(value.phase)
				? { kind: "tool", name: value.name, phase: value.phase }
				: malformed("tool event requires a string name and start/end phase");
		case "turn_end":
			return { kind: "turn_end" };
		case "error":
			return typeof value.message === "string"
				? { kind: "error", message: value.message }
				: malformed("error event requires a string message");
		default:
			return unknownEvent(kind, value);
	}
}

function unknownEvent(eventType: string | null, raw: unknown): AgentEvent {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolPhase(value: unknown): value is "start" | "end" {
	return value === "start" || value === "end";
}

function malformed(message: string): AgentEvent {
	return { kind: "error", message: `Malformed agent event: ${message}` };
}
