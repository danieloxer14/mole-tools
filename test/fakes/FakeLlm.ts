import type { GenerateRequest, Llm } from "../../src/ports/llm";

export interface FakeLlmOptions {
	/** Array of attempt sequences for text generation. */
	generationAttempts?: string[][];
}

export class FakeLlm implements Llm {
	requests: GenerateRequest[] = [];
	private callIndex = 0;
	private attempts: string[][];

	constructor(input?: FakeLlmOptions | string[][]) {
		if (Array.isArray(input) || !input) {
			this.attempts = Array.isArray(input) ? input : [["feat: x"]];
		} else {
			this.attempts = input.generationAttempts ?? [["feat: x"]];
		}
	}

	async *generate(req: GenerateRequest): AsyncIterable<string> {
		this.requests.push(req);
		const attempt =
			this.attempts[Math.min(this.callIndex, this.attempts.length - 1)] ?? [];
		this.callIndex++;
		for (const chunk of attempt) yield chunk;
	}
}
