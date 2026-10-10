import { expect, test } from "bun:test";
import { FakeNotifier } from "../../test/fakes/FakeNotifier";
import { FakeReviewAgent } from "../../test/fakes/FakeReviewAgent";
import { FakeUiPort } from "../../test/fakes/FakeUiPort";
import { ClaudeAgentAdapter } from "../adapters/agent/claude";
import { CodexAgentAdapter } from "../adapters/agent/codex";
import { OmpAgentAdapter } from "../adapters/agent/omp";
import { ConfigSchema } from "../adapters/config/schema";
import { GhAdapter } from "../adapters/git-host/gh";
import { GlabAdapter } from "../adapters/git-host/glab";
import { SlackWebhookNotifier } from "../adapters/notifier/slack-webhook";
import type { GenerateRequest, Llm } from "../ports/llm";
import {
	buildContext,
	RoutingLlmProxy,
	resolveReviewAgentConfig,
} from "./context";

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

test("selects the configured review agent and accepts an override", () => {
	const defaultContext = buildContext({
		config,
		ui: new FakeUiPort(),
	});
	expect(defaultContext.createReviewAgent()).toBeInstanceOf(ClaudeAgentAdapter);

	const ompConfig = ConfigSchema.parse({
		...config,
		review: { agent: "omp" },
	});
	const ompContext = buildContext({
		config: ompConfig,
		ui: new FakeUiPort(),
	});
	expect(ompContext.createReviewAgent()).toBeInstanceOf(OmpAgentAdapter);
	expect(defaultContext.createReviewAgent({ agent: "omp" })).toBeInstanceOf(
		OmpAgentAdapter,
	);

	const claudeConfig = ConfigSchema.parse({
		...config,
		review: { agent: "claude" },
	});
	const claudeContext = buildContext({
		config: claudeConfig,
		ui: new FakeUiPort(),
	});
	expect(claudeContext.createReviewAgent()).toBeInstanceOf(ClaudeAgentAdapter);

	const codexConfig = ConfigSchema.parse({
		...config,
		review: { agent: "codex", model: "gpt-6-sol", effort: "ultra" },
	});
	const codexContext = buildContext({
		config: codexConfig,
		ui: new FakeUiPort(),
	});
	expect(codexContext.createReviewAgent()).toBeInstanceOf(CodexAgentAdapter);
	expect(resolveReviewAgentConfig(codexConfig)).toEqual({
		agent: "codex",
		binary: "codex",
		model: "gpt-6-sol",
		effort: "ultra",
	});
	expect(
		defaultContext.createReviewAgent({
			agent: "codex",
			model: "gpt-6-astra",
			effort: "high",
		}),
	).toBeInstanceOf(CodexAgentAdapter);
	expect(defaultContext.createReviewAgent({ agent: "codex" })).toBeInstanceOf(
		CodexAgentAdapter,
	);

	const fake = new FakeReviewAgent();
	const overriddenContext = buildContext({
		config: claudeConfig,
		ui: new FakeUiPort(),
		reviewAgent: fake,
	});
	expect(overriddenContext.createReviewAgent()).toBe(fake);
	expect(overriddenContext.createReviewAgent({ agent: "omp" })).toBe(fake);
});
test("override decides the model without inheriting configured model", () => {
	const configuredConfig = ConfigSchema.parse({
		...config,
		review: {
			agent: "omp",
			binary: "custom-omp",
			model: "configured-model",
		},
	});

	expect(resolveReviewAgentConfig(config)).toEqual({
		agent: "claude",
		binary: "claude",
		model: undefined,
	});

	expect(resolveReviewAgentConfig(configuredConfig)).toEqual({
		agent: "omp",
		binary: "custom-omp",
		model: "configured-model",
	});
	expect(
		resolveReviewAgentConfig(configuredConfig, {
			agent: "omp",
			binary: null,
		}),
	).toEqual({
		agent: "omp",
		binary: "omp",
		model: undefined,
	});
	expect(
		resolveReviewAgentConfig(configuredConfig, { model: "override-model" }),
	).toEqual({
		agent: "omp",
		binary: "custom-omp",
		model: "override-model",
	});
	expect(
		resolveReviewAgentConfig(configuredConfig, { agent: "claude" }),
	).toEqual({
		agent: "claude",
		binary: "claude",
		model: undefined,
	});
});
test("creates babysitter services without resolving Slack environment", () => {
	const envName = "MOLE_TOOLS_CONTEXT_SLACK_WEBHOOK_URL";
	const original = process.env[envName];
	delete process.env[envName];

	try {
		const context = buildContext({
			config,
			ui: new FakeUiPort(),
		});

		expect(
			context.createReviewBabysitterAgent("babysitter-model"),
		).toBeInstanceOf(OmpAgentAdapter);
		expect(context.createNotifier(envName)).toBeInstanceOf(
			SlackWebhookNotifier,
		);
	} finally {
		if (original === undefined) delete process.env[envName];
		else process.env[envName] = original;
	}
});

test("allows babysitter service factories to be overridden", () => {
	const agent = new FakeReviewAgent();
	const notifier = new FakeNotifier();
	let requestedModel = "";
	let requestedEnvironment = "";
	const context = buildContext({
		config,
		ui: new FakeUiPort(),
		createReviewBabysitterAgent: (model) => {
			requestedModel = model;
			return agent;
		},
		createNotifier: (webhookUrlEnv) => {
			requestedEnvironment = webhookUrlEnv;
			return notifier;
		},
	});

	expect(context.createReviewBabysitterAgent("model-from-test")).toBe(agent);
	expect(context.createNotifier("ENV_FROM_TEST")).toBe(notifier);
	expect(requestedModel).toBe("model-from-test");
	expect(requestedEnvironment).toBe("ENV_FROM_TEST");
});

test("composes shared GitLab automation and cached GitHub hosts", () => {
	const context = buildContext({
		config,
		ui: new FakeUiPort(),
	});
	const gitLabHost = context.gitHostFor({ provider: "gitlab" });
	const githubHost = context.gitHostFor({
		provider: "github",
		host: "GitHub.com",
	});

	expect(gitLabHost).toBeInstanceOf(GlabAdapter);
	expect(context.gitLabAutomation === gitLabHost).toBe(true);
	expect(githubHost).toBeInstanceOf(GhAdapter);
	expect((githubHost as GhAdapter).host).toBe("github.com");
	expect(context.gitHostFor({ provider: "github", host: "github.com" })).toBe(
		githubHost,
	);

	const gheHost = context.gitHostFor({
		provider: "github",
		host: "GHE.Example.com",
	});
	expect(gheHost).toBeInstanceOf(GhAdapter);
	expect(gheHost).not.toBe(githubHost);
	expect((gheHost as GhAdapter).host).toBe("ghe.example.com");
});
