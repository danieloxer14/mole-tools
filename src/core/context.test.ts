import { expect, test } from "bun:test";
import { FakeUiPort } from "../../test/fakes/FakeUiPort";
import { ConfigSchema } from "../adapters/config/schema";
import type { GenerateRequest, Llm } from "../ports/llm";
import { buildContext, RoutingLlmProxy } from "./context";

const config = ConfigSchema.parse({
	providers: {
		commit: { provider: "ollama", baseUrl: "http://commit" },
		reviewer: { provider: "ollama", baseUrl: "http://reviewer" },
	},
	models: {
		commit: { provider: "commit", name: "commit-model" },
		mergeRequest: { provider: "reviewer", name: "mr-model" },
	},
	jira: { enabled: false },
	diff: { ignore: [] },
});

function fakeLlm(): Llm {
	return {
		generate: async function* () {},
	};
}

test("routes and caches commit and mergeRequest LLM proxies", () => {
	const commitAdapter = fakeLlm();
	const mergeRequestAdapter = fakeLlm();
	const proxy = new RoutingLlmProxy(
		new Map([
			["commit", commitAdapter],
			["reviewer", mergeRequestAdapter],
		]),
		config,
	);

	expect(proxy.getLlmFor("commit").adapter).toBe(commitAdapter);
	const first = proxy.getLlmFor("mergeRequest");
	expect(first.adapter).toBe(mergeRequestAdapter);
	expect(first).toBe(proxy.getLlmFor("mergeRequest"));
});

test("keeps explicit provider routing", () => {
	const commitAdapter = fakeLlm();
	const reviewerAdapter = fakeLlm();
	const proxy = new RoutingLlmProxy(
		new Map([
			["commit", commitAdapter],
			["reviewer", reviewerAdapter],
		]),
		config,
	);

	expect(proxy.getLlmFor("mergeRequest", "reviewer").adapter).toBe(
		reviewerAdapter,
	);
});
test("routes default generation and reports missing provider adapters", async () => {
	const request: GenerateRequest = {
		model: "commit-model",
		system: "system",
		prompt: "prompt",
	};
	const commitAdapter: Llm = {
		generate: async function* (req) {
			yield req.prompt;
		},
	};
	const proxy = new RoutingLlmProxy(
		new Map([
			["commit", commitAdapter],
			["reviewer", fakeLlm()],
		]),
		config,
	);
	const chunks: string[] = [];
	for await (const chunk of proxy.generate(request)) chunks.push(chunk);
	expect(chunks).toEqual(["prompt"]);

	const missing = new RoutingLlmProxy(new Map(), config);
	expect(() => missing.generate(request)).toThrow(
		'No adapter wired for provider "commit"',
	);
});

test("buildContext wires Ollama and Pi provider profiles", () => {
	const builtConfig = ConfigSchema.parse({
		providers: {
			ollama: { baseUrl: "http://localhost:11434" },
			pi: { binary: "pi", projectRoot: "/tmp" },
		},
		models: {
			commit: { provider: "ollama", name: "commit-model" },
			mergeRequest: { provider: "pi", name: "mr-model" },
		},
		jira: { enabled: false },
		diff: { ignore: [] },
	});
	const context = buildContext({
		config: builtConfig,
		ui: new FakeUiPort(),
	});

	expect(context.getLlmFor("commit")).toBe(context.getLlmFor("commit"));
	expect(context.getLlmFor("mergeRequest")).toBe(
		context.getLlmFor("mergeRequest"),
	);
});
