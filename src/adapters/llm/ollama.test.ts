import { afterEach, describe, expect, test } from "bun:test";
import { CostTracker } from "../../core/cost-tracker";
import { PortError } from "../../core/errors";
import { UnsupportedCapabilityError } from "../../ports/llm";
import { OllamaAdapter } from "./ollama";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function ndjsonStream(chunks: object[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks)
				controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
			controller.close();
		},
	});
}

describe("OllamaAdapter", () => {
	test("reports text-generation capability", () => {
		const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
		expect(adapter.capabilities()).toEqual(["text-generation"]);
	});

	test("posts model/system/prompt to /api/generate and yields streamed tokens", async () => {
		let capturedUrl = "";
		let capturedBody = "";
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			capturedUrl = String(url);
			capturedBody = String(init?.body);
			return new Response(
					ndjsonStream([
							{ response: "feat", done: false },
							{ response: ": add x", done: false },
							{ done: true },
						]),
					{ status: 200 },
				);
			}) as unknown as typeof fetch;

		const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
		const tokens: string[] = [];
		for await (const token of adapter.generate({
			model: "llama3.1",
			system: "sys",
			prompt: "diff",
			task: "commit-message",
		})) {
			tokens.push(token);
			}

		expect(tokens.join("")).toBe("feat: add x");
		expect(capturedUrl).toBe("http://localhost:11434/api/generate");
		expect(JSON.parse(capturedBody)).toEqual({
					model: "llama3.1",
				system: "sys",
				prompt: "diff",
				stream: true,
			think: false,
			});
	});

	test("records llm cost using Ollama's reported token counts", async () => {
		globalThis.fetch = (async () =>
			new Response(
				ndjsonStream([
						{ response: "feat: add x", done: false },
						{ done: true, prompt_eval_count: 42, eval_count: 7 },
					]),
					{ status: 200 },
				)) as unknown as typeof fetch;

		const costTracker = new CostTracker();
		const adapter = new OllamaAdapter(
			{ baseUrl: "http://localhost:11434" },
			costTracker,
			);
		for await (const _ of adapter.generate({
				model: "llama3.1",
					system: "sys",
				prompt: "diff",
				task: "commit-message",
			})) {
				// drain
			}

		expect(costTracker.getEntries()).toEqual([
					{
						type: "llm",
						task: "commit-message",
						inputTokens: 42,
						outputTokens: 7,
					},
				]);
	});

	test("falls back to estimated tokens when Ollama omits eval counts", async () => {
		globalThis.fetch = (async () =>
			new Response(
				ndjsonStream([{ response: "hi", done: false }, { done: true }]),
					{ status: 200 },
				)) as unknown as typeof fetch;

		const costTracker = new CostTracker();
		const adapter = new OllamaAdapter(
			{ baseUrl: "http://localhost:11434" },
			costTracker,
			);
		for await (const _ of adapter.generate({
				model: "llama3.1",
					system: "sys",
				prompt: "diff",
				task: "commit-message",
			})) {
				// drain
			}

		expect(costTracker.getEntries()).toEqual([
					{
						type: "llm",
						task: "commit-message",
						inputTokens: 2,
						outputTokens: 1,
					},
				 ]);
	});

	test("records identical calls as separate entries with same raw token counts", async () => {
		globalThis.fetch = (async () =>
			new Response(
				ndjsonStream([
					{ response: "feat: add x", done: false },
						{ done: true, prompt_eval_count: 42, eval_count: 7 },
					]),
					{ status: 200 },
				)) as unknown as typeof fetch;

		const costTracker = new CostTracker();
		const adapter = new OllamaAdapter(
				{ baseUrl: "http://localhost:11434" },
			costTracker,
			);
		const request = {
				model: "llama3.1",
					system: "sys",
				prompt: "diff",
				task: "commit-message",
				};
		for await (const _ of adapter.generate(request)) {
				// drain: first attempt
			}
		for await (const _ of adapter.generate(request)) {
				 // drain: retry with the identical prompt
			}

		expect(costTracker.getEntries()).toEqual([
				 {
					type: "llm",
						task: "commit-message",
					inputTokens: 42,
					outputTokens: 7,
				},
					{
					type: "llm",
						task: "commit-message",
					inputTokens: 42,
					outputTokens: 7,
				 },
				]);
	});

	test("throws PortError with the base URL when the daemon is unreachable", async () => {
		globalThis.fetch = (async () => {
			throw new Error("ECONNREFUSED");
			}) as unknown as typeof fetch;

		const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
		const iterate = async () => {
				for await (const _ of adapter.generate({
					model: "llama3.1",
						system: "s",
					prompt: "p",
				task: "commit-message",
				})) {
					 // drain
				}
			};
		await expect(iterate()).rejects.toThrow(PortError);
		await expect(iterate()).rejects.toThrow(/localhost:11434/);
	});

	test("throws PortError with a pull hint when the model is not pulled", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					error: "model 'ghost' not found, try pulling it first",
					}),
					{
					status: 404,
					 },
					)) as unknown as typeof fetch;

		const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
		const iterate = async () => {
				for await (const _ of adapter.generate({
					model: "ghost",
						system: "s",
					prompt: "p",
					task: "commit-message",
				})) {
					 // drain
			}
			};
		await expect(iterate()).rejects.toThrow(/ollama pull ghost/);
	});

	test("throws UnsupportedCapabilityError for agentic-workspace", async () => {
		const adapter = new OllamaAdapter({ baseUrl: "http://localhost:11434" });
		const agentReq = {
			purpose: "ralph",
			model: "claude-sonnet",
			workspace: ".",
			permissionPolicy: "auto-approve" as const,
			systemPromptMode: "replace" as const,
			prompt: "do something",
		};

		try {
			await adapter.runAgent(agentReq);
			expect.fail("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(UnsupportedCapabilityError);
			expect((e as Error).message).toContain("agentic-workspace");
			expect((e as any).capability).toBe("agentic-workspace");
		}
	});
});
