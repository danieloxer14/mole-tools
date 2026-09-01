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

export interface ClaudeAgentOptions {
	binary?: string;
	model?: string;
	exec?: AgentExec;
}

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Bash"] as const;
const IGNORED_STREAM_EVENTS: Record<string, true> = {
	message_start: true,
	content_block_start: true,
	content_block_stop: true,
	message_delta: true,
	message_stop: true,
	rate_limit_event: true,
};
const IGNORED_PROVIDER_EVENTS: Record<string, true> = {
	assistant: true,
	user: true,
	rate_limit_event: true,
};

function withAuthRecovery(message: string): string {
	if (!/(?:oauth.*(?:expired|refresh)|failed to authenticate)/i.test(message))
		return message;
	return `${message}\n\nClaude authentication expired. Run \`claude auth login\`, complete sign-in, then retry the layer guide.`;
}

function providerError(message: string): AgentEvent {
	return { kind: "error", message: withAuthRecovery(message) };
}

function indexKey(value: unknown): string | null {
	return typeof value === "string" || typeof value === "number"
		? String(value)
		: null;
}

function mapClaudeEvent(
	value: JsonRecord,
	tools: Map<string, string>,
): AgentEvent | null {
	const type = value.type;
	if (typeof type !== "string") return diagnostic(null, value);
	if (IGNORED_PROVIDER_EVENTS[type]) return null;
	switch (type) {
		case "system": {
			if (value.subtype === "init") {
				return typeof value.session_id === "string" &&
					value.session_id.length > 0
					? { kind: "session", sessionId: value.session_id }
					: malformed("Claude", "system init requires a string session_id");
			}
			if (value.subtype === "error") {
				const message = nestedMessage(value.error ?? value.message ?? value, [
					"message",
					"error",
					"detail",
					"reason",
					"result",
				]);
				return message
					? providerError(message)
					: malformed("Claude", "system error requires a message");
			}
			return null;
		}
		case "stream_event": {
			const eventValue = value.event;
			const streamEvent =
				eventValue !== null &&
				typeof eventValue === "object" &&
				!Array.isArray(eventValue)
					? (eventValue as JsonRecord)
					: null;
			if (!streamEvent)
				return malformed("Claude", "stream_event requires an event object");
			const eventType = streamEvent.type;
			if (typeof eventType !== "string") return diagnostic(type, value);

			if (eventType === "content_block_delta") {
				const deltaValue = streamEvent.delta;
				const delta =
					deltaValue !== null &&
					typeof deltaValue === "object" &&
					!Array.isArray(deltaValue)
						? (deltaValue as JsonRecord)
						: null;
				if (delta?.type !== "text_delta") return null;
				return typeof delta.text === "string"
					? { kind: "text", delta: delta.text }
					: malformed("Claude", "text delta requires a string text");
			}

			if (eventType === "content_block_start") {
				const blockValue = streamEvent.content_block;
				const block =
					blockValue !== null &&
					typeof blockValue === "object" &&
					!Array.isArray(blockValue)
						? (blockValue as JsonRecord)
						: null;
				if (block?.type !== "tool_use") return null;
				if (typeof block.name !== "string" || block.name.length === 0)
					return malformed("Claude", "tool start requires a string name");
				const key = indexKey(streamEvent.index);
				if (key !== null) tools.set(key, block.name);
				return { kind: "tool", name: block.name, phase: "start" };
			}

			if (eventType === "content_block_stop") {
				const key = indexKey(streamEvent.index);
				if (key === null) return null;
				const name = tools.get(key);
				if (!name) return null;
				tools.delete(key);
				return { kind: "tool", name, phase: "end" };
			}

			if (eventType === "message_delta") {
				const deltaValue = streamEvent.delta;
				const delta =
					deltaValue !== null &&
					typeof deltaValue === "object" &&
					!Array.isArray(deltaValue)
						? (deltaValue as JsonRecord)
						: null;
				const stopReason = delta?.stop_reason;
				if (stopReason === "end_turn") return { kind: "turn_end" };
				if (stopReason === "error") {
					const message = nestedMessage(delta?.error ?? streamEvent, [
						"message",
						"error",
						"detail",
						"reason",
						"result",
					]);
					return message
						? providerError(message)
						: malformed("Claude", "message delta error requires a message");
				}
				return null;
			}

			if (IGNORED_STREAM_EVENTS[eventType]) return null;
			return diagnostic(eventType, streamEvent);
		}
		case "result": {
			const failed = value.is_error === true || value.subtype !== "success";
			if (failed) {
				const message = nestedMessage(value.error ?? value.result ?? value, [
					"message",
					"error",
					"detail",
					"reason",
					"result",
				]);
				return message
					? providerError(message)
					: malformed("Claude", "error result requires a message");
			}
			return { kind: "turn_end" };
		}
		case "error": {
			const message = nestedMessage(value.error ?? value.message ?? value, [
				"message",
				"error",
				"detail",
				"reason",
				"result",
			]);
			return message
				? providerError(message)
				: malformed("Claude", "error event requires a message");
		}
		default:
			return diagnostic(type, value);
	}
}

export class ClaudeAgentAdapter implements ReviewAgent {
	private readonly binary: string;
	private readonly model?: string;
	private readonly execFn: AgentExec;

	constructor(
		execOrOptions: AgentExec | ClaudeAgentOptions = defaultAgentExec,
		options: ClaudeAgentOptions = {},
	) {
		const config = resolveAgentConfig(execOrOptions, options, "claude");
		this.execFn = config.execFn;
		this.binary = config.binary;
		this.model = config.model;
	}

	async preflight(): Promise<void> {
		return preflight(this.execFn, this.binary);
	}

	async *run(turn: AgentTurn): AsyncIterable<AgentEvent> {
		if (turn.signal?.aborted) return;

		let systemPrompt: string;
		try {
			systemPrompt = await Bun.file(turn.systemPromptFile).text();
		} catch (error) {
			if (turn.signal?.aborted) return;
			yield { kind: "error", message: errorMessage(error) };
			yield { kind: "turn_end" };
			return;
		}

		const sessionId = turn.sessionId ?? crypto.randomUUID();
		const allowedTools = turn.writeDir
			? [...READ_ONLY_TOOLS, `Write(${turn.writeDir}/**)`]
			: READ_ONLY_TOOLS;
		const args = [
			"-p",
			"--output-format",
			"stream-json",
			"--include-partial-messages",
			"--verbose",
			...(turn.sessionId
				? ["--resume", turn.sessionId]
				: ["--session-id", sessionId]),
			"--append-system-prompt",
			systemPrompt,
			"--allowedTools",
			...allowedTools,
		];
		if (this.model) args.splice(7, 0, "--model", this.model);
		if (turn.writeDir) {
			args.push("--permission-mode", "acceptEdits", "--add-dir", turn.writeDir);
		}
		args.push("--add-dir", turn.cwd, "--", turn.message);

		let sessionEmitted = false;
		let sawError = false;
		let turnEnded = false;
		const tools = new Map<string, string>();

		try {
			for await (const line of this.execFn(this.binary, args, {
				cwd: turn.cwd,
				signal: turn.signal,
			})) {
				if (turn.signal?.aborted) return;
				if (turnEnded) continue;

				const parsed = parseJson(line, "Claude");
				const event =
					parsed.tag === "event"
						? parsed.event
						: mapClaudeEvent(parsed.value, tools);
				if (!event) continue;
				if (event.kind === "error") sawError = true;
				if (event.kind === "turn_end") turnEnded = true;
				if (event.kind === "session") {
					if (sessionEmitted) continue;
					sessionEmitted = true;
					yield { kind: "session", sessionId };
					continue;
				}
				yield event;
			}
		} catch (error) {
			if (turn.signal?.aborted) return;
			if (!sawError && !turnEnded) {
				sawError = true;
				yield providerError(errorMessage(error));
			}
		}

		if (turn.signal?.aborted || turnEnded) return;
		if (!sessionEmitted && !sawError) {
			yield { kind: "error", message: "Claude did not emit a session id" };
		}
		yield { kind: "turn_end" };
	}
}
