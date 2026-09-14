import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLlm } from "../../../test/fakes/FakeLlm";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import { fakeContext } from "../../../test/fakes/fakeContext";
import { CONFIG_TEMPLATE } from "../../adapters/config/loader";
import { ConfigSchema } from "../../adapters/config/schema";
import { runCommitFlow } from "./index";

let promptDir: string | undefined;

afterEach(async () => {
	if (promptDir) await rm(promptDir, { recursive: true, force: true });
	promptDir = undefined;
});

describe("runCommitFlow", () => {
	test("uses the configured commit-system preset", async () => {
		promptDir = await mkdtemp(join(tmpdir(), "mole-tools-commit-prompts-"));
		const llm = new FakeLlm([["feat(AST-1): terse subject"]]);
		const config = ConfigSchema.parse({
			...CONFIG_TEMPLATE,
			prompts: { "commit-system": "terse" },
		});
		const ctx = fakeContext({
			config,
			llm,
			vcs: new FakeVcs({ staged: true, diff: [] }),
		});

		await Bun.write(
			join(promptDir, "commit-system", "terse", "001.md"),
			"Terse commit prompt.",
		);
		await runCommitFlow(ctx, { auto: true, promptSourceDir: promptDir });

		expect(llm.requests[0]?.prompt).toContain("Terse commit prompt.");
		expect(llm.requests[0]?.providerKey).toBe(config.models.commit.provider);
		expect(llm.requests[0]?.model).toBe(config.models.commit.name);
	});

	test("falls back to the default preset when none is configured", async () => {
		promptDir = await mkdtemp(join(tmpdir(), "mole-tools-commit-prompts-"));
		const llm = new FakeLlm([["feat(AST-1): default subject"]]);
		const config = ConfigSchema.parse(CONFIG_TEMPLATE);
		const ctx = fakeContext({
			config,
			llm,
			vcs: new FakeVcs({ staged: true, diff: [] }),
		});

		await runCommitFlow(ctx, { auto: true, promptSourceDir: promptDir });

		expect(
			await Bun.file(
				join(promptDir, "commit-system", "default", "001.md"),
			).exists(),
		).toBe(true);
		expect(llm.requests[0]?.prompt).toContain("Conventional Commits");
		expect(llm.requests[0]?.providerKey).toBe(config.models.commit.provider);
		expect(llm.requests[0]?.model).toBe(config.models.commit.name);
	});
});
