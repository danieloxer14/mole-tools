import { ClaudeAgentAdapter } from "../adapters/agent/claude";
import { OmpAgentAdapter } from "../adapters/agent/omp";
import {
	type Config,
	type RoutingPurpose,
	validateModelProviders,
} from "../adapters/config/schema";
import { GlabAdapter } from "../adapters/git-host/glab";
import { JiraAdapter } from "../adapters/issue-tracker/jira";
import { OllamaAdapter } from "../adapters/llm/ollama";
import { PiAdapter } from "../adapters/llm/pi";
import { GitAdapter } from "../adapters/vcs/git";
import type { GitHost } from "../ports/git-host";
import type { IssueTracker } from "../ports/issue-tracker";
import type { GenerateRequest, Llm } from "../ports/llm";
import type { ReviewAgent } from "../ports/review-agent";
import type { UiPort } from "../ports/ui";
import type { Vcs } from "../ports/vcs";

export interface Context {
	config: Config;
	ui: UiPort;
	vcs: Vcs;
	llm: Llm; // convenience proxy — routes to the commit provider by default
	getLlmFor(purpose: RoutingPurpose, providerKey?: string): Llm;
	reviewAgent: ReviewAgent;
	issues: IssueTracker | null;
	gitHost: GitHost | null;
}

/**
 * Thin proxy that always resolves to a specific provider profile.
 * A single Llm adapter per profile is cached so repeated lookups are cheap.
 */
export class ProviderLlmProxy implements Llm {
	constructor(
		private readonly adapters: Map<string, Llm>,
		private readonly profileKey: string,
	) {}

	generate(req: GenerateRequest) {
		return this.adapter.generate(req);
	}

	get adapter(): Llm {
		const a = this.adapters.get(this.profileKey);
		if (!a)
			throw new Error(`No adapter wired for provider "${this.profileKey}"`);
		return a;
	}
}

/**
 * Proxy that routes to whatever the current feature's configured provider is.
 * The purpose is inferred from context (passed at construction).
 */
export class RoutingLlmProxy implements Llm {
	private commitProxy: ProviderLlmProxy;
	private mrProxy?: ProviderLlmProxy;

	constructor(
		private readonly adapters: Map<string, Llm>,
		private readonly config: Config,
	) {
		const commitKey = this.resolveProfileKey("commit");
		this.commitProxy = new ProviderLlmProxy(adapters, commitKey);
	}

	generate(req: GenerateRequest) {
		return this.defaultAdapter.generate(req);
	}

	getLlmFor(purpose: RoutingPurpose, providerKey?: string): ProviderLlmProxy {
		if (providerKey) return new ProviderLlmProxy(this.adapters, providerKey);
		switch (purpose) {
			case "commit":
				return this.commitProxy;
			case "mergeRequest":
				if (!this.mrProxy) {
					this.mrProxy = new ProviderLlmProxy(
						this.adapters,
						this.resolveProfileKey("mergeRequest"),
					);
				}
				return this.mrProxy;
		}
		throw new Error(`Unsupported LLM routing purpose "${purpose}"`);
	}

	private resolveProfileKey(purpose: RoutingPurpose): string {
		const route = this.config.models[purpose] as
			| { provider: string }
			| undefined;
		if (!route) throw new Error(`models.${purpose} is not configured`);
		return route.provider;
	}

	private get defaultAdapter(): Llm {
		return this.commitProxy.adapter;
	}
}

/** Build the per-provider Llm adapter map from config */
function buildAdapterMap(config: Config): Map<string, Llm> {
	const adapters = new Map<string, Llm>();

	for (const [key, profile] of Object.entries(config.providers)) {
		if ("baseUrl" in profile) {
			adapters.set(key, new OllamaAdapter({ baseUrl: profile.baseUrl }));
		} else {
			adapters.set(
				key,
				new PiAdapter({
					binary: profile.binary,
					projectRoot: profile.projectRoot,
				}),
			);
		}
	}
	return adapters;
}

function buildReviewAgent(config: Config): ReviewAgent {
	const review = config.review;
	const agent = review?.agent ?? "omp";
	const binary = review?.binary ?? agent;

	if (agent === "claude") {
		return new ClaudeAgentAdapter({ binary, model: review?.model });
	}
	return new OmpAgentAdapter({ binary, model: review?.model });
}

export function buildContext(input: {
	config: Config;
	ui: UiPort;
	reviewAgent?: ReviewAgent;
}): Context {
	const { config, ui, reviewAgent } = input;
	validateModelProviders(config);
	const adapterMap = buildAdapterMap(config);

	const llmProxy = new RoutingLlmProxy(adapterMap, config);

	return {
		config,
		ui,
		vcs: new GitAdapter(),
		llm: llmProxy, // default routes to commit provider
		reviewAgent: reviewAgent ?? buildReviewAgent(config),
		getLlmFor: (purpose: RoutingPurpose, providerKey?: string) =>
			llmProxy.getLlmFor(purpose, providerKey),
		issues:
			config.jira.enabled && config.jira.url && config.jira.apiKey
				? new JiraAdapter({
						url: config.jira.url,
						apiKey: config.jira.apiKey,
						email: config.jira.email,
					})
				: null,
		gitHost: new GlabAdapter(),
	};
}
