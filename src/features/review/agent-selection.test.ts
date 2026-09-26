import { describe, expect, test } from "bun:test";
import { effectiveAgentSelection } from "./agent-selection";

describe("effectiveAgentSelection", () => {
	test("omits an inherited effort that the prompt model does not support", () => {
		expect(
			effectiveAgentSelection(
				{ agent: null, model: "prompt-model", effort: null },
				{ agent: "omp", model: "default-model", effort: "high" },
				["low"],
			),
		).toEqual({ agent: "omp", model: "prompt-model", effort: null });
	});

	test("rejects an explicitly saved effort unsupported by the prompt model", () => {
		expect(() =>
			effectiveAgentSelection(
				{ agent: null, model: "prompt-model", effort: "high" },
				{ agent: "omp", model: "default-model", effort: null },
				["low"],
			),
		).toThrow("Effort high is not supported by the selected model");
	});

	test("inherits global agent, model, and effort", () => {
		expect(
			effectiveAgentSelection(
				{ agent: null, model: null },
				{ agent: "claude", model: "configured-model", effort: "high" },
			),
		).toEqual({
			agent: "claude",
			model: "configured-model",
			effort: "high",
		});
	});

	test("inherits global effort when version overrides only model", () => {
		expect(
			effectiveAgentSelection(
				{ agent: null, model: "version-model" },
				{ agent: "claude", model: "configured-model", effort: "high" },
			),
		).toEqual({ agent: "claude", model: "version-model", effort: "high" });
	});

	test("explicit agent with blank fields drops other agent defaults", () => {
		expect(
			effectiveAgentSelection(
				{ agent: "omp", model: null, effort: null },
				{ agent: "claude", model: "configured-model", effort: "high" },
			),
		).toEqual({ agent: "omp", model: null, effort: null });
	});
});
