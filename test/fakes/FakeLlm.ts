import type {
	AgentRequest,
	AgentResult,
	GenerateRequest,
	Llm,
	LlmCapability,
} from "../../src/ports/llm";

export interface FakeLlmOptions {
	/** Array of attempt sequences for text generation */
	generationAttempts?: string[][];
	/** Scripted agent results. Each entry = one runAgent call. */
	agentResults?: AgentResult[];
	/** Capabilities to advertise. Defaults to both. */
	capabilitiesOverride?: LlmCapability[];
}

export class FakeLlm implements Llm {
	requests: GenerateRequest[] = [];
	agentRequests: AgentRequest[] = [];
	private callIndex = 0;
	private agentCallIndex = 0;
	private attempts: string[][];
	private agentResultsList: AgentResult[];
	private capsOverride?: LlmCapability[];

	constructor(input?: FakeLlmOptions | string[][]) {
		if (Array.isArray(input) || !input) {
			// Legacy constructor: FakeLlm([[...], [...], ...]) or FakeLlm()
			this.attempts = Array.isArray(input) ? input : [["feat: x"]];
			this.agentResultsList = [{ output: "done", ok: true }];
		} else {
			// New constructor: FakeLlm({ generationAttempts, agentResults, capabilitiesOverride })
			this.attempts = input.generationAttempts ?? [["feat: x"]];
			this.agentResultsList = input.agentResults ?? [
				{ output: "done", ok: true },
			];
			this.capsOverride = input.capabilitiesOverride;
		}
	}

	capabilities(): LlmCapability[] {
		return this.capsOverride ?? ["text-generation", "agentic-workspace"];
	}

	async *generate(req: GenerateRequest): AsyncIterable<string> {
		this.requests.push(req);
		const attempt =
			this.attempts[Math.min(this.callIndex, this.attempts.length - 1)] ?? [];
		this.callIndex++;
		for (const chunk of attempt) yield chunk;
	}

	async runAgent(req: AgentRequest): Promise<AgentResult> {
		this.agentRequests.push(req);
		const result =
			this.agentResultsList[
				Math.min(this.agentCallIndex, this.agentResultsList.length - 1)
			] ?? ({ output: "done", ok: true } as AgentResult);
		this.agentCallIndex++;
		return result;
	}

	/** Return a FakeLlm that rejects agentic-workspace */
	static textOnly(): FakeLlm {
		return new FakeLlm({ capabilitiesOverride: ["text-generation"] });
	}
}
