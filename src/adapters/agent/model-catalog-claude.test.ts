import { describe, expect, test } from "bun:test";
import { CLAUDE_EFFORTS } from "./effort";
import { discoverClaudeModels } from "./model-catalog-claude";

function response(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function modelPage(
	data: Array<{ id: string; display_name?: string }>,
	hasMore: boolean,
	lastId: string | null,
): Response {
	return response({ data, has_more: hasMore, last_id: lastId });
}

describe("discoverClaudeModels", () => {
	test("paginates the Anthropic API and returns unique API models with entitlement caveat", async () => {
		const requests: Array<{
			url: URL;
			headers: Headers;
			redirect: RequestInit["redirect"];
		}> = [];
		const pages = [
			modelPage(
				[{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" }],
				true,
				"claude-sonnet-4-5",
			),
			modelPage(
				[
					{ id: "claude-sonnet-4-5", display_name: "Duplicate Sonnet" },
					{ id: "claude-opus-4-1", display_name: "Claude Opus 4.1" },
				],
				false,
				"claude-opus-4-1",
			),
		];
		const catalog = await discoverClaudeModels({
			apiKey: "secret-key-sentinel",
			fetcher: async (input, init) => {
				requests.push({
					url: new URL(input instanceof Request ? input.url : String(input)),
					headers: new Headers(init?.headers),
					redirect: init?.redirect,
				});
				const next = pages.shift();
				if (!next) throw new Error("Unexpected extra page request");
				return next;
			},
		});
		expect(requests).toHaveLength(2);

		for (const { headers, redirect } of requests) {
			expect(headers.get("x-api-key")).toBe("secret-key-sentinel");
			expect(headers.get("anthropic-version")).toBe("2023-06-01");
			expect(redirect).toBe("error");
		}
		expect(requests[0]?.url.searchParams.has("after_id")).toBe(false);
		expect(requests[0]?.url.searchParams.get("limit")).toBe("1000");
		expect(requests[1]?.url.searchParams.get("after_id")).toBe(
			"claude-sonnet-4-5",
		);
		expect(catalog).toEqual({
			models: [
				{
					id: "claude-sonnet-4-5",
					label: "Claude Sonnet 4.5",
					efforts: [...CLAUDE_EFFORTS],
				},
				{
					id: "claude-opus-4-1",
					label: "Claude Opus 4.1",
					efforts: [...CLAUDE_EFFORTS],
				},
			],
			source: "anthropic-api",
			warning:
				"Anthropic API model availability reflects the API key's entitlement; it does not establish which models the Claude CLI account can access.",
		});
		expect(JSON.stringify(catalog)).not.toContain("secret-key-sentinel");
	});

	test("uses labeled aliases without an API key", async () => {
		let requestCount = 0;
		const catalog = await discoverClaudeModels({
			apiKey: null,
			fetcher: async () => {
				requestCount += 1;
				throw new Error("Should not make a request");
			},
		});

		expect(requestCount).toBe(0);
		expect(catalog.source).toBe("claude-aliases");
		expect(catalog.models.map(({ id }) => id)).toEqual([
			"sonnet",
			"opus",
			"haiku",
		]);
		for (const model of catalog.models) {
			expect(model.efforts).toEqual(CLAUDE_EFFORTS);
		}
		expect(catalog.warning).toBeUndefined();
	});

	test("falls back on failed HTTP responses without returning credentials or response text", async () => {
		const apiKey = "secret-key-sentinel";
		const catalog = await discoverClaudeModels({
			apiKey,
			fetcher: async () =>
				new Response(`error containing ${apiKey}`, { status: 401 }),
		});

		expect(catalog.source).toBe("claude-aliases");
		expect(catalog.warning).toContain("discovery failed");
		expect(JSON.stringify(catalog)).not.toContain(apiKey);
		expect(JSON.stringify(catalog)).not.toContain("error containing");
	});

	test("fails safely on malformed model data", async () => {
		const catalog = await discoverClaudeModels({
			apiKey: "secret-key-sentinel",
			fetcher: async () =>
				response({
					data: [{ id: "not a valid model id" }],
					has_more: false,
				}),
		});

		expect(catalog.source).toBe("claude-aliases");
		expect(catalog.models.map(({ id }) => id)).toEqual([
			"sonnet",
			"opus",
			"haiku",
		]);
	});

	test("fails safely when pagination cycles", async () => {
		let requestCount = 0;
		const catalog = await discoverClaudeModels({
			apiKey: "secret-key-sentinel",
			fetcher: async () => {
				requestCount += 1;
				return modelPage(
					[{ id: "claude-sonnet-4-5" }],
					true,
					"claude-sonnet-4-5",
				);
			},
		});

		expect(requestCount).toBe(2);
		expect(catalog.source).toBe("claude-aliases");
	});

	test("aborts and returns aliases when the total request deadline expires", async () => {
		let signal: AbortSignal | undefined;
		const catalog = await discoverClaudeModels({
			apiKey: "secret-key-sentinel",
			timeoutMs: 5,
			fetcher: async (_input, init) => {
				signal = init?.signal ?? undefined;
				return new Promise<Response>(() => {});
			},
		});

		expect(signal?.aborted).toBe(true);
		expect(catalog.source).toBe("claude-aliases");
		expect(catalog.warning).toContain("exceeded its limits");
	});

	test("stops before exceeding total response bytes", async () => {
		const catalog = await discoverClaudeModels({
			apiKey: "secret-key-sentinel",
			fetcher: async () =>
				response({
					data: [
						{
							id: "claude-sonnet-4-5",
							display_name: "x".repeat(2 * 1024 * 1024),
						},
					],
					has_more: false,
				}),
		});

		expect(catalog.source).toBe("claude-aliases");
	});

	test("stops at the page limit", async () => {
		let requestCount = 0;
		const catalog = await discoverClaudeModels({
			apiKey: "secret-key-sentinel",
			fetcher: async () => {
				requestCount += 1;
				const id = `claude-model-${requestCount}`;
				return modelPage([{ id }], true, id);
			},
		});

		expect(requestCount).toBe(20);
		expect(catalog.source).toBe("claude-aliases");
	});

	test("does not include a thrown fetch error or API key in fallback output", async () => {
		const apiKey = "secret-key-sentinel";
		const catalog = await discoverClaudeModels({
			apiKey,
			fetcher: async () => {
				throw new Error(`request failed with ${apiKey}`);
			},
		});

		expect(catalog.source).toBe("claude-aliases");
		expect(JSON.stringify(catalog)).not.toContain(apiKey);
	});
});
