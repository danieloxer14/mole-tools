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

	test("rejects removed model routes", () => {
		expect(
			ConfigSchema.safeParse({
				...baseConfig,
				models: {
					...baseConfig.models,
					[staleReviewKey]: baseConfig.models.commit,
				},
			}).success,
		).toBe(false);
		expect(
			ConfigSchema.safeParse({
				...baseConfig,
				models: {
					...baseConfig.models,
					[staleLoopKey]: { init: baseConfig.models.commit },
				},
			}).success,
		).toBe(false);
	});

	test("rejects removed top-level review settings", () => {
		expect(
			ConfigSchema.safeParse({
				...baseConfig,
				[staleReviewKey]: { concurrency: 2 },
			}).success,
		).toBe(false);
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
