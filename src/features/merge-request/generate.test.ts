import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLlm } from "../../../test/fakes/FakeLlm";
import { fakeContext } from "../../../test/fakes/fakeContext";
import { DEFAULT_PROMPTS } from "../../adapters/prompts/defaults";
import { AbortError } from "../../core/errors";
import { generateMergeRequest, loadMergeRequestPrompt } from "./generate";

let promptDir: string;

afterEach(async () => {
	if (promptDir) await rm(promptDir, { recursive: true, force: true });
});

describe("generateMergeRequest", () => {
	test("uses the configured model and does not validate the body", async () => {
		const llm = new FakeLlm([["Title: feat: valid\n\nnot conventional: body"]]);
		const ctx = fakeContext({ llm });
		const result = await generateMergeRequest(ctx, { commits: [], diff: [] });
		expect(result).toEqual({
			title: "feat: valid",
			body: "not conventional: body",
		});
		// Model comes from resolveLlmProvider — with the legacy fallback it picks up the default
		expect(llm.requests[0]?.model).toBeDefined();
	});

	test("uses only the selected plan prompt", async () => {
		promptDir = await mkdtemp(join(tmpdir(), "mole-tools-prompts-"));
		await Bun.write(join(promptDir, "mr-code.md"), "Code prompt");
		await Bun.write(join(promptDir, "mr-system.md"), "Legacy code prompt");
		await Bun.write(join(promptDir, "mr-plan.md"), "Plan prompt");
		const llm = new FakeLlm([
			["Title: feat: describe implementation plan\n\nBody"],
		]);
		const ctx = fakeContext({ llm });

		await generateMergeRequest(ctx, {
			commits: [],
			diff: [],
			mode: "plan",
			promptSourceDir: promptDir,
		});

		expect(llm.requests[0]?.system).toBe("Plan prompt");
		expect(llm.requests[0]?.prompt).toContain("Plan prompt");
		expect(llm.requests[0]?.prompt).not.toContain("Code prompt");
		expect(llm.requests[0]?.prompt).not.toContain("Legacy code prompt");
	});

	test("uses identical prompt selection for omitted and explicit code mode", async () => {
		promptDir = await mkdtemp(join(tmpdir(), "mole-tools-prompts-"));

		const omitted = await loadMergeRequestPrompt(undefined, promptDir);
		const explicit = await loadMergeRequestPrompt("code", promptDir);

		expect(omitted).toBe(explicit);
		expect(await Bun.file(join(promptDir, "mr-code.md")).exists()).toBe(true);
	});

	test("seeds the plan prompt without consulting mr-system", async () => {
		promptDir = await mkdtemp(join(tmpdir(), "mole-tools-prompts-"));
		await Bun.write(join(promptDir, "mr-system.md"), "Legacy code prompt");

		const prompt = await loadMergeRequestPrompt("plan", promptDir);

		expect(prompt).toBe(DEFAULT_PROMPTS["mr-plan"].trim());
		expect(await Bun.file(join(promptDir, "mr-plan.md")).exists()).toBe(true);
		expect(prompt).not.toBe("Legacy code prompt");
		expect(prompt).toContain("## Purpose & rationale");
		expect(prompt).toContain("## Coverage / scope");
		expect(prompt).toContain("## Key decisions");
	});

	test("retries invalid titles at most three times and reports violations", async () => {
		const llm = new FakeLlm([["bad"], ["also bad"], ["still bad"]]);
		const ctx = fakeContext({ llm });
		try {
			await generateMergeRequest(ctx, { commits: [], diff: [] });
			throw new Error("expected generation to abort");
		} catch (error) {
			expect(error).toBeInstanceOf(AbortError);
			expect((error as Error).message).toMatch(/format checks/);
		}
		expect(llm.requests).toHaveLength(3);
	});
});
