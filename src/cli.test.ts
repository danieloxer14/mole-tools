import { describe, expect, test } from "bun:test";
import cac from "cac";
import { z } from "zod";
import { applyZodOptions } from "./cli/options";
import { commit } from "./features/commit";

describe("commit CLI option parsing", () => {
	test("parses bare --auto as true and omission as false", () => {
		const withAuto = cac("mole-tools");
		const autoCommand = withAuto.command("commit");
		applyZodOptions(autoCommand, commit.args);
		const autoArgs = commit.args.parse(
			withAuto.parse(["bun", "mole-tools", "commit", "--auto"], { run: false }).options,
		);

		const withoutAuto = cac("mole-tools");
		const defaultCommand = withoutAuto.command("commit");
		applyZodOptions(defaultCommand, commit.args);
		const defaultArgs = commit.args.parse(
			withoutAuto.parse(["bun", "mole-tools", "commit"], { run: false }).options,
		);

		expect(autoArgs.auto).toBe(true);
		expect(defaultArgs.auto).toBe(false);
	});

	test("detects boolean through Optional + Default wrapping", () => {
		// Real-world schema uses .boolean().optional().default(false)
		const schema = z.object({
			auto: z.boolean().optional().default(false),
			context: z.string().optional(),
		});

		const cli = cac("mole-tools");
		const cmd = cli.command("commit");
		applyZodOptions(cmd, schema);

		// Should work as bare flag (no <value> placeholder)
		const parsed = cli.parse(
			["bun", "mole-tools", "commit", "--auto"],
			{ run: false },
		);
		const args = schema.parse(parsed.options);

		expect(args.auto).toBe(true);
	});
});
