import { z } from "zod";

// ─── Provider schemas (discriminated union) ────────────────────────────────

const OllamaProviderSchema = z.object({
	provider: z.literal("ollama"),
	baseUrl: z.string(),
});

const PiProviderSchema = z.object({
	provider: z.literal("pi"),
	binary: z.string().default("pi"),
	projectRoot: z.string().optional(),
});

export const ProviderProfileSchema = z.union([OllamaProviderSchema, PiProviderSchema]);
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

// Per-feature routing: each feature selects its provider profile key
export const LlmRoutingSchema = z.object({
	commit: z.string().default("ollama"),
	mergeRequest: z.string().default("ollama"),
	ralph: z.string().default("pi"),
});

export type LlmRouting = z.infer<typeof LlmRoutingSchema>;

// ─── Legacy config (backward compat shim) ──────────────────────────────────

const LegacyOllamaSchema = z.object({
	commitModel: z.string(),
	mrModel: z.string().optional(),
	baseUrl: z.string(),
});

const LegacyConfigSchema = z.object({
	ollama: LegacyOllamaSchema,
	jira: z.object({
		enabled: z.boolean(),
		url: z.string().optional(),
		email: z.string().optional(),
		apiKey: z.string().optional(),
		branchPattern: z.string(),
	}),
	diff: z.object({
		ignore: z.array(z.string()),
	}),
	dynamicEnvRepos: z.array(z.string()).optional(),
	dynamicEnvScript: z.string().optional(),
	autoReviewer: z
		.object({
			username: z.string(),
		})
		.optional(),
});

// ─── New config ────────────────────────────────────────────────────────────

export const ConfigSchema = z.object({
	providers: z.record(z.string(), ProviderProfileSchema).default({}),
	models: z
		.object({
			default: z.string().optional(),
		})
		.optional(),
	llm: LlmRoutingSchema,
	jira: z.object({
		enabled: z.boolean().default(false),
		url: z.string().optional(),
		email: z.string().optional(),
		apiKey: z.string().optional(),
		branchPattern: z.string().default("[A-Z]+-[0-9]+"),
	}),
	diff: z.object({
		ignore: z.array(z.string()).default([]),
	}),
	dynamicEnvRepos: z.array(z.string()).optional(),
	dynamicEnvScript: z.string().optional(),
	autoReviewer: z
		.object({
			username: z.string(),
		})
		.optional(),

	// ─ legacy fields preserved for migration compat ─
	ollama: LegacyOllamaSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Resolve the provider profile + model for a given feature purpose */
export function resolveLlmProvider(
	config: Config,
	purpose: "commit" | "mergeRequest" | "ralph",
): { providerKey: string; providerProfile: ProviderProfile; model?: string } {
	const routing = config.llm?.[purpose] ?? (purpose === "ralph" ? "pi" : "ollama");

	// Check if routing string starts with a model override prefix "@model:"
	let modelOverride: string | undefined;
	let providerKey = routing;
	if (typeof routing === "string") {
		const match = routing.match(/^@([^:]+):(.+)$/);
		if (match) {
			modelOverride = match[1];
			providerKey = match[2] || "ollama";
		}
	}

	const profiles = config.providers ?? {};
	let profile = profiles[providerKey];

	// Fall back to legacy ollama section if no new providers defined
	if (!profile && config.ollama) {
		profile = {
			provider: "ollama" as const,
			baseUrl: config.ollama.baseUrl,
		};
	}

	if (!profile) {
		throw new Error(
			`No provider profile found for key "${providerKey}" (feature "${purpose}").`,
		);
	}

	// Model resolution: explicit override > legacy field > default
	let resolvedModel = modelOverride;
	if (!resolvedModel) {
		switch (purpose) {
			case "commit":
				resolvedModel = config.ollama?.commitModel ?? config.models?.default;
				break;
			case "mergeRequest":
				resolvedModel =
					config.ollama?.mrModel ??
					config.ollama?.commitModel ??
					config.models?.default;
				break;
			case "ralph":
				// Ralph model comes from CLI --model, resolved at call site
				break;
		}
	}

	return { providerKey, providerProfile: profile, model: resolvedModel };
}
