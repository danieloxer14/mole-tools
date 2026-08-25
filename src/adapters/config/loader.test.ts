import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PortError } from "../../core/errors";
import { CONFIG_TEMPLATE, CONFIG_TEMPLATE_TEXT, loadConfig } from "./loader";
import { resolveLlmProvider } from "./schema";

let dir: string;
const staleReviewKey = ["mr", "Review"].join("");
const staleLoopKey = ["ra", "lph"].join("");

async function configPath(): Promise<string> {
	dir = await mkdtemp(join(tmpdir(), "mole-tools-config-"));
	return join(dir, "config.json");
}

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
	test("documents only surviving model routes in the template", () => {
		expect(CONFIG_TEMPLATE_TEXT).toContain(
			'"mergeRequest": { "provider": "ollama", "name": "gemma4:12b" }',
		);
		expect(CONFIG_TEMPLATE_TEXT).not.toContain(`"${staleReviewKey}"`);
		expect(CONFIG_TEMPLATE_TEXT).not.toContain(`"${staleLoopKey}"`);
		expect(CONFIG_TEMPLATE.models).toEqual({
			commit: { provider: "ollama", name: "gemma4:12b" },
			mergeRequest: { provider: "ollama", name: "gemma4:12b" },
		});
		expect(CONFIG_TEMPLATE.review).toEqual({
			agent: "omp",
			layerTimeoutSeconds: 600,
			largeFileLineThreshold: 800,
		});
		expect(CONFIG_TEMPLATE_TEXT).toContain('// "review": {');
	});

	test("bootstraps a template when no config file exists, then continues", async () => {
		const path = await configPath();
		const config = await loadConfig(path);
		expect(config).toEqual(CONFIG_TEMPLATE);
		expect(await Bun.file(path).exists()).toBe(true);
	});

	test("loads and parses a legacy ollama-only config without removed routes", async () => {
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

		expect(config.models).toEqual({
			commit: { provider: "ollama", name: "custom-model" },
			mergeRequest: { provider: "ollama", name: "custom-model" },
		});
		expect(config.providers?.ollama).toEqual({
			provider: "ollama",
			baseUrl: "http://localhost:11434",
		});
		const legacyConfig = config as unknown as {
			llm?: Record<string, string>;
			ollama?: { commitModel?: string };
		};
		expect(legacyConfig.llm).toEqual({
			commit: "ollama",
			mergeRequest: "ollama",
		});
		expect(legacyConfig.ollama?.commitModel).toBe("custom-model");
	});

	test("throws a precise error for a bad config key", async () => {
		const path = await configPath();
		await Bun.write(path, JSON.stringify({ ollama: { commitModel: 123 } }));
		await expect(loadConfig(path)).rejects.toThrow(PortError);
		await expect(loadConfig(path)).rejects.toThrow(/ollama\.commitModel/);
	});

	test("rejects stale model routes with an Invalid config error", async () => {
		const path = await configPath();
		const stale = {
			providers: {
				ollama: { provider: "ollama", baseUrl: "http://localhost:11434" },
			},
			models: {
				commit: { provider: "ollama", name: "llama3.1" },
				mergeRequest: { provider: "ollama", name: "llama3.1" },
				[staleReviewKey]: { provider: "ollama", name: "llama3.1" },
			},
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
		};
		await Bun.write(path, JSON.stringify(stale));

		const error = await loadConfig(path).catch((value: unknown) => value);
		expect(error).toBeInstanceOf(PortError);
		expect((error as PortError).message).toContain(`Invalid config at ${path}`);
		expect((error as PortError).message).toContain(staleReviewKey);
	});

	test("loads new provider-based config format", async () => {
		const path = await configPath();
		const valid = {
			providers: {
				ollama: { provider: "ollama", baseUrl: "http://localhost:11434" },
			},
			models: {
				commit: { provider: "ollama", name: "llama3.1" },
				mergeRequest: { provider: "ollama", name: "llama3.1" },
			},
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
		} as const;
		await Bun.write(path, JSON.stringify(valid));

		const config = await loadConfig(path);

		expect(config.providers).toEqual(valid.providers);
		expect(config.models).toEqual(valid.models);
	});
	test("loads previously supported worktree prune settings", async () => {
		const path = await configPath();
		const valid = {
			providers: {
				ollama: { provider: "ollama", baseUrl: "http://localhost:11434" },
			},
			models: {
				commit: { provider: "ollama", name: "llama3.1" },
				mergeRequest: { provider: "ollama", name: "llama3.1" },
			},
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
			worktreePrune: { baseDir: "/tmp/repos" },
		} as const;
		await Bun.write(path, JSON.stringify(valid));

		const config = await loadConfig(path);

		expect(config.worktreePrune).toEqual(valid.worktreePrune);
	});
	test("loads optional review agent settings with strict defaults", async () => {
		const path = await configPath();
		const valid = {
			providers: {
				ollama: { provider: "ollama", baseUrl: "http://localhost:11434" },
			},
			models: {
				commit: { provider: "ollama", name: "llama3.1" },
				mergeRequest: { provider: "ollama", name: "llama3.1" },
			},
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
			review: {
				agent: "claude",
				binary: "claude-custom",
				model: "review-model",
				layerTimeoutSeconds: 30,
				largeFileLineThreshold: 200,
			},
		} as const;
		await Bun.write(path, JSON.stringify(valid));

		const config = await loadConfig(path);

		expect(config.review).toEqual(valid.review);
	});

	test("rejects unknown review settings under strict parsing", async () => {
		const path = await configPath();
		await Bun.write(
			path,
			JSON.stringify({
				providers: {
					ollama: {
						provider: "ollama",
						baseUrl: "http://localhost:11434",
					},
				},
				models: {
					commit: { provider: "ollama", name: "llama3.1" },
					mergeRequest: { provider: "ollama", name: "llama3.1" },
				},
				jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
				diff: { ignore: [] },
				review: { agent: "omp", unsupported: true },
			}),
		);

		await expect(loadConfig(path)).rejects.toThrow(/review.*unsupported/);
	});

	test("migrates provider and legacy llm config without removed routes", async () => {
		const path = await configPath();
		const legacy = {
			providers: {
				ollama: { provider: "ollama", baseUrl: "http://localhost:11434" },
			},
			llm: { commit: "ollama", mergeRequest: "ollama", [staleLoopKey]: "pi" },
			models: { default: "llama3.1" },
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
		};
		await Bun.write(path, JSON.stringify(legacy));

		const config = await loadConfig(path);

		expect(config.models).toEqual({
			commit: { provider: "ollama", name: "llama3.1" },
			mergeRequest: { provider: "ollama", name: "llama3.1" },
		});
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
		const ollama = config.providers?.ollama;
		expect(
			ollama && "baseUrl" in ollama && typeof ollama.baseUrl === "string"
				? ollama.baseUrl
				: undefined,
		).toBe("http://localhost:11434");
	});
});

describe("resolveLlmProvider", () => {
	test("resolves commit provider from routing config", () => {
		const config = CONFIG_TEMPLATE;
		const result = resolveLlmProvider(config, "commit");
		expect(result.providerKey).toBe("ollama");
	});

	test("falls back to legacy ollama section when no providers defined", () => {
		const config = {
			ollama: { commitModel: "llama3.1", baseUrl: "http://localhost:11434" },
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
			llm: { commit: "ollama", mergeRequest: "ollama" } as const,
		} as never;
		const result = resolveLlmProvider(config, "commit");
		expect(result.providerKey).toBe("ollama");
		expect(result.providerProfile).toEqual({
			provider: "ollama",
			baseUrl: "http://localhost:11434",
		});
		expect(result.model).toBe("llama3.1");
	});

	test("returns the configured model for each surviving feature purpose", () => {
		const config = {
			providers: {
				ollama: {
					provider: "ollama" as const,
					baseUrl: "http://localhost:11434",
				},
				pix: { provider: "pi" as const, binary: "pi" },
			},
			models: {
				commit: { provider: "ollama", name: "commit-model" },
				mergeRequest: { provider: "pix", name: "merge-model" },
			} as const,
			diff: { ignore: [] },
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" } as const,
		};

		const commit = resolveLlmProvider(config, "commit");
		expect(commit.providerProfile.provider).toBe("ollama");
		expect(commit.model).toBe("commit-model");

		const mergeRequest = resolveLlmProvider(config, "mergeRequest");
		expect(mergeRequest.providerKey).toBe("pix");
		expect(mergeRequest.model).toBe("merge-model");
	});
});
