export interface GenerateRequest {
	/** Selected provider route, supplied by the composition/router. */
	providerKey?: string;
	model: string;
	system: string;
	prompt: string;
	signal?: AbortSignal;
}

export interface Llm {
	generate(req: GenerateRequest): AsyncIterable<string>;
}
