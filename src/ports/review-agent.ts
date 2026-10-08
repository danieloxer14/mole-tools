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
	/** Absolute read-only directory grant; must stay outside cwd and any writeDir. */
	readDir?: string;
	/** Requested write directory; writeScope controls strict scope enforcement. */
	writeDir?: string;
	/**
	 * Security-sensitive strict tool policy: when set to "directory", scoped-
	 * capable adapters require an absolute writeDir outside cwd and fail closed
	 * when it is absent or invalid. Unsupported adapters use no-shell/no-write
	 * policy only when writeScope is set, remaining restricted read-only then.
	 * Without writeScope, adapters retain legacy generic writeDir behavior;
	 * OMP exposes read, grep, glob, bash, write (not edit) when writeDir is set.
	 */
	writeScope?: "directory";
	/** Aborting this signal stops the current turn. */
	signal?: AbortSignal;
}

export interface ReviewAgent {
	/**
	 * True only when adapter enforces writeScope: "directory". Such adapters
	 * require an absolute writeDir outside cwd and fail closed if it is missing
	 * or invalid. Unsupported adapters are forced into no-shell/no-write only
	 * with writeScope set; without it they retain legacy generic writeDir tools.
	 */
	readonly supportsScopedWrites?: boolean;
	preflight(): Promise<void>;
	run(turn: AgentTurn): AsyncIterable<AgentEvent>;
}
