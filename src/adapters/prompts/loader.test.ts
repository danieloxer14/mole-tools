import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PortError } from "../../core/errors";
import { DEFAULT_PROMPTS } from "./defaults";
import {
	activePreset,
	listPresets,
	listVersions,
	loadPrompt,
	readPrompt,
	savePrompt,
} from "./loader";

let dir: string;

async function promptsDir(): Promise<string> {
	dir = await mkdtemp(join(tmpdir(), "mole-tools-prompts-"));
	return dir;
}

async function writeVersion(
	root: string,
	slot: string,
	preset: string,
	version: string,
	text: string,
): Promise<void> {
	const presetDir = join(root, slot, preset);
	await mkdir(presetDir, { recursive: true });
	await Bun.write(join(presetDir, version), text);
}

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("prompt store", () => {
	test("seeds default/001.md on first read", async () => {
		const root = await promptsDir();
		const prompt = await loadPrompt("commit-system", { dir: root });

		expect(prompt).toBe(DEFAULT_PROMPTS["commit-system"].trim());
		expect(
			await Bun.file(join(root, "commit-system", "default", "001.md")).text(),
		).toBe(DEFAULT_PROMPTS["commit-system"]);
	});
	test("seeds layer defaults without BDD output instructions", async () => {
		const root = await promptsDir();
		for (const slot of ["review-layers-code", "review-layers-plan"] as const) {
			const prompt = await loadPrompt(slot, { dir: root });
			expect(prompt).toBe(DEFAULT_PROMPTS[slot].trim());
			expect(prompt).not.toMatch(/\bBDD\b|Given\/When\/Then|\bbdd\b/i);
		}
	});

	test("preserves an existing layer prompt version when the shipped default changes", async () => {
		const root = await promptsDir();
		const custom = "Custom layer prompt with local verification rules.\n";
		await writeVersion(root, "review-layers-code", "default", "001.md", custom);

		expect(await loadPrompt("review-layers-code", { dir: root })).toBe(
			custom.trim(),
		);
		expect(
			await Bun.file(
				join(root, "review-layers-code", "default", "001.md"),
			).text(),
		).toBe(custom);
	});
	test("preserves flat legacy layer prompts without a migration bump", async () => {
		const root = await promptsDir();
		for (const slot of ["review-layers-code", "review-layers-plan"] as const) {
			const text =
				"Legacy layer prompt with Given/When/Then BDD instructions.\n";
			await Bun.write(join(root, `${slot}.md`), text);

			expect(await loadPrompt(slot, { dir: root })).toBe(text.trim());
			expect(await listVersions(slot, "default", root)).toEqual([1]);
			expect(await Bun.file(join(root, slot, "default", "001.md")).text()).toBe(
				text,
			);
		}
	});

	test("returns an existing version unchanged", async () => {
		const root = await promptsDir();
		const text = "Custom prompt with trailing newline.\n";
		await writeVersion(root, "commit-system", "default", "001.md", text);

		const prompt = await readPrompt("commit-system", { dir: root });

		expect(prompt.text).toBe(text);
		expect(prompt.version).toBe(1);
	});

	test("seeds shipped default before appending an edited version", async () => {
		const root = await promptsDir();
		const version = await savePrompt("commit-system", {
			preset: "default",
			text: "Edited prompt",
			dir: root,
		});

		expect(version).toBe(2);
		expect(await listVersions("commit-system", "default", root)).toEqual([
			1, 2,
		]);
		expect(
			(
				await readPrompt("commit-system", {
					preset: "default",
					version: 1,
					dir: root,
				})
			).text,
		).toBe(DEFAULT_PROMPTS["commit-system"]);
		expect(
			(
				await readPrompt("commit-system", {
					preset: "default",
					version: 2,
					dir: root,
				})
			).text,
		).toBe("Edited prompt");
	});

	test("reads an explicitly requested version", async () => {
		const root = await promptsDir();
		await writeVersion(root, "review-chat", "default", "001.md", "first");
		await writeVersion(root, "review-chat", "default", "002.md", "second");

		const prompt = await readPrompt("review-chat", {
			preset: "default",
			version: 1,
			dir: root,
		});

		expect(prompt).toEqual({ text: "first", preset: "default", version: 1 });
	});

	test("lists default and extra presets in sorted order", async () => {
		const root = await promptsDir();
		await mkdir(join(root, "review-chat", "zeta"), { recursive: true });
		await mkdir(join(root, "review-chat", "alpha"), { recursive: true });

		expect(await listPresets("review-chat", root)).toEqual([
			"alpha",
			"default",
			"zeta",
		]);
	});

	test("lists version numbers in ascending order", async () => {
		const root = await promptsDir();
		await writeVersion(root, "review-chat", "default", "010.md", "ten");
		await writeVersion(root, "review-chat", "default", "002.md", "two");
		await writeVersion(root, "review-chat", "default", "001.md", "one");
		await writeVersion(root, "review-chat", "default", "notes.md", "ignored");

		expect(await listVersions("review-chat", "default", root)).toEqual([
			1, 2, 10,
		]);
	});

	test("migrates a flat slot file into default/001.md", async () => {
		const root = await promptsDir();
		const text = "Legacy commit prompt\n";
		await Bun.write(join(root, "commit-system.md"), text);

		expect(await loadPrompt("commit-system", { dir: root })).toBe(text.trim());
		expect(
			await Bun.file(join(root, "commit-system", "default", "001.md")).text(),
		).toBe(text);
	});

	test("migrates mr-system.md into mr-code when mr-code.md is absent", async () => {
		const root = await promptsDir();
		const text = "Legacy MR code prompt\n";
		await Bun.write(join(root, "mr-system.md"), text);

		expect(await loadPrompt("mr-code", { dir: root })).toBe(text.trim());
		expect(
			await Bun.file(join(root, "mr-code", "default", "001.md")).text(),
		).toBe(text);
	});

	test("prefers mr-code.md when both legacy flat files exist", async () => {
		const root = await promptsDir();
		await Bun.write(join(root, "mr-code.md"), "Current code prompt\n");
		await Bun.write(join(root, "mr-system.md"), "Legacy code prompt\n");

		expect(await loadPrompt("mr-code", { dir: root })).toBe(
			"Current code prompt",
		);
		expect(
			await Bun.file(join(root, "mr-code", "default", "001.md")).text(),
		).toBe("Current code prompt\n");
	});

	test("rejects invalid preset names", async () => {
		const root = await promptsDir();
		await expect(
			savePrompt("commit-system", {
				preset: "Bad Name",
				text: "invalid",
				dir: root,
			}),
		).rejects.toThrow("Invalid preset name");
	});

	test("throws PortError for a missing preset", async () => {
		const root = await promptsDir();
		await expect(
			readPrompt("commit-system", { preset: "custom", dir: root }),
		).rejects.toThrow(PortError);
		await expect(
			readPrompt("commit-system", { preset: "custom", dir: root }),
		).rejects.toThrow("Prompt preset 'custom' not found for commit-system");
	});
	test("throws PortError for a missing version", async () => {
		const root = await promptsDir();
		await expect(
			readPrompt("commit-system", { version: 2, dir: root }),
		).rejects.toThrow(PortError);
	});

	test("seeds the explain-comment prompt when missing", async () => {
		const dir = await promptsDir();
		const prompt = await loadPrompt("review-explain-comment", { dir });
		expect(prompt).toContain("Explain the following merge request comment");
		expect(
			await Bun.file(
				join(dir, "review-explain-comment", "default", "001.md"),
			).exists(),
		);
	});

	test("defines a default for every prompt name", () => {
		expect(Object.keys(DEFAULT_PROMPTS).sort()).toEqual([
			"commit-system",
			"mr-code",
			"mr-plan",
			"review-chat",
			"review-explain-comment",
			"review-layers-code",
			"review-layers-plan",
		]);
		for (const value of Object.values(DEFAULT_PROMPTS)) {
			expect(typeof value).toBe("string");
			expect(value.trim().length).toBeGreaterThan(0);
		}
	});
});

describe("activePreset", () => {
	test("returns the configured preset for a slot", () => {
		expect(
			activePreset({ prompts: { "commit-system": "terse" } }, "commit-system"),
		).toBe("terse");
	});

	test("falls back to default when config, map, or slot is absent", () => {
		expect(activePreset(undefined, "commit-system")).toBe("default");
		expect(activePreset({}, "commit-system")).toBe("default");
		expect(activePreset({ prompts: {} }, "commit-system")).toBe("default");
	});
});
