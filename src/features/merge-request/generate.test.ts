import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLlm } from "../../../test/fakes/FakeLlm";
import { fakeContext } from "../../../test/fakes/fakeContext";
import { CONFIG_TEMPLATE } from "../../adapters/config/loader";
import { ConfigSchema } from "../../adapters/config/schema";
import { DEFAULT_PROMPTS } from "../../adapters/prompts/defaults";
import { AbortError } from "../../core/errors";
import { generateMergeRequest, loadMergeRequestPrompt } from "./generate";

let promptDir: string;

async function tempPromptDir(): Promise<string> {
	promptDir = await mkdtemp(join(tmpdir(), "mole-tools-prompts-"));
	return promptDir;
}

async function writePrompt(
	slot: string,
	text: string,
	preset = "default",
): Promise<void> {
	const slotDir = join(promptDir, slot, preset);
	await mkdir(slotDir, { recursive: true });
	await Bun.write(join(slotDir, "001.md"), text);
}

afterEach(async () => {
	if (promptDir) await rm(promptDir, { recursive: true, force: true });
});

describe("generateMergeRequest", () => {
	test("uses the configured model and does not validate the body", async () => {
		const dir = await tempPromptDir();
		const llm = new FakeLlm([["Title: feat: valid\n\nnot conventional: body"]]);
		const ctx = fakeContext({ llm });
		const result = await generateMergeRequest(ctx, {
			commits: [],
			diff: [],
			promptSourceDir: dir,
		});
		expect(result).toEqual({
			title: "feat: valid",
			body: "not conventional: body",
		});
		expect(llm.requests[0]?.model).toBeDefined();
	});

	test("uses configured code preset", async () => {
		const dir = await tempPromptDir();
		await writePrompt("mr-code", "Terse code prompt", "terse");
		const llm = new FakeLlm([["Title: feat: describe implementation\n\nBody"]]);
		const ctx = fakeContext({
			llm,
			config: ConfigSchema.parse({
				...CONFIG_TEMPLATE,
				prompts: { "mr-code": "terse" },
			}),
		});

		await generateMergeRequest(ctx, {
			commits: [],
			diff: [],
			promptSourceDir: dir,
		});

		expect(llm.requests[0]?.system).toBe("Terse code prompt");
	});

	test("uses configured plan preset without reading mr-code", async () => {
		const dir = await tempPromptDir();
		await writePrompt("mr-plan", "Terse plan prompt", "terse");
		const llm = new FakeLlm([
			["Title: feat: describe implementation plan\n\nBody"],
		]);
		const ctx = fakeContext({
			llm,
			config: ConfigSchema.parse({
				...CONFIG_TEMPLATE,
				prompts: { "mr-code": "terse", "mr-plan": "terse" },
			}),
		});

		await generateMergeRequest(ctx, {
			commits: [],
			diff: [],
			mode: "plan",
			promptSourceDir: dir,
		});

		expect(llm.requests[0]?.system).toBe("Terse plan prompt");
		expect(
			await Bun.file(join(dir, "mr-code", "terse", "001.md")).exists(),
		).toBe(false);
	});

	test("uses only the selected plan prompt", async () => {
		const dir = await tempPromptDir();
		await writePrompt("mr-code", "Code prompt");
		await writePrompt("mr-plan", "Plan prompt");
		const llm = new FakeLlm([
			["Title: feat: describe implementation plan\n\nBody"],
		]);
		const ctx = fakeContext({ llm });

		await generateMergeRequest(ctx, {
			commits: [],
			diff: [],
			mode: "plan",
			promptSourceDir: dir,
		});

		expect(llm.requests[0]?.system).toBe("Plan prompt");
		expect(llm.requests[0]?.prompt).toContain("Plan prompt");
		expect(llm.requests[0]?.prompt).not.toContain("Code prompt");
	});

	test("uses identical prompt selection for omitted and explicit code mode", async () => {
		const dir = await tempPromptDir();

		const omitted = await loadMergeRequestPrompt(undefined, { dir });
		const explicit = await loadMergeRequestPrompt("code", { dir });

		expect(omitted).toBe(explicit);
		expect(
			await Bun.file(join(dir, "mr-code", "default", "001.md")).exists(),
		).toBe(true);
	});

	test("seeds the plan prompt without consulting mr-system", async () => {
		const dir = await tempPromptDir();
		await Bun.write(join(dir, "mr-system.md"), "Legacy code prompt");

		const prompt = await loadMergeRequestPrompt("plan", { dir });

		expect(prompt).toBe(DEFAULT_PROMPTS["mr-plan"].trim());
		expect(
			await Bun.file(join(dir, "mr-plan", "default", "001.md")).exists(),
		).toBe(true);
		expect(prompt).not.toBe("Legacy code prompt");
		expect(prompt).toContain("## Purpose & rationale");
		expect(prompt).toContain("## Coverage / scope");
		expect(prompt).toContain("## Key decisions");
	});

	test("retries invalid titles at most three times and reports violations", async () => {
		const dir = await tempPromptDir();
		const llm = new FakeLlm([["bad"], ["also bad"], ["still bad"]]);
		const ctx = fakeContext({ llm });
		try {
			await generateMergeRequest(ctx, {
				commits: [],
				diff: [],
				promptSourceDir: dir,
			});
			throw new Error("expected generation to abort");
		} catch (error) {
			expect(error).toBeInstanceOf(AbortError);
			expect((error as Error).message).toMatch(/format checks/);
		}
		expect(llm.requests).toHaveLength(3);
	});
});
