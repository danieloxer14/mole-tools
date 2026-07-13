import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { PortError } from "../../core/errors";
import { CONFIG_TEMPLATE, loadConfig } from "./loader";
import { resolveLlmProvider } from "./schema";

let dir: string;

async function configPath(): Promise<string> {
	dir = await mkdtemp(join(tmpdir(), "mole-tools-config-"));
	return join(dir, "config.json");
}

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
	test("bootstraps a template when no config file exists, then continues", async () => {
		const path = await configPath();
		const config = await loadConfig(path);
		expect(config).toEqual(CONFIG_TEMPLATE);
		expect(await Bun.file(path).exists()).toBe(true);
	});

	test("loads and parses a legacy ollama-only config, migrating to provider format", async () => {
		const path = await configPath();
		const valid = {
			ollama: {
				commitModel: "custom-model",
				baseUrl: "http://localhost:11434",
			},
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
		};
		await Bun.write(path, JSON.stringify(valid));
		const config = await loadConfig(path);
		// Legacy is migrated to include providers + llm routing
		expect(config.providers?.ollama).toEqual({
			provider: "ollama",
			baseUrl: "http://localhost:11434",
		});
		expect(config.llm.commit).toBe("ollama");
		expect(config.ollama?.commitModel).toBe("custom-model"); // legacy field preserved
	});

	test("throws a precise error for a bad config key", async () => {
		const path = await configPath();
		await Bun.write(path, JSON.stringify({ ollama: { commitModel: 123 } }));
		await expect(loadConfig(path)).rejects.toThrow(PortError);
		await expect(loadConfig(path)).rejects.toThrow(/ollama\.commitModel/);
	});

	test("loads new provider-based config format", async () => {
		const path = await configPath();
		const valid = {
			providers: {
				ollama: { provider: "ollama", baseUrl: "http://localhost:11434" },
			},
			llm: { commit: "ollama", mergeRequest: "ollama", ralph: "pi" },
			models: { default: "llama3.1" },
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
		};
		await Bun.write(path, JSON.stringify(valid));
		const config = await loadConfig(path);
		expect(config.providers).toEqual(valid.providers);
		expect(config.llm).toEqual(valid.llm);
	});

	test("migrates legacy ollama-only config to new format with providers", async () => {
		const path = await configPath();
		const legacy = {
			ollama: {
				commitModel: "llama3.1",
				baseUrl: "http://localhost:11434",
			},
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
		};
		await Bun.write(path, JSON.stringify(legacy));
		const config = await loadConfig(path);
		expect(config).toBeDefined();
		expect(config.providers?.ollama?.baseUrl).toBe("http://localhost:11434");
	});
});

describe("resolveLlmProvider", () => {
	test("resolves commit provider from routing config", () => {
		const config = CONFIG_TEMPLATE;
		const result = resolveLlmProvider(config, "commit");
		expect(result.providerKey).toBe("ollama");
	});

	test("resolves ralph provider to pi by default", () => {
		const config = CONFIG_TEMPLATE;
		const result = resolveLlmProvider(config, "ralph");
		expect(result.providerKey).toBe("pi");
	});

	test("falls back to legacy ollama section when no providers defined", () => {
		const config = {
			ollama: { commitModel: "llama3.1", baseUrl: "http://localhost:11434" },
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
			llm: { commit: "ollama", mergeRequest: "ollama", ralph: "pi" } as const,
		} as any;
		const result = resolveLlmProvider(config, "commit");
		expect(result.providerKey).toBe("ollama");
		expect(result.providerProfile).toEqual({
			provider: "ollama",
			baseUrl: "http://localhost:11434",
		});
		expect(result.model).toBe("llama3.1");
	});

	test("returns the configured model for each feature purpose", () => {
		const config = {
			providers: {
				ollama: { provider: "ollama" as const, baseUrl: "http://localhost:11434" },
				pix: { provider: "pi" as const, binary: "pi" },
			},
			models: { default: "gpt-4" } as const,
			llm: { commit: "ollama", mergeRequest: "pix", ralph: "pix" } as const,
			diff: { ignore: [] } as const,
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" } as const,
		};
		const commit = resolveLlmProvider(config, "commit");
		expect(commit.providerProfile.provider).toBe("ollama");

		const mr = resolveLlmProvider(config, "mergeRequest");
		expect(mr.providerKey).toBe("pix");
	});
});
