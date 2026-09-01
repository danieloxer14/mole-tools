import { describe, expect, test } from "bun:test";
import type { AgentExec } from "./exec";
import {
	diagnostic,
	errorMessage,
	malformed,
	nestedMessage,
	parseJson,
	preflight,
	resolveAgentConfig,
} from "./shared";

describe("shared agent adapter plumbing", () => {
	test("preserves provider labels and diagnostic/error formatting", () => {
		expect(errorMessage(new Error("failed"))).toBe("failed");
		expect(errorMessage("failed")).toBe("failed");
		expect(diagnostic("future", { type: "future" })).toEqual({
			kind: "diagnostic",
			code: "unknown_event",
			message: "Unknown agent event type: future",
			eventType: "future",
			raw: { type: "future" },
		});
		expect(malformed("OMP", "expected an object")).toEqual({
			kind: "error",
			message: "Malformed OMP agent event: expected an object",
		});
		expect(malformed("Claude", "expected an object")).toEqual({
			kind: "error",
			message: "Malformed Claude agent event: expected an object",
		});
	});

	test("extracts provider-specific nested messages", () => {
		expect(
			nestedMessage({ result: { detail: "Claude failed" } }, [
				"message",
				"error",
				"detail",
				"reason",
				"result",
			]),
		).toBe("Claude failed");
		expect(
			nestedMessage({ result: "Claude failed" }, [
				"message",
				"error",
				"detail",
				"reason",
			]),
		).toBeNull();
		expect(
			nestedMessage({ error: { reason: "OMP failed" } }, [
				"message",
				"error",
				"detail",
				"reason",
			]),
		).toBe("OMP failed");
	});

	test("parses malformed JSON and non-object values with provider labels", () => {
		expect(parseJson("not-json", "OMP")).toEqual({
			tag: "event",
			event: {
				kind: "error",
				message: "Malformed OMP agent event: invalid JSON (not-json)",
			},
		});
		expect(parseJson("[]", "Claude")).toEqual({
			tag: "event",
			event: {
				kind: "error",
				message: "Malformed Claude agent event: expected an object",
			},
		});
		expect(parseJson('{"type":"session"}', "OMP")).toEqual({
			tag: "provider",
			value: { type: "session" },
		});
	});

	test("resolves positional and options constructors with injected executors", () => {
		const positional: AgentExec = async function* () {};
		const optionsExec: AgentExec = async function* () {};

		expect(resolveAgentConfig(positional, {}, "omp")).toEqual({
			execFn: positional,
			binary: "omp",
			model: undefined,
		});
		expect(
			resolveAgentConfig(
				{ exec: optionsExec, binary: "custom", model: "model" },
				{},
				"claude",
			),
		).toEqual({
			execFn: optionsExec,
			binary: "custom",
			model: "model",
		});
	});

	test("preflight consumes injected executor output", async () => {
		const calls: Array<{ binary: string; args: string[]; cwd: string }> = [];
		const exec: AgentExec = async function* (binary, args, options) {
			calls.push({ binary, args, cwd: options.cwd });
			yield "version";
		};

		await preflight(exec, "claude");

		expect(calls).toEqual([
			{ binary: "claude", args: ["--version"], cwd: process.cwd() },
		]);
	});
});
