import { describe, expect, test } from "bun:test";
import { OllamaAdapter } from "../adapters/llm/ollama";
import { PiAdapter } from "../adapters/llm/pi";
import { UnsupportedCapabilityError } from "./llm";

describe("Llm port contract", () => {
	test("OllamaAdapter implements the Llm interface shape", () => {
		const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
		expect(typeof adapter.capabilities).toBe("function");
		expect(typeof adapter.generate).toBe("function");
		expect(typeof adapter.runAgent).toBe("function");
	});

	test("PiAdapter implements the Llm interface shape", () => {
		const adapter = new PiAdapter({ binary: "pi" });
		expect(typeof adapter.capabilities).toBe("function");
		expect(typeof adapter.generate).toBe("function");
		expect(typeof adapter.runAgent).toBe("function");
	});

	test("UnsupportedCapabilityError carries the capability name", () => {
		const err = new UnsupportedCapabilityError("agentic-workspace", "ollama");
		expect(err.name).toBe("UnsupportedCapabilityError");
		expect(err.capability).toBe("agentic-workspace");
		expect(err.message).toContain("ollama");
		expect(err.message).toContain("agentic-workspace");
	});

	test("OllamaAdapter rejects agentic-workspace before any network request", async () => {
		globalThis.fetch = (() => {
			throw new Error("fetch should not be called");
		}) as unknown as typeof fetch;

		const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
		try {
			await adapter.runAgent({
				purpose: "ralph",
				model: "claude",
				workspace: ".",
				permissionPolicy: "confirm-all",
				systemPromptMode: "replace",
				prompt: "do thing",
			});
			expect.fail("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(UnsupportedCapabilityError);
		} finally {
			globalThis.fetch = global.fetch;
		}
	});

	test("PiAdapter capabilities include both text-generation and agentic-workspace", () => {
		const caps = new PiAdapter({ binary: "pi" }).capabilities();
		expect(caps).toContain("text-generation");
		expect(caps).toContain("agentic-workspace");
	});

	test("OllamaAdapter capabilities include only text-generation", () => {
		const caps = new OllamaAdapter({ baseUrl: "http://localhost:11434" }).capabilities();
		expect(caps).toEqual(["text-generation"]);
	});
});
