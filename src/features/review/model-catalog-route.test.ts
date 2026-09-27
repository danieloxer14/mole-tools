import { describe, expect, test } from "bun:test";
import type { OmpModelCatalogProcessRunner } from "../../adapters/agent/model-catalog-omp";
import { createReviewRoutes } from "./routes";

const TOKEN = "model-catalog-route-token";
const encoder = new TextEncoder();

function request(path: string): Request {
	return new Request(`http://127.0.0.1${path}`);
}

describe("model catalog route", () => {
	test("requires route token and rejects missing, invalid, or ambiguous agents", async () => {
		let discoveryCalls = 0;
		const runner: OmpModelCatalogProcessRunner = async () => {
			discoveryCalls += 1;
			return {
				stdout: encoder.encode('{"models":[]}'),
				stderr: new Uint8Array(),
				exitCode: 0,
			};
		};
		const routes = createReviewRoutes({
			token: TOKEN,
			ompModelCatalogProcessRunner: runner,
		});

		const unauthorized = await routes(
			request("/api/settings/models?agent=omp"),
		);
		expect(unauthorized.status).toBe(401);

		for (const path of [
			`/api/settings/models?t=${TOKEN}`,
			`/api/settings/models?agent=codex&t=${TOKEN}`,
			`/api/settings/models?agent=omp&agent=claude&t=${TOKEN}`,
		]) {
			const invalid = await routes(request(path));
			expect(invalid.status).toBe(400);
			expect(await invalid.json()).toEqual({ error: "Invalid agent" });
		}
		expect(discoveryCalls).toBe(0);
	});

	test("discovers OMP models using configured binary and returns catalog contract", async () => {
		const config = {
			review: {
				agent: "omp" as const,
				binary: "/custom path/omp",
				model: "saved-model",
			},
		};
		const originalConfig = structuredClone(config);
		let invocation:
			| {
					binary: string;
					args: string[];
					cwd: string;
					timeoutMs: number;
					maxOutputBytes: number;
			  }
			| undefined;
		const runner: OmpModelCatalogProcessRunner = async (
			binary,
			args,
			options,
		) => {
			invocation = { binary, args: [...args], ...options };
			return {
				stdout: encoder.encode(
					JSON.stringify({
						models: [
							{
								selector: "omp-model-a",
								thinking: ["minimal", "ultra", "high"],
							},
						],
					}),
				),
				stderr: new Uint8Array(),
				exitCode: 0,
			};
		};
		const routes = createReviewRoutes({
			token: TOKEN,
			config,
			ompModelCatalogProcessRunner: runner,
		});

		const response = await routes(
			request(`/api/settings/models?agent=omp&t=${TOKEN}`),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			models: [
				{
					id: "omp-model-a",
					label: "omp-model-a",
					efforts: ["minimal", "high"],
				},
			],
			source: "omp",
		});
		expect(invocation).toEqual({
			binary: "/custom path/omp",
			args: ["models", "--json"],
			cwd: process.cwd(),
			timeoutMs: 5_000,
			maxOutputBytes: 2 * 1024 * 1024,
		});
		expect(config).toEqual(originalConfig);
	});

	test("discovers Claude API models with server key without serializing key", async () => {
		const previousKey = process.env.ANTHROPIC_API_KEY;
		const apiKey = "server-only-key-sentinel";
		process.env.ANTHROPIC_API_KEY = apiKey;
		try {
			const requestHeaders: Headers[] = [];
			const fetcher: typeof fetch = async (_input, init) => {
				requestHeaders.push(new Headers(init?.headers));
				return new Response(
					JSON.stringify({
						data: [
							{ id: "claude-api-model", display_name: "Claude API Model" },
						],
						has_more: false,
						last_id: null,
					}),
					{ headers: { "content-type": "application/json" } },
				);
			};
			const routes = createReviewRoutes({
				token: TOKEN,
				claudeModelCatalogFetcher: fetcher,
			});

			const response = await routes(
				request(`/api/settings/models?agent=claude&t=${TOKEN}`),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({
				models: [
					{
						id: "claude-api-model",
						label: "Claude API Model",
						efforts: ["low", "medium", "high", "xhigh", "max"],
					},
				],
				source: "anthropic-api",
				warning:
					"Anthropic API model availability reflects the API key's entitlement; it does not establish which models the Claude CLI account can access.",
			});
			expect(requestHeaders).toHaveLength(1);
			expect(requestHeaders[0]?.get("x-api-key")).toBe(apiKey);
			expect(requestHeaders[0]?.get("anthropic-version")).toBe("2023-06-01");
			expect(JSON.stringify(body)).not.toContain(apiKey);
		} finally {
			if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
			else process.env.ANTHROPIC_API_KEY = previousKey;
		}
	});

	test("uses labeled Claude aliases when server key is absent", async () => {
		const previousKey = process.env.ANTHROPIC_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		try {
			let fetchCalls = 0;
			const routes = createReviewRoutes({
				token: TOKEN,
				claudeModelCatalogFetcher: async () => {
					fetchCalls += 1;
					throw new Error("fetch must not run without a key");
				},
			});

			const response = await routes(
				request(`/api/settings/models?agent=claude&t=${TOKEN}`),
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				models: Array<{ id: string; label: string; efforts: string[] }>;
				source: string;
				warning?: string;
			};
			expect(body.source).toBe("claude-aliases");
			expect(body.models.map(({ id }) => id)).toEqual([
				"sonnet",
				"opus",
				"haiku",
			]);
			expect(
				body.models.every(({ label }) => label.includes("Claude CLI alias")),
			).toBe(true);
			expect(body.warning).toBeUndefined();
			expect(fetchCalls).toBe(0);
		} finally {
			if (previousKey !== undefined)
				process.env.ANTHROPIC_API_KEY = previousKey;
		}
	});

	test("sanitizes OMP discovery failures without changing saved model config", async () => {
		const secret = "process-error-secret-sentinel";
		const config = {
			review: {
				agent: "omp" as const,
				binary: "/custom path/omp",
				model: "saved-model",
			},
		};
		const originalConfig = structuredClone(config);
		const runner: OmpModelCatalogProcessRunner = async () => {
			throw new Error(`process failed for ${secret}`);
		};
		const routes = createReviewRoutes({
			token: TOKEN,
			config,
			ompModelCatalogProcessRunner: runner,
		});

		const response = await routes(
			request(`/api/settings/models?agent=omp&t=${TOKEN}`),
		);
		expect(response.status).toBe(503);
		const error = await response.text();
		expect(error).toContain("OMP model discovery failed");
		expect(error).toContain("retry");
		expect(error).not.toContain(secret);
		expect(error).not.toContain("saved-model");
		expect(config).toEqual(originalConfig);

		const settings = await routes(request(`/api/settings?t=${TOKEN}`));
		expect(settings.status).toBe(200);
		expect((await settings.json()).review.model).toBe("saved-model");
	});
});
