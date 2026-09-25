import { expect, test } from "bun:test";
import {
	discoverCodexModels,
	parseCodexModelCatalog,
} from "./codex-models";
import type { AgentExec } from "./exec";

const catalog = JSON.stringify({
	models: [
		{ slug: "gpt-6-astra", display_name: "GPT-6-Astra", visibility: "list" },
		{ slug: "gpt-6-sol", display_name: "GPT-6-Sol", visibility: "list" },
		{ slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list" },
		{ slug: "hidden", display_name: "Hidden", visibility: "hide" },
		{ slug: "gpt-6-astra", display_name: "Duplicate", visibility: "list" },
		{ slug: "", display_name: "Missing id", visibility: "list" },
		{ slug: "missing-label", display_name: " ", visibility: "list" },
		{ display_name: "Missing id", visibility: "list" },
	],
});

test("parses only list-visible Codex models and de-duplicates slugs", () => {
	expect(parseCodexModelCatalog(catalog)).toEqual([
		{ id: "gpt-6-astra", label: "GPT-6-Astra" },
		{ id: "gpt-6-sol", label: "GPT-6-Sol" },
		{ id: "gpt-6-luna", label: "GPT-6-Luna" },
	]);
	expect(parseCodexModelCatalog("not json")).toEqual([]);
	expect(parseCodexModelCatalog(JSON.stringify({ models: {} }))).toEqual([]);
});

test("runs codex debug models with the configured binary and cwd", async () => {
	const calls: Array<{ binary: string; args: string[]; cwd: string }> = [];
	const exec: AgentExec = async function* (binary, args, { cwd }) {
		calls.push({ binary, args, cwd });
		yield catalog;
	};

	expect(await discoverCodexModels("custom-codex", "/review/worktree", exec)).toEqual(
		[
			{ id: "gpt-6-astra", label: "GPT-6-Astra" },
			{ id: "gpt-6-sol", label: "GPT-6-Sol" },
			{ id: "gpt-6-luna", label: "GPT-6-Luna" },
		],
	);
	expect(calls).toEqual([
		{
			binary: "custom-codex",
			args: ["debug", "models"],
			cwd: "/review/worktree",
		},
	]);
});

test("returns an empty catalog when CLI output or execution fails", async () => {
	const malformed: AgentExec = async function* () {
		yield "not json";
	};
	const unavailable: AgentExec = async function* () {
		throw new Error("CLI missing");
	};

	expect(await discoverCodexModels("codex", "/tmp", malformed)).toEqual([]);
	expect(await discoverCodexModels("codex", "/tmp", unavailable)).toEqual([]);
});

test("aborts CLI discovery when its timeout expires", async () => {
	let signal: AbortSignal | undefined;
	const hanging: AgentExec = async function* (_binary, _args, options) {
		signal = options.signal;
		await new Promise<void>((resolve) => {
			if (signal?.aborted) {
				resolve();
				return;
			}
			signal?.addEventListener("abort", () => resolve(), { once: true });
		});
		yield "";
	};

	expect(await discoverCodexModels("codex", "/tmp", hanging, 10)).toEqual([]);
	expect(signal?.aborted).toBe(true);
});
