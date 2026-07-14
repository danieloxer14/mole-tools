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

	test("seeds the default ralph-init-system prompt when missing", async () => {
		const dir = await promptsDir();
		const prompt = await loadPrompt("ralph-init-system", dir);
		expect(prompt).toContain("## Goal");
		expect(prompt).toContain("## Deliverable");
		expect(prompt).toContain("## Task checklist");
		expect(prompt).toContain("## Stale-prompt guard");
		expect(prompt).toContain("## Completion gate");
		expect(prompt).toContain("## Iteration protocol");
		expect(prompt).toContain("TDD red → green");
		expect(prompt).toContain("until the end of the current ticket");
		expect(prompt).toContain("preserves recoverable progress");
		expect(await Bun.file(join(dir, "ralph-init-system.md")).exists()).toBe(true);
	});

	test("seeds the default ralph-implement-system prompt when missing", async () => {
		const dir = await promptsDir();
		const prompt = await loadPrompt("ralph-implement-system", dir);
		expect(prompt).toContain("TDD where possible");
		expect(prompt).toContain("pre-agreed seams");
		expect(prompt).toContain("typechecking regularly");
		expect(prompt).toContain("full test suite once at the end");
		expect(prompt).toContain("Ralph task file");
		expect(await Bun.file(join(dir, "ralph-implement-system.md")).exists()).toBe(true);
	});

	test("seeds the default ralph-reflection-system prompt when missing", async () => {
		const dir = await promptsDir();
		const prompt = await loadPrompt("ralph-reflection-system", dir);
		expect(prompt).toContain("What has been accomplished so far?");
		expect(prompt).toContain("What's working well?");
		expect(prompt).toContain("blocking progress");
		expect(prompt).toContain("approach be adjusted");
		expect(prompt).toContain("next priorities");
		expect(prompt).toContain("uncheck");
		expect(prompt).toContain("add unchecked tasks");
		expect(await Bun.file(join(dir, "ralph-reflection-system.md")).exists()).toBe(true);
	});

	test("reads user-edited ralph-init-system prompt without overwriting", async () => {
		const dir = await promptsDir();
		await Bun.write(
			join(dir, "ralph-init-system.md"),
			"Custom Ralph init prompt.\n",
		);
		const prompt = await loadPrompt("ralph-init-system", dir);
		expect(prompt).toBe("Custom Ralph init prompt.");
	});

	test("reads user-edited ralph-implement-system prompt without overwriting", async () => {
		const dir = await promptsDir();
		await Bun.write(
			join(dir, "ralph-implement-system.md"),
			"Custom Ralph implement prompt.\n",
		);
		const prompt = await loadPrompt("ralph-implement-system", dir);
		expect(prompt).toBe("Custom Ralph implement prompt.");
	});

	test("reads user-edited ralph-reflection-system prompt without overwriting", async () => {
		const dir = await promptsDir();
		await Bun.write(
			join(dir, "ralph-reflection-system.md"),
			"Custom Ralph reflection prompt.\n",
		);
		const prompt = await loadPrompt("ralph-reflection-system", dir);
		expect(prompt).toBe("Custom Ralph reflection prompt.");
	});

	test("seeds ralph prompts only once — second call returns same content", async () => {
		const dir = await promptsDir();
		const prompt1 = await loadPrompt("ralph-init-system", dir);
		const prompt2 = await loadPrompt("ralph-init-system", dir);
		expect(prompt1).toBe(prompt2);
	});
});
