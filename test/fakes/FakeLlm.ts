import type { Llm, LlmRequest } from "../../src/ports/llm";

export class FakeLlm implements Llm {
	requests: LlmRequest[] = [];
	private callIndex = 0;

	constructor(private readonly attempts: string[][] = [["feat: x"]]) {}

	async *generate(req: LlmRequest): AsyncIterable<string> {
		this.requests.push(req);
		const attempt =
			this.attempts[Math.min(this.callIndex, this.attempts.length - 1)] ?? [];
		this.callIndex++;
		for (const chunk of attempt) yield chunk;
	}
}
