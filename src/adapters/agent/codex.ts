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

export interface CodexAgentOptions {
	binary?: string;
	model?: string;
	exec?: AgentExec;
}

function tomlBasicString(text: string): string {
	let result = '"';
	for (const character of text.toWellFormed()) {
		switch (character) {
			case "\\":
				result += "\\\\";
				break;
			case '"':
				result += '\\"';
				break;
			case "\b":
				result += "\\b";
				break;
			case "\t":
				result += "\\t";
				break;
			case "\n":
				result += "\\n";
				break;
			case "\f":
				result += "\\f";
				break;
			case "\r":
				result += "\\r";
				break;
			default: {
				const codePoint = character.codePointAt(0);
				if (
					codePoint !== undefined &&
					((codePoint >= 0 && codePoint <= 0x1f) || codePoint === 0x7f)
				) {
					result += `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
				} else {
					result += character;
				}
			}
		}
	}
	return `${result}"`;
}

function codexToolName(item: JsonRecord, itemType: string): string | null {
	switch (itemType) {
		case "command_execution":
			return "bash";
		case "mcp_tool_call":
			return typeof item.tool === "string" && item.tool.length > 0
				? item.tool
				: "mcp";
		case "web_search":
			return "web_search";
		case "collab_tool_call":
			return typeof item.tool === "string" && item.tool.length > 0
				? item.tool
				: "collab";
		default:
			return null;
	}
}

function mapCodexEvent(
	value: JsonRecord,
	state: { textEmitted: boolean },
): AgentEvent | null {
	const type = value.type;
	if (typeof type !== "string") return diagnostic(null, value);

	switch (type) {
		case "thread.started": {
			const threadId = value.thread_id;
			if (typeof threadId !== "string" || threadId.length === 0) {
				return malformed("Codex", "thread.started requires a string thread_id");
			}
			return { kind: "session", sessionId: threadId };
		}
		case "turn.started":
		case "item.updated":
			return null;
		case "item.started":
		case "item.completed": {
			const rawItem = value.item;
			if (
				rawItem === null ||
				typeof rawItem !== "object" ||
				Array.isArray(rawItem)
			) {
				return malformed("Codex", "item event requires an item object");
			}
			const item = rawItem as JsonRecord;
			const itemType = typeof item.type === "string" ? item.type : null;
			if (type === "item.started") {
				if (itemType === null) return null;
				const name = codexToolName(item, itemType);
				if (name === null) return null;
				state.textEmitted = false;
				return { kind: "tool", name, phase: "start" };
			}

			if (itemType === "agent_message") {
				if (typeof item.text !== "string") {
					return malformed("Codex", "agent_message requires string text");
				}
				const delta = state.textEmitted ? `\n\n${item.text}` : item.text;
				state.textEmitted = true;
				return { kind: "text", delta };
			}
			if (itemType !== null) {
				const name = codexToolName(item, itemType);
				if (name !== null) {
					state.textEmitted = false;
					return { kind: "tool", name, phase: "end" };
				}
				if (itemType === "file_change") {
					state.textEmitted = false;
					return { kind: "tool", name: "apply_patch", phase: "end" };
				}
				if (
					itemType === "reasoning" ||
					itemType === "todo_list" ||
					itemType === "error"
				) {
					return null;
				}
			}
			return diagnostic(itemType, value);
		}
		case "turn.completed":
			return { kind: "turn_end" };
		case "turn.failed":
			return {
				kind: "error",
				message:
					nestedMessage(value.error, ["message", "error", "detail"]) ??
					"Codex turn failed",
			};
		default:
			return diagnostic(type, value);
	}
}

export class CodexAgentAdapter implements ReviewAgent {
	private readonly binary: string;
	private readonly model?: string;
	private readonly execFn: AgentExec;

	constructor(
		execOrOptions: AgentExec | CodexAgentOptions = defaultAgentExec,
		options: CodexAgentOptions = {},
	) {
		const config = resolveAgentConfig(execOrOptions, options, "codex");
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

		const sandbox = turn.writeDir ? "workspace-write" : "read-only";
		const args = [
			"exec",
			"--json",
			"--skip-git-repo-check",
			"-C",
			turn.cwd,
			"--sandbox",
			sandbox,
		];
		args.push(
			"-c",
			`projects={${tomlBasicString(turn.cwd)}={trust_level="untrusted"}}`,
		);
		if (this.model) args.push("-m", this.model);
		args.push("-c", `developer_instructions=${tomlBasicString(systemPrompt)}`);
		if (turn.writeDir) args.push("--add-dir", turn.writeDir);
		if (turn.sessionId) {
			args.push("resume", turn.sessionId, "--", turn.message);
		} else {
			args.push("--", turn.message);
		}

		let lastSessionId: string | null = null;
		let sessionEmitted = false;
		let sawError = false;
		let turnEnded = false;
		let pendingError: string | null = null;
		const state = { textEmitted: false };

		if (turn.sessionId) {
			yield { kind: "session", sessionId: turn.sessionId };
			lastSessionId = turn.sessionId;
			sessionEmitted = true;
		}

		try {
			for await (const line of this.execFn(this.binary, args, {
				cwd: turn.cwd,
				signal: turn.signal,
			})) {
				if (turn.signal?.aborted) return;
				if (turnEnded) continue;

				const parsed = parseJson(line, "Codex");
				if (parsed.tag === "provider" && parsed.value.type === "error") {
					pendingError = nestedMessage(parsed.value.message ?? parsed.value, [
						"message",
						"error",
						"detail",
					]);
					continue;
				}
				const event =
					parsed.tag === "event"
						? parsed.event
						: mapCodexEvent(parsed.value, state);
				if (!event) continue;
				if (event.kind === "session") {
					if (event.sessionId === lastSessionId) continue;
					yield event;
					lastSessionId = event.sessionId;
					sessionEmitted = true;
					continue;
				}
				if (event.kind === "error") sawError = true;
				if (event.kind === "turn_end") turnEnded = true;
				yield event;
			}
		} catch (error) {
			if (turn.signal?.aborted) return;
			if (!sawError && !turnEnded) {
				sawError = true;
				yield {
					kind: "error",
					message: pendingError ?? errorMessage(error),
				};
			}
		}

		if (turn.signal?.aborted || turnEnded) return;
		if (!sawError && pendingError) {
			yield { kind: "error", message: pendingError };
			sawError = true;
		}
		if (!sessionEmitted && !sawError) {
			yield { kind: "error", message: "Codex did not emit a session id" };
		}
		yield { kind: "turn_end" };
	}
}
