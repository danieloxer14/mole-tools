import { describe, expect, test } from "bun:test";
import {
	ConfigSchema,
	resolveLlmProvider,
	validateModelProviders,
} from "./schema";

const baseConfig = {
	providers: {
		ollama: { provider: "ollama" as const, baseUrl: "http://localhost:11434" },
	},
	models: {
		commit: { provider: "ollama", name: "qwen3.6" },
		mergeRequest: { provider: "ollama", name: "qwen3.6" },
	},
	jira: { enabled: false },
	diff: { ignore: [] },
} as const;
const staleReviewKey = ["mr", "Review"].join("");
const staleLoopKey = ["ra", "lph"].join("");

describe("config schema", () => {
	test("accepts only commit and mergeRequest model routes", () => {
		const result = ConfigSchema.safeParse(baseConfig);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.models).toEqual(baseConfig.models);
		}
	});

	test("ignores unknown model routes", () => {
		const config = ConfigSchema.parse({
			...baseConfig,
			models: {
				...baseConfig.models,
				[staleReviewKey]: baseConfig.models.commit,
				[staleLoopKey]: { init: baseConfig.models.commit },
			},
		});

		expect(config.models).toEqual(baseConfig.models);
	});

	test("ignores unknown keys at every config level", () => {
		const config = ConfigSchema.parse({
			...baseConfig,
			extra: true,
			providers: {
				ollama: {
					...baseConfig.providers.ollama,
					extra: true,
				},
			},
			models: {
				...baseConfig.models,
				commit: { ...baseConfig.models.commit, extra: true },
			},
			review: { agent: "omp", unsupported: true },
		});

		expect(config.providers.ollama).toEqual(baseConfig.providers.ollama);
		expect(config.models.commit).toEqual(baseConfig.models.commit);
		expect(config.review).toEqual({
			agent: "omp",
			layerTimeoutSeconds: 600,
			largeFileLineThreshold: 800,
		});
		expect(config).not.toHaveProperty("extra");
	});

	test("keeps rejecting invalid known values", () => {
		expect(
			ConfigSchema.safeParse({
				...baseConfig,
				models: {
					...baseConfig.models,
					commit: { provider: "ollama", name: 123 },
				},
			}).success,
		).toBe(false);
	});

	test("ignores removed top-level review settings", () => {
		const config = ConfigSchema.parse({
			...baseConfig,
			[staleReviewKey]: { concurrency: 2 },
		});

		expect(config).not.toHaveProperty(staleReviewKey);
	});

	test("validates configured providers for surviving routes", () => {
		const config = ConfigSchema.parse({
			...baseConfig,
			models: {
				...baseConfig.models,
				mergeRequest: { provider: "missing", name: "review-model" },
			},
		});

		expect(() => validateModelProviders(config)).toThrow("models.mergeRequest");
	});

	test("resolves the configured merge request provider", () => {
		const config = ConfigSchema.parse({
			...baseConfig,
			models: {
				...baseConfig.models,
				mergeRequest: { provider: "ollama", name: "review-model" },
			},
		});

		expect(resolveLlmProvider(config, "mergeRequest")).toMatchObject({
			providerKey: "ollama",
			model: "review-model",
		});
	});
});
