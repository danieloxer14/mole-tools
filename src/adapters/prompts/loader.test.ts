import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROMPTS } from "./defaults";
import { loadPrompt, loadPromptWithFallback } from "./loader";

let dir: string;

async function promptsDir(): Promise<string> {
	dir = await mkdtemp(join(tmpdir(), "mole-tools-prompts-"));
	return dir;
}

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("loadPrompt", () => {
	test("seeds the current merge request prompt when missing", async () => {
		const dir = await promptsDir();
		const prompt = await loadPrompt("mr-system", dir);
		expect(prompt).toContain("# MR Description");
		expect(prompt).toContain("under 60 seconds");
		expect(await Bun.file(join(dir, "mr-system.md")).exists()).toBe(true);
	});

	test("seeds the default prompt when the file doesn't exist", async () => {
		const dir = await promptsDir();
		const prompt = await loadPrompt("commit-system", dir);
		expect(prompt).toContain("Conventional Commits");
		expect(prompt).toContain("Place the ticket key");
		expect(await Bun.file(join(dir, "commit-system.md")).exists()).toBe(true);
	});

	test("reads a user-edited prompt instead of overwriting it", async () => {
		const dir = await promptsDir();
		await Bun.write(join(dir, "commit-system.md"), "Custom system prompt.\n");
		const prompt = await loadPrompt("commit-system", dir);
		expect(prompt).toBe("Custom system prompt.");
	});
});

describe("loadPromptWithFallback", () => {
	test("uses the first existing prompt in lookup order", async () => {
		const dir = await promptsDir();
		await Bun.write(join(dir, "mr-system.md"), "Legacy code prompt");
		await Bun.write(join(dir, "mr-code.md"), "Preferred code prompt");

		const prompt = await loadPromptWithFallback(["mr-code", "mr-system"], dir);
		expect(prompt).toBe("Preferred code prompt");
	});

	test("uses the legacy code prompt without seeding mr-code", async () => {
		const dir = await promptsDir();
		await Bun.write(join(dir, "mr-system.md"), "Legacy code prompt");

		const prompt = await loadPromptWithFallback(["mr-code", "mr-system"], dir);
		expect(prompt).toBe("Legacy code prompt");
		expect(await Bun.file(join(dir, "mr-code.md")).exists()).toBe(false);
	});

	test("seeds the first prompt when no fallback exists", async () => {
		const dir = await promptsDir();

		const prompt = await loadPromptWithFallback(["mr-code", "mr-system"], dir);
		expect(prompt).toBe(DEFAULT_PROMPTS["mr-code"].trim());
		expect(await Bun.file(join(dir, "mr-code.md")).exists()).toBe(true);
	});

	test("keeps the code default byte-equivalent to mr-system", () => {
		expect(DEFAULT_PROMPTS["mr-code"]).toBe(DEFAULT_PROMPTS["mr-system"]);
	});
});
