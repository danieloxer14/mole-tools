import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrompt } from "./loader";

let dir: string;

async function promptsDir(): Promise<string> {
	dir = await mkdtemp(join(tmpdir(), "mole-tools-prompts-"));
	return dir;
}

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("loadPrompt", () => {
	test("seeds the default prompt when the file doesn't exist", async () => {
		const dir = await promptsDir();
		const prompt = await loadPrompt("commit-system", dir);
		expect(prompt).toContain("Conventional Commits");
		expect(await Bun.file(join(dir, "commit-system.md")).exists()).toBe(true);
	});

	test("reads a user-edited prompt instead of overwriting it", async () => {
		const dir = await promptsDir();
		await Bun.write(join(dir, "commit-system.md"), "Custom system prompt.\n");
		const prompt = await loadPrompt("commit-system", dir);
		expect(prompt).toBe("Custom system prompt.");
	});
});
