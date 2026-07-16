const defaultUsage = () => ({
	inputTokens: 100,
	outputTokens: 50,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	source: "estimated" as const,
});

const defaultUsdCost = () => ({ source: "estimated" as const, amount: 0 });

export type FakeLlmResult = {
	output: string;
	ok: boolean;
	provider?: string;
	model?: string;
	stderr?: string;
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		source: "reported" | "estimated";
	};
	usdCost?: AgentResult["usdCost"];
	providerSessionId?: string;
};

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
	/** Scripted normalized agent results. Each entry = one runAgent call. */
	agentResults?: FakeLlmResult[];
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
			this.agentResultsList = [this.normalizeResult({ output: "done", ok: true })];
		} else {
			// New constructor: FakeLlm({ generationAttempts, agentResults, capabilitiesOverride })
			this.attempts = input.generationAttempts ?? [["feat: x"]];
			this.agentResultsList = (input.agentResults ?? [{ output: "done", ok: true }]).map(
				(result) => this.normalizeResult(result),
			);
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
			] ?? this.normalizeResult({ output: "done", ok: true });
		this.agentCallIndex++;
		return result;
	}

	private normalizeResult(result: FakeLlmResult): AgentResult {
		return {
			...result,
			usage: result.usage
				? {
					...result.usage,
					cacheReadTokens: result.usage.cacheReadTokens ?? 0,
					cacheWriteTokens: result.usage.cacheWriteTokens ?? 0,
				}
				: defaultUsage(),
			usdCost: result.usdCost ?? defaultUsdCost(),
		};
	}

	/** Return a FakeLlm that rejects agentic-workspace */
	static textOnly(): FakeLlm {
		return new FakeLlm({ capabilitiesOverride: ["text-generation"] });
	}
}
