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
