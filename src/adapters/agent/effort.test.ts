import { describe, expect, test } from "bun:test";
import { ConfigSchema } from "../config/schema";
import { ClaudeAgentAdapter } from "./claude";
import {
	AgentEffortSchema,
	CLAUDE_EFFORTS,
	CODEX_EFFORTS,
	codexEffortsForModel,
	isAgentEffort,
	OMP_EFFORTS,
} from "./effort";
import { OmpAgentAdapter } from "./omp";

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
};

describe("agent effort levels", () => {
	test("defines the complete OMP and Claude effort sets", () => {
		expect(OMP_EFFORTS).toEqual([
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
			"auto",
		]);
		expect(CLAUDE_EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"]);
	});

	test("defines model-specific Codex reasoning levels", () => {
		expect(CODEX_EFFORTS).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
			"ultra",
		]);
		for (const model of [
			"gpt-6-sol",
			"gpt-6-astra",
			"gpt-5.6-sol",
			"gpt-5.6-terra",
		]) {
			expect(codexEffortsForModel(model)).toEqual(CODEX_EFFORTS);
		}
		for (const model of ["gpt-6-luna", "gpt-5.6-luna"]) {
			expect(codexEffortsForModel(model)).toEqual([
				"low",
				"medium",
				"high",
				"xhigh",
				"max",
			]);
		}
		expect(codexEffortsForModel("gpt-5.5")).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
		]);
		expect(codexEffortsForModel("unknown-model")).toEqual([]);
	});

	test("accepts Codex effort only when supported by selected model", () => {
		expect(AgentEffortSchema.safeParse("ultra").success).toBe(true);
		expect(isAgentEffort("codex", "ultra", "gpt-6-astra")).toBe(true);
		expect(isAgentEffort("codex", "ultra", "gpt-6-luna")).toBe(false);
		expect(isAgentEffort("codex", "max", "gpt-5.5")).toBe(false);
		expect(isAgentEffort("codex", "low")).toBe(false);
		expect(
			ConfigSchema.safeParse({
				...baseConfig,
				review: { agent: "codex", model: "gpt-6-astra", effort: "ultra" },
			}).success,
		).toBe(true);
		for (const review of [
			{ agent: "codex", effort: "low" },
			{ agent: "codex", model: "gpt-6-luna", effort: "ultra" },
			{ agent: "codex", model: "gpt-5.5", effort: "max" },
			{ agent: "codex", model: "unknown-model", effort: "high" },
		]) {
			expect(ConfigSchema.safeParse({ ...baseConfig, review }).success).toBe(
				false,
			);
		}
	});
	test("validates only each agent's supported efforts", () => {
		for (const effort of OMP_EFFORTS) {
			expect(isAgentEffort("omp", effort)).toBe(true);
			expect(new OmpAgentAdapter({ effort })).toBeInstanceOf(OmpAgentAdapter);
			expect(
				ConfigSchema.safeParse({
					...baseConfig,
					review: { agent: "omp", effort },
				}).success,
			).toBe(true);
		}

		for (const effort of CLAUDE_EFFORTS) {
			expect(isAgentEffort("claude", effort)).toBe(true);
			expect(new ClaudeAgentAdapter({ effort })).toBeInstanceOf(
				ClaudeAgentAdapter,
			);
			expect(
				ConfigSchema.safeParse({
					...baseConfig,
					review: { agent: "claude", effort },
				}).success,
			).toBe(true);
		}
	});

	test("rejects unsupported, malformed, and cross-agent efforts", () => {
		for (const effort of ["", null, 1, {}, undefined]) {
			expect(AgentEffortSchema.safeParse(effort).success).toBe(false);
			expect(isAgentEffort("omp", effort)).toBe(false);
			expect(isAgentEffort("claude", effort)).toBe(false);
		}

		for (const effort of ["off", "minimal", "auto"] as const) {
			expect(isAgentEffort("claude", effort)).toBe(false);
			expect(
				ConfigSchema.safeParse({
					...baseConfig,
					review: { agent: "claude", effort },
				}).success,
			).toBe(false);
			expect(
				() => new ClaudeAgentAdapter({ effort: effort as never }),
			).toThrow();
		}

		for (const effort of ["ultra", "bogus"] as const) {
			expect(() => new OmpAgentAdapter({ effort: effort as never })).toThrow();
		}

		for (const effort of ["auto"] as const) {
			expect(
				ConfigSchema.safeParse({
					...baseConfig,
					review: { agent: "omp", effort: "ultra" },
				}).success,
			).toBe(false);
			expect(isAgentEffort("omp", effort)).toBe(true);
		}
	});

	test("missing effort remains optional and config preserves existing defaults", () => {
		expect(ConfigSchema.parse(baseConfig).review).toEqual({
			agent: "claude",
			layerTimeoutSeconds: 600,
			largeFileLineThreshold: 800,
			maxLayerPromptBytes: 100_000,
		});
	});
});
