// ─── Capability values ──────────────────────────────────────────────────

export type LlmCapability = "text-generation" | "agentic-workspace";

// ─── Unsupported capability error ──────────────────────────────────────

export class UnsupportedCapabilityError extends Error {
	readonly capability: LlmCapability;

	constructor(capability: LlmCapability, provider: string) {
		super(`Provider "${provider}" does not support capability: ${capability}`);
		this.name = "UnsupportedCapabilityError";
		this.capability = capability;
	}
}

// ─── Generation request (text-only) ─────────────────────────────────────

export interface GenerateRequest {
	model: string;
	system: string;
	prompt: string;
	task: string;
}

// Renamed from LlmRequest for clarity but kept alias for backward compat
export type LlmRequest = GenerateRequest;

// ─── System prompt override mode ───────────────────────────────────────

export type SystemPromptMode = "replace" | "append";

// ─── Permission policy (semantic, provider-agnostic) ────────────────────

export type PermissionPolicy = "auto-approve" | "confirm-all";

// ─── Agent request (workspace-agent flows) ──────────────────────────────

export interface AgentRequest {
	/** What this agent run is for — maps to a configured provider profile */
	purpose: string;

	/** Optional persisted provider selection for resuming Ralph loops.
	 *    "ollama", "pi", etc. If omitted, buildContext resolves from purpose config. */
	providerKey?: string;

	model: string;
	workspace: string;
	permissionPolicy: PermissionPolicy;
	/** How to treat the provided prompt against the adapter's default system prompt */
	systemPromptMode: SystemPromptMode;
	prompt: string;
	signal?: AbortSignal;
}

// ─── Agent execution result ─────────────────────────────────────────────

export interface AgentResult {
	/** Full stdout captured from the agent process */
	output: string;
	/** Diagnostics / stderr from the agent process */
	stderr?: string;
	/** Whether the agent completed successfully (non-zero exit = failure) */
	ok: boolean;
}

// ─── Llm port interface ────────────────────────────────────────────────

export interface Llm {
	/** Which capabilities this adapter supports */
	capabilities(): LlmCapability[];

	generate(req: GenerateRequest): AsyncIterable<string>;

	runAgent(req: AgentRequest): Promise<AgentResult>;
}
