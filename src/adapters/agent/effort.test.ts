import { describe, expect, test } from "bun:test";
import { ConfigSchema } from "../config/schema";
import { ClaudeAgentAdapter } from "./claude";
import {
	AgentEffortSchema,
	CLAUDE_EFFORTS,
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
		for (const effort of ["ultra", "", null, 1, {}, undefined]) {
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
