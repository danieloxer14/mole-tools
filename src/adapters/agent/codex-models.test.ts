import { expect, test } from "bun:test";
import type { CodexModelCatalogProcessRunner } from "./codex-models";
import {
	CODEX_MODEL_DISCOVERY_MAX_OUTPUT_BYTES,
	discoverCodexModels,
	parseCodexModelCatalog,
} from "./codex-models";

const catalog = JSON.stringify({
	models: [
		{
			slug: "gpt-6-astra",
			display_name: "GPT-6-Astra",
			visibility: "list",
			supported_reasoning_levels: [
				{ effort: "high" },
				{ effort: "low" },
				{ effort: "unsupported" },
				{},
			],
		},
		{
			slug: "gpt-6-sol",
			display_name: "GPT-6-Sol",
			visibility: "list",
			supported_reasoning_levels: [{ effort: "medium" }],
		},
		{
			slug: "gpt-6-luna",
			display_name: "GPT-6-Luna",
			visibility: "list",
			supported_reasoning_levels: [{ effort: "ultra" }],
		},
		{ slug: "unknown-model", display_name: "Unknown", visibility: "list" },
		{ slug: "hidden", display_name: "Hidden", visibility: "hide" },
		{ slug: "gpt-6-astra", display_name: "Duplicate", visibility: "list" },
		{ slug: "", display_name: "Missing id", visibility: "list" },
		{ slug: "missing-label", display_name: " ", visibility: "list" },
		{ display_name: "Missing id", visibility: "list" },
	],
});

test("parses listed models, de-duplicates slugs, and filters supported efforts", () => {
	expect(parseCodexModelCatalog(catalog)).toEqual([
		{ id: "gpt-6-astra", label: "GPT-6-Astra", efforts: ["low", "high"] },
		{ id: "gpt-6-sol", label: "GPT-6-Sol", efforts: ["medium"] },
		{ id: "gpt-6-luna", label: "GPT-6-Luna", efforts: [] },
		{ id: "unknown-model", label: "Unknown", efforts: [] },
	]);
	expect(() => parseCodexModelCatalog("not json")).toThrow(
		"Codex debug models returned malformed JSON",
	);
	expect(() => parseCodexModelCatalog(JSON.stringify({ models: {} }))).toThrow(
		"Codex debug models returned a malformed catalog",
	);
});

test("invokes configured binary with catalog args and process options", async () => {
	let invocation:
		| {
				binary: string;
				args: readonly string[];
				cwd: string;
				timeoutMs: number;
				maxOutputBytes: number;
				signal: AbortSignal;
		  }
		| undefined;
	const runner: CodexModelCatalogProcessRunner = async (
		binary,
		args,
		options,
	) => {
		invocation = { binary, args, ...options };
		return {
			stdout: new TextEncoder().encode(catalog),
			stderr: new Uint8Array(),
			exitCode: 0,
		};
	};

	expect(
		await discoverCodexModels("custom-codex", "/review/worktree", runner, 321),
	).toEqual(parseCodexModelCatalog(catalog));
	expect(invocation).toMatchObject({
		binary: "custom-codex",
		args: ["debug", "models"],
		cwd: "/review/worktree",
		timeoutMs: 321,
		maxOutputBytes: CODEX_MODEL_DISCOVERY_MAX_OUTPUT_BYTES,
	});
	expect(invocation?.signal).toBeInstanceOf(AbortSignal);
	expect(invocation?.signal.aborted).toBe(false);
});

test("surfaces malformed output and process failures", async () => {
	const malformed: CodexModelCatalogProcessRunner = async () => ({
		stdout: new TextEncoder().encode("not json"),
		stderr: new Uint8Array(),
		exitCode: 0,
	});
	const failed: CodexModelCatalogProcessRunner = async () => ({
		stdout: new TextEncoder().encode(catalog),
		stderr: new TextEncoder().encode("CLI unavailable"),
		exitCode: 127,
	});

	await expect(discoverCodexModels("codex", "/tmp", malformed)).rejects.toThrow(
		"Codex debug models returned malformed JSON",
	);
	await expect(discoverCodexModels("codex", "/tmp", failed)).rejects.toThrow(
		"Codex debug models exited with code 127",
	);
});

test("aborts CLI discovery when its timeout expires", async () => {
	let signal: AbortSignal | undefined;
	const hanging: CodexModelCatalogProcessRunner = async (
		_binary,
		_args,
		options,
	) => {
		signal = options.signal;
		return Promise.withResolvers<never>().promise;
	};

	await expect(
		discoverCodexModels("codex", "/tmp", hanging, 0),
	).rejects.toThrow("Codex debug models timed out after 0 ms");
	expect(signal?.aborted).toBe(true);
});
