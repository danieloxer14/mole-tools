import { describe, expect, test } from "bun:test";
import cac from "cac";
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
});
