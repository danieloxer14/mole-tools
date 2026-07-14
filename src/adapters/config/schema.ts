import { z } from "zod";

/** Connection details for a named provider. The map key is the provider identity. */
export const OllamaProviderSchema = z.object({
	baseUrl: z.string().min(1),
}).strict();
export const PiProviderSchema = z.object({
	binary: z.string().min(1),
	projectRoot: z.string().optional(),
}).strict();
export const ProviderProfileSchema = z.union([OllamaProviderSchema, PiProviderSchema]);
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

export const ModelRouteSchema = z.object({
	provider: z.string().min(1),
	name: z.string().min(1),
}).strict();
export type ModelRoute = z.infer<typeof ModelRouteSchema>;

export const ModelsConfigSchema = z.object({
	commit: ModelRouteSchema,
	mergeRequest: ModelRouteSchema,
	ralph: z.object({
		init: ModelRouteSchema,
		implement: ModelRouteSchema,
		reflect: ModelRouteSchema,
	}),
}).strict();

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
}).strict();
export type Config = z.infer<typeof ConfigSchema>;

export type RoutingPurpose = "commit" | "mergeRequest" | "ralph";

export function resolveLlmProvider(
	config: Config,
	purpose: RoutingPurpose,
): { providerKey: string; providerProfile: ProviderProfile; model: string } {
	const route = purpose === "ralph" ? config.models.ralph.init : config.models[purpose];
	const providerProfile = config.providers[route.provider];
	if (!providerProfile) {
		throw new Error(`provider '${route.provider}' referenced in models.${purpose} but not defined in providers`);
	}
	return { providerKey: route.provider, providerProfile, model: route.name };
}

/** Validate every route, including Ralph's phase routes, with a useful path. */
export function validateModelProviders(config: Config): void {
	const routes: Array<[string, ModelRoute]> = [
		["models.commit", config.models.commit],
		["models.mergeRequest", config.models.mergeRequest],
		["models.ralph.init", config.models.ralph.init],
		["models.ralph.implement", config.models.ralph.implement],
		["models.ralph.reflect", config.models.ralph.reflect],
	];
	for (const [path, route] of routes) {
		if (!config.providers[route.provider]) {
			throw new Error(`provider '${route.provider}' referenced in ${path} but not defined in providers`);
		}
	}
}
