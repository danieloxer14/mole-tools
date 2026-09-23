import { describe, expect, test } from "bun:test";
import { effectiveAgentSelection } from "./agent-selection";

describe("effectiveAgentSelection", () => {
	test("inherits agent and model", () => {
		expect(
			effectiveAgentSelection(
				{ agent: null, model: null },
				{ agent: "claude", model: "configured-model" },
			),
		).toEqual({ agent: "claude", model: "configured-model" });
	});

	test("inherits agent with version model", () => {
		expect(
			effectiveAgentSelection(
				{ agent: null, model: "version-model" },
				{ agent: "claude", model: "configured-model" },
			),
		).toEqual({ agent: "claude", model: "version-model" });
	});

	test("explicit agent with blank model drops default model", () => {
		expect(
			effectiveAgentSelection(
				{ agent: "omp", model: null },
				{ agent: "claude", model: "configured-model" },
			),
		).toEqual({ agent: "omp", model: null });
	});
});
