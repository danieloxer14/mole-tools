import { describe, expect, test } from "bun:test";
import { OllamaAdapter } from "../adapters/llm/ollama";
import { PiAdapter } from "../adapters/llm/pi";

describe("Llm port contract", () => {
	test("OllamaAdapter implements the generate contract", () => {
		const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
		expect(typeof adapter.generate).toBe("function");
	});

	test("PiAdapter implements the generate contract", () => {
		const adapter = new PiAdapter({ binary: "pi" });
		expect(typeof adapter.generate).toBe("function");
	});
});
