import { z } from "zod";

/** Connection details for a named provider. The map key is the provider identity. */
export const OllamaProviderSchema = z.object({
	baseUrl: z.string().min(1),
	provider: z.literal("ollama").optional(),
});
export const PiProviderSchema = z.object({
	binary: z.string().min(1),
	provider: z.literal("pi").optional(),
	projectRoot: z.string().optional(),
});
export const ProviderProfileSchema = z.union([
	OllamaProviderSchema,
	PiProviderSchema,
]);
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

export const ModelRouteSchema = z.object({
	provider: z.string().min(1),
	name: z.string().min(1),
});
export type ModelRoute = z.infer<typeof ModelRouteSchema>;

export const ModelsConfigSchema = z.object({
	commit: ModelRouteSchema,
	mergeRequest: ModelRouteSchema,
});

export const ReviewConfigSchema = z
	.object({
		agent: z.enum(["omp", "claude"]).default("omp"),
		binary: z.string().min(1).optional(),
		model: z.string().min(1).optional(),
		layerTimeoutSeconds: z.number().int().positive().default(600),
		largeFileLineThreshold: z.number().int().positive().default(800),
	})
	.default({
		agent: "omp",
		layerTimeoutSeconds: 600,
		largeFileLineThreshold: 800,
	});

/** Unknown config keys are stripped for forward compatibility across feature branches. */
export const ConfigSchema = z.object({
	providers: z.record(z.string().min(1), ProviderProfileSchema),
	models: ModelsConfigSchema,
	jira: z.object({
		enabled: z.boolean().default(false),
		url: z.string().optional(),
		email: z.string().optional(),
		apiKey: z.string().optional(),
		branchPattern: z.string().default("[A-Z]+-[0-9]+"),
	}),
	diff: z.object({ ignore: z.array(z.string()).default([]) }),
	dynamicEnvRepos: z.array(z.string()).optional(),
	dynamicEnvScript: z.string().optional(),
	autoReviewer: z.object({ username: z.string() }).optional(),
	worktreePrune: z.object({ baseDir: z.string().min(1) }).optional(),
	review: ReviewConfigSchema,
});
export type Config = z.infer<typeof ConfigSchema>;

export type RoutingPurpose = "commit" | "mergeRequest";

export function resolveLlmProvider(
	config: Config,
	purpose: RoutingPurpose,
): { providerKey: string; providerProfile: ProviderProfile; model: string } {
	const legacy = config as Config & {
		ollama?: { commitModel?: string; baseUrl?: string };
		llm?: Record<string, string>;
	};
	if (
		(!config.models || !(config.models as Record<string, unknown>).commit) &&
		legacy.ollama &&
		legacy.llm
	) {
		const providerKey = legacy.llm[purpose] ?? "ollama";
		return {
			providerKey,
			providerProfile: {
				provider: "ollama",
				baseUrl: legacy.ollama.baseUrl ?? "http://localhost:11434",
			},
			model: legacy.ollama.commitModel ?? "llama3.1",
		};
	}
	if (
		!(config.models as Record<string, unknown> | undefined)?.commit &&
		legacy.llm &&
		config.providers
	) {
		const providerKey = legacy.llm[purpose] ?? "ollama";
		const providerProfile = config.providers[providerKey];
		if (!providerProfile) {
			throw new Error(`provider '${providerKey}' is not defined in providers`);
		}
		const legacyModels = config.models as unknown as Record<string, unknown>;
		return {
			providerKey,
			providerProfile,
			model: String(legacyModels.default ?? ""),
		};
	}
	const route = config.models[purpose];
	const providerProfile = config.providers[route.provider];
	if (!providerProfile) {
		throw new Error(
			`provider '${route.provider}' referenced in models.${purpose} but not defined in providers`,
		);
	}
	return { providerKey: route.provider, providerProfile, model: route.name };
}

/** Validate every configured route with a useful path. */
export function validateModelProviders(config: Config): void {
	const routes: Array<[string, ModelRoute]> = [
		["models.commit", config.models.commit],
		["models.mergeRequest", config.models.mergeRequest],
	];
	for (const [path, route] of routes) {
		if (!config.providers[route.provider]) {
			throw new Error(
				`provider '${route.provider}' referenced in ${path} but not defined in providers`,
			);
		}
	}
}
