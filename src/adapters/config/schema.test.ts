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
const validReviewBabysitter = {
	assignees: ["review-owner"],
	aiReviewerUsername: "ai-reviewer",
	promptFile: "~/.config/mole-tools/prompts/review-babysitter.md",
	model: "model-name",
	webhookUrlEnv: "SLACK_WEBHOOK_URL",
	denyPathsByProject: { "group/repo": ["src/auth/**"] },
} as const;

describe("config schema", () => {
	test("accepts only commit and mergeRequest model routes", () => {
		const result = ConfigSchema.safeParse(baseConfig);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.models).toEqual(baseConfig.models);
		}
	});
	test("accepts babysitter settings with defaults and boundaries", () => {
		const config = ConfigSchema.parse({
			...baseConfig,
			reviewBabysitter: validReviewBabysitter,
		});
		expect(config.reviewBabysitter).toEqual({
			...validReviewBabysitter,
			intervalSeconds: 900,
			maxChangedLines: 250,
			maxChangedFiles: 10,
		});

		const boundary = ConfigSchema.parse({
			...baseConfig,
			reviewBabysitter: {
				...validReviewBabysitter,
				intervalSeconds: 60,
				maxChangedLines: 0,
				maxChangedFiles: 0,
			},
		});
		expect(boundary.reviewBabysitter).toMatchObject({
			intervalSeconds: 60,
			maxChangedLines: 0,
			maxChangedFiles: 0,
		});
	});

	test("accepts an explicit empty deny-list entry", () => {
		const config = ConfigSchema.parse({
			...baseConfig,
			reviewBabysitter: {
				...validReviewBabysitter,
				denyPathsByProject: { "group/repo": [] },
			},
		});

		expect(config.reviewBabysitter?.denyPathsByProject).toEqual({
			"group/repo": [],
		});
	});

	test("rejects invalid babysitter settings", () => {
		const invalidSettings: Record<string, unknown>[] = [
			{ intervalSeconds: 59 },
			{ maxChangedLines: -1 },
			{ maxChangedLines: 1.5 },
			{ maxChangedFiles: -1 },
			{ maxChangedFiles: 1.5 },
			{ assignees: [] },
			{ assignees: [""] },
			{ aiReviewerUsername: "" },
			{ promptFile: "" },
			{ model: "" },
			{ webhookUrlEnv: "" },
			{ denyPathsByProject: { "": ["src/**"] } },
			{ denyPathsByProject: { "group/repo": [""] } },
			{ denyPathsByProject: { "group/repo": "src/**" } },
			{ denyPathsByProject: { "group/repo": [123] } },
			{ unsupported: true },
		];

		for (const settings of invalidSettings) {
			expect(
				ConfigSchema.safeParse({
					...baseConfig,
					reviewBabysitter: { ...validReviewBabysitter, ...settings },
				}).success,
			).toBe(false);
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
