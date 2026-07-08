import { PortError } from "../../core/errors";
import type { Llm, LlmRequest } from "../../ports/llm";

export interface OllamaConfig {
	baseUrl: string;
}

interface OllamaChunk {
	response?: string;
	done?: boolean;
}

export class OllamaAdapter implements Llm {
	constructor(private readonly cfg: OllamaConfig) {}

	async *generate(req: LlmRequest): AsyncIterable<string> {
		let res: Response;
		try {
			res = await fetch(`${this.cfg.baseUrl}/api/generate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: req.model,
					system: req.system,
					prompt: req.prompt,
					stream: true,
					think: false,
				}),
			});
		} catch (e) {
			throw new PortError(
				`Cannot reach Ollama daemon at ${this.cfg.baseUrl}: ${String(e)}`,
			);
		}

		if (!res.ok) {
			const text = await res.text();
			if (res.status === 404 || /not found/i.test(text)) {
				throw new PortError(
					`Model "${req.model}" is not pulled. Run: ollama pull ${req.model}`,
					text,
					res.status,
				);
			}
			throw new PortError(
				`Ollama request failed (${res.status})`,
				text,
				res.status,
			);
		}
		if (!res.body)
			throw new PortError("Ollama returned an empty response body");

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex >= 0) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) {
					const chunk = JSON.parse(line) as OllamaChunk;
					if (chunk.response) yield chunk.response;
				}
				newlineIndex = buffer.indexOf("\n");
			}
		}
	}
}
