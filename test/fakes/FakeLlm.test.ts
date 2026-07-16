import { describe, expect, test } from "bun:test";
import { FakeLlm } from "./FakeLlm";

describe("FakeLlm normalized results", () => {
	test("returns configured provider, model, session, usage, and USD provenance", async () => {
		const result = await new FakeLlm({
			agentResults: [{
				output: "done",
				ok: true,
				provider: "ollama",
				model: "llama3.1",
				providerSessionId: "session-1",
				usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0, source: "reported" },
				usdCost: { source: "zero", amount: 0 },
			}],
		}).runAgent({
			purpose: "test", model: "llama3.1", workspace: ".",
			permissionPolicy: "auto-approve", systemPromptMode: "replace", prompt: "x",
		});

		expect(result).toMatchObject({
			provider: "ollama",
			model: "llama3.1",
			providerSessionId: "session-1",
			usage: { source: "reported", cacheReadTokens: 1 },
			usdCost: { source: "zero", amount: 0 },
		});
	});

	test("preserves every normalized USD provenance outcome", async () => {
		const usdCosts = [
			{ source: "actual" as const, amount: 0.12 },
			{ source: "estimated" as const, amount: 0.03 },
			{ source: "zero" as const, amount: 0 },
			{ source: "unavailable" as const },
		];
		const llm = new FakeLlm({
			agentResults: usdCosts.map((usdCost, index) => ({
				output: `result-${index}`,
				ok: true,
				provider: "test-provider",
				model: "test-model",
				providerSessionId: `session-${index}`,
				usage: { inputTokens: index + 1, outputTokens: 2, source: "reported" as const },
				usdCost,
			})),
		});

		for (const expected of usdCosts) {
			const result = await llm.runAgent({
				purpose: "test", model: "test-model", workspace: ".",
				permissionPolicy: "auto-approve", systemPromptMode: "replace", prompt: "x",
			});
			expect(result.usdCost).toEqual(expected);
		}
	});
});
