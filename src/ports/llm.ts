export interface LlmRequest {
	system: string;
	prompt: string;
	model: string;
	task: string;
}

export interface Llm {
	generate(req: LlmRequest): AsyncIterable<string>;
}
