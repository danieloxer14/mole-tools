import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import { type AgentExec, defaultAgentExec } from "./exec";

export interface OmpAgentOptions {
	binary?: string;
	model?: string;
	exec?: AgentExec;
}

type JsonRecord = Record<string, unknown>;
type ParsedLine =
	| { tag: "provider"; value: JsonRecord }
	| { tag: "event"; event: AgentEvent };
const READ_ONLY_TOOLS = ["read", "grep", "glob"] as const;
const IGNORED_EVENTS: Record<string, true> = {
	agent_start: true,
	turn_start: true,
	message_start: true,
	message_end: true,
	// Streams incremental tool-input/output progress; the port's AgentEvent
	// only distinguishes tool "start"/"end", so intermediate updates carry
	// nothing we surface today.
	tool_execution_update: true,
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function diagnostic(eventType: string | null, raw: unknown): AgentEvent {
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

function malformed(message: string): AgentEvent {
	return { kind: "error", message: `Malformed OMP agent event: ${message}` };
}

function nestedMessage(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) return value;
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	const record = value as JsonRecord;
	for (const key of ["message", "error", "detail", "reason"]) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) return candidate;
		if (
			candidate !== null &&
			typeof candidate === "object" &&
			!Array.isArray(candidate)
		) {
			const nested = nestedMessage(candidate);
			if (nested) return nested;
		}
	}
	return null;
}

function parseJson(line: string): ParsedLine {
	let value: unknown;
	try {
		value = JSON.parse(line) as unknown;
	} catch {
		return {
			tag: "event",
			event: {
				kind: "error",
				message: `Malformed OMP agent event: invalid JSON (${line})`,
			},
		};
	}
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return { tag: "event", event: malformed("expected an object") };
	return { tag: "provider", value: value as JsonRecord };
}

function mapOmpEvent(value: JsonRecord): AgentEvent | null {
	const type = value.type;
	if (typeof type !== "string") return diagnostic(null, value);

	switch (type) {
		case "session": {
			const id = value.id ?? value.sessionId;
			return typeof id === "string" && id.length > 0
				? { kind: "session", sessionId: id }
				: malformed("session event requires a string id");
		}
		case "message_update": {
			const updateValue = value.assistantMessageEvent;
			const update =
				updateValue !== null &&
				typeof updateValue === "object" &&
				!Array.isArray(updateValue)
					? (updateValue as JsonRecord)
					: null;
			if (update?.type !== "text_delta") return null;
			return typeof update.delta === "string"
				? { kind: "text", delta: update.delta }
				: malformed("text delta requires a string delta");
		}
		case "tool_execution_start": {
			const name = value.toolName ?? value.name;
			return typeof name === "string" && name.length > 0
				? { kind: "tool", name, phase: "start" }
				: malformed("tool start requires a string toolName");
		}
		case "tool_execution_end": {
			const name = value.toolName ?? value.name;
			return typeof name === "string" && name.length > 0
				? { kind: "tool", name, phase: "end" }
				: malformed("tool end requires a string toolName");
		}
		case "turn_end":
			// Per-model-turn boundary, not overall completion: a tool-call turn
			// ends with "turn_end" too, followed by another turn that carries
			// the actual reply. Only "agent_end" (isTerminal !== false) signals
			// the run is actually done.
			return null;
		case "error": {
			const message = nestedMessage(value.message ?? value.error ?? value);
			return message
				? { kind: "error", message }
				: malformed("error event requires a message");
		}
		case "agent_end": {
			const message = nestedMessage(value.error);
			if (message) return { kind: "error", message };
			return value.isTerminal === false ? null : { kind: "turn_end" };
		}
		default:
			if (IGNORED_EVENTS[type]) return null;
			return diagnostic(type, value);
	}
}

export class OmpAgentAdapter implements ReviewAgent {
	private readonly binary: string;
	private readonly model?: string;
	private readonly execFn: AgentExec;

	constructor(
		execOrOptions: AgentExec | OmpAgentOptions = defaultAgentExec,
		options: OmpAgentOptions = {},
	) {
		if (typeof execOrOptions === "function") {
			this.execFn = execOrOptions;
			this.binary = options.binary ?? "omp";
			this.model = options.model;
			return;
		}
		this.execFn = execOrOptions.exec ?? defaultAgentExec;
		this.binary = execOrOptions.binary ?? "omp";
		this.model = execOrOptions.model;
	}

	async preflight(): Promise<void> {
		for await (const _line of this.execFn(this.binary, ["--version"], {
			cwd: process.cwd(),
		})) {
			// Consuming stream waits for process and surfaces its exit status.
		}
	}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		if (turn.signal?.aborted) return;

		const tools = turn.writeDir
			? [...READ_ONLY_TOOLS, "write"].join(",")
			: READ_ONLY_TOOLS.join(",");
		const args = [
			"-p",
			"--mode",
			"json",
			"--cwd",
			turn.cwd,
			"--append-system-prompt",
			turn.systemPromptFile,
			"--tools",
			tools,
		];
		if (this.model) args.push("--model", this.model);
		if (turn.sessionId) args.push("-r", turn.sessionId);
		if (turn.writeDir) args.push("--add-dir", turn.writeDir);
		args.push("--", turn.message);

		let sessionEmitted = false;
		let sawError = false;
		let turnEnded = false;

		if (turn.sessionId) {
			sessionEmitted = true;
			yield { kind: "session", sessionId: turn.sessionId };
		}

		try {
			for await (const line of this.execFn(this.binary, args, {
				cwd: turn.cwd,
				signal: turn.signal,
			})) {
				if (turn.signal?.aborted) return;
				if (turnEnded) continue;

				const parsed = parseJson(line);
				const event =
					parsed.tag === "event" ? parsed.event : mapOmpEvent(parsed.value);
				if (!event) continue;
				if (event.kind === "error") sawError = true;
				if (event.kind === "turn_end") turnEnded = true;
				if (event.kind === "session") {
					if (sessionEmitted) continue;
					sessionEmitted = true;
					yield turn.sessionId
						? { kind: "session", sessionId: turn.sessionId }
						: event;
					continue;
				}
				yield event;
			}
		} catch (error) {
			if (turn.signal?.aborted) return;
			if (!sawError && !turnEnded) {
				sawError = true;
				yield { kind: "error", message: errorMessage(error) };
			}
		}

		if (turn.signal?.aborted || turnEnded) return;
		if (!sessionEmitted && !sawError) {
			yield { kind: "error", message: "OMP did not emit a session id" };
		}
		yield { kind: "turn_end" };
	}
}
