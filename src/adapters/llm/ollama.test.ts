import { afterEach, describe, expect, test } from "bun:test";
import { PortError } from "../../core/errors";
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
			})) {
				// drain
			}
		};
		await expect(iterate()).rejects.toThrow(/ollama pull ghost/);
	});
});
