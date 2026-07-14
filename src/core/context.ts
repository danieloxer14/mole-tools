import { type Config, validateModelProviders } from "../adapters/config/schema";
import { GlabAdapter } from "../adapters/git-host/glab";
import { JiraAdapter } from "../adapters/issue-tracker/jira";
import { OllamaAdapter } from "../adapters/llm/ollama";
import { PiAdapter } from "../adapters/llm/pi";
import { GitAdapter } from "../adapters/vcs/git";
import type { GitHost } from "../ports/git-host";
import type { IssueTracker } from "../ports/issue-tracker";
import type {
	AgentRequest,
	AgentResult,
	GenerateRequest,
	Llm,
} from "../ports/llm";
import type { UiPort } from "../ports/ui";
import type { Vcs } from "../ports/vcs";
import { CostTracker } from "./cost-tracker";

export interface Logger {
	info(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
}

export interface Context {
	config: Config;
	ui: UiPort;
	vcs: Vcs;
	llm: Llm; // convenience proxy — routes to the commit provider by default
	getLlmFor(
		purpose: "commit" | "mergeRequest" | "ralph",
		providerKey?: string,
	): Llm;
	issues: IssueTracker | null;
	gitHost: GitHost | null;
	log: Logger;
	costTracker: CostTracker;
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

	capabilities() {
		return this.adapter.capabilities();
	}

	generate(req: GenerateRequest) {
		return this.adapter.generate(req);
	}

	runAgent(req: AgentRequest): Promise<AgentResult> {
		return this.adapter.runAgent(req);
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

	capabilities() {
		return this.defaultAdapter.capabilities();
	}

	generate(req: GenerateRequest) {
		return this.defaultAdapter.generate(req);
	}

	runAgent(req: AgentRequest): Promise<AgentResult> {
		const key = req.providerKey ?? this.resolveProfileKey("ralph");
		return this.forProvider(key).runAgent({ ...req, providerKey: undefined });
	}

	getLlmFor(
		purpose: "commit" | "mergeRequest" | "ralph",
		providerKey?: string,
	): ProviderLlmProxy {
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
			case "ralph":
				return new ProviderLlmProxy(
					this.adapters,
					this.resolveProfileKey("ralph"),
				);
		}
	}

	private resolveProfileKey(
		purpose: "commit" | "mergeRequest" | "ralph",
	): string {
		return purpose === "ralph"
			? this.config.models.ralph.init.provider
			: this.config.models[purpose].provider;
	}

	private get defaultAdapter(): Llm {
		return this.commitProxy.adapter;
	}

	private forProvider(key: string): Llm {
		const a = this.adapters.get(key);
		if (!a) throw new Error(`No adapter wired for provider "${key}"`);
		return a;
	}
}

function makeLogger(): Logger {
	return {
		info: (msg) => console.log(msg),
		warn: (msg) => console.warn(msg),
		error: (msg) => console.error(msg),
	};
}

/** Build the per-provider Llm adapter map from config */
function buildAdapterMap(
	config: Config,
	costTracker: CostTracker,
): Map<string, Llm> {
	const adapters = new Map<string, Llm>();

	for (const [key, profile] of Object.entries(config.providers)) {
		if ("baseUrl" in profile) {
			adapters.set(
				key,
				new OllamaAdapter({ baseUrl: profile.baseUrl }, costTracker),
			);
		} else {
			adapters.set(
				key,
				new PiAdapter(
					{ binary: profile.binary, projectRoot: profile.projectRoot },
					costTracker,
				),
			);
		}
	}
	return adapters;
}

export function buildContext(input: { config: Config; ui: UiPort }): Context {
	const { config, ui } = input;
	validateModelProviders(config);
	const costTracker = new CostTracker();
	const adapterMap = buildAdapterMap(config, costTracker);

	const llmProxy = new RoutingLlmProxy(adapterMap, config);

	return {
		config,
		ui,
		vcs: new GitAdapter(),
		llm: llmProxy, // default routes to commit provider
		getLlmFor: (
			purpose: "commit" | "mergeRequest" | "ralph",
			providerKey?: string,
		) => llmProxy.getLlmFor(purpose, providerKey),
		issues:
			config.jira.enabled && config.jira.url && config.jira.apiKey
				? new JiraAdapter(
						{
							url: config.jira.url,
							apiKey: config.jira.apiKey,
							email: config.jira.email,
						},
						costTracker,
					)
				: null,
		gitHost: new GlabAdapter(costTracker),
		log: makeLogger(),
		costTracker,
	};
}
