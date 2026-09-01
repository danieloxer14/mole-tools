import type {
	AgentEvent,
	AgentTurn,
	ReviewAgent,
} from "../../ports/review-agent";
import { type AgentExec, defaultAgentExec } from "./exec";
import {
	diagnostic,
	errorMessage,
	type JsonRecord,
	malformed,
	nestedMessage,
	parseJson,
	preflight,
	resolveAgentConfig,
} from "./shared";

export interface OmpAgentOptions {
	binary?: string;
	model?: string;
	exec?: AgentExec;
}

const READ_ONLY_TOOLS = ["read", "grep", "glob", "bash"] as const;
const IGNORED_EVENTS: Record<string, true> = {
	agent_start: true,
	turn_start: true,
	message_start: true,
	message_end: true,
	rate_limit_event: true,
	// Streams incremental tool-input/output progress; the port's AgentEvent
	// only distinguishes tool "start"/"end", so intermediate updates carry
	// nothing we surface today.
	tool_execution_update: true,
};

function mapOmpEvent(value: JsonRecord): AgentEvent | null {
	const type = value.type;
	if (typeof type !== "string") return diagnostic(null, value);

	switch (type) {
		case "session": {
			const id = value.id ?? value.sessionId;
			return typeof id === "string" && id.length > 0
				? { kind: "session", sessionId: id }
				: malformed("OMP", "session event requires a string id");
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
				: malformed("OMP", "text delta requires a string delta");
		}
		case "tool_execution_start": {
			const name = value.toolName ?? value.name;
			return typeof name === "string" && name.length > 0
				? { kind: "tool", name, phase: "start" }
				: malformed("OMP", "tool start requires a string toolName");
		}
		case "tool_execution_end": {
			const name = value.toolName ?? value.name;
			return typeof name === "string" && name.length > 0
				? { kind: "tool", name, phase: "end" }
				: malformed("OMP", "tool end requires a string toolName");
		}
		case "turn_end":
			// Per-model-turn boundary, not overall completion: a tool-call turn
			// ends with "turn_end" too, followed by another turn that carries
			// the actual reply. Only "agent_end" (isTerminal !== false) signals
			// the run is actually done.
			return null;
		case "error": {
			const message = nestedMessage(value.message ?? value.error ?? value, [
				"message",
				"error",
				"detail",
				"reason",
			]);
			return message
				? { kind: "error", message }
				: malformed("OMP", "error event requires a message");
		}
		case "agent_end": {
			const message = nestedMessage(value.error, [
				"message",
				"error",
				"detail",
				"reason",
			]);
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
		const config = resolveAgentConfig(execOrOptions, options, "omp");
		this.execFn = config.execFn;
		this.binary = config.binary;
		this.model = config.model;
	}

	async preflight(): Promise<void> {
		return preflight(this.execFn, this.binary);
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

				const parsed = parseJson(line, "OMP");
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
