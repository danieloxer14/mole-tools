import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PortError } from "../../core/errors";
import { CONFIG_TEMPLATE, loadConfig } from "./loader";

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

	test("loads and parses a valid config file", async () => {
		const path = await configPath();
		const valid = {
			ollama: {
				commitModel: "custom-model",
				baseUrl: "http://localhost:11434",
			},
			commitSystemPrompt: "custom prompt",
			jira: { enabled: false, branchPattern: "[A-Z]+-[0-9]+" },
			diff: { ignore: [] },
		};
		await Bun.write(path, JSON.stringify(valid));
		const config = await loadConfig(path);
		expect(config).toEqual(valid);
	});

	test("throws a precise error for a bad config key", async () => {
		const path = await configPath();
		await Bun.write(path, JSON.stringify({ ollama: { commitModel: 123 } }));
		await expect(loadConfig(path)).rejects.toThrow(PortError);
		await expect(loadConfig(path)).rejects.toThrow(/ollama\.commitModel/);
	});
});
