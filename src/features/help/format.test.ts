import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Feature } from "../../core/feature";
import {
	formatCommandHelp,
	formatGeneralHelp,
	formatUnknownCommand,
} from "./format";

function makeFeature(overrides?: Partial<Feature>): Feature {
	const args = overrides?.args ?? z.object({});
	return {
		name: "test-cmd",
		description: "A test command",
		args,
		run: async () => ({}),
		...overrides,
	};
}

describe("formatGeneralHelp", () => {
	test("renders all features with descriptions in registry order", () => {
		const features: Feature[] = [
			makeFeature({ name: "commit", description: "Commit with AI" }),
			makeFeature({ name: "init", description: "Initialize config" }),
			makeFeature({
				name: "cost-breakdown",
				description: "Show cost breakdown",
			}),
		];

		const output = formatGeneralHelp(features);

		expect(output).toContain("mole-tools");
		expect(output).toContain("Available tools:");
		expect(output).toContain("commit\t");
		expect(output).toContain("Commit with AI");
		expect(output).toContain("init\t");
		expect(output).toContain("Initialize config");
		expect(output).toContain("cost-breakdown\t");
		expect(output).toContain("Show cost breakdown");
		expect(output).toContain('Run "mole-tools help <command>" for details.');

		// Check order: commit before init before cost-breakdown
		const commitIdx = output.indexOf("commit\t");
		const initIdx = output.indexOf("init\t");
		const costIdx = output.indexOf("cost-breakdown\t");
		expect(commitIdx).toBeGreaterThan(0);
		expect(initIdx).toBeGreaterThan(commitIdx);
		expect(costIdx).toBeGreaterThan(initIdx);
	});

	test("handles empty feature list", () => {
		const output = formatGeneralHelp([]);
		expect(output).toContain("mole-tools");
		expect(output).toContain("Available tools:");
		expect(output).toContain('Run "mole-tools help <command>" for details.');
	});

	test("includes registry-added synthetic feature", () => {
		const features: Feature[] = [
			makeFeature({ name: "commit", description: "Commit with AI" }),
			makeFeature({
				name: "new-feature",
				description: "A brand new feature",
			}),
		];

		const output = formatGeneralHelp(features);
		expect(output).toContain("new-feature");
		expect(output).toContain("A brand new feature");
	});
});

describe("formatCommandHelp", () => {
	test("renders help for a no-arg command", () => {
		const feature: Feature = {
			...makeFeature({ name: "commit" }),
			help: {
				examples: [""],
				notes: ["Generates a commit message from staged changes using an LLM."],
			},
		};

		const result = formatCommandHelp(
			[{ ...feature, ...makeFeature({ name: "commit" }) }],
			"commit",
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.text).toContain("commit");
			expect(result.text).toContain("A test command");
			expect(result.text).not.toContain("Options:");
		}
	});

	test("renders help with options inferred from zod schema", () => {
		const feature: Feature = makeFeature({
			name: "worktree-prune",
			description: "Scan and prune extra git worktrees",
			args: z.object({
				baseDir: z
					.string()
					.optional()
					.describe(
						"Directory to scan recursively for git repositories with extra worktrees.",
					),
			}) as unknown as z.ZodTypeAny,
			help: {
				usage: "mole-tools worktree-prune [--baseDir <path>]",
				examples: ["--baseDir ~/dev"],
				notes: [
					"If omitted, uses worktreePrune.baseDir from config or prompts to save one.",
				],
			},
		});

		const result = formatCommandHelp([feature], "worktree-prune");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.text).toContain("worktree-prune");
			expect(result.text).toContain("Scan and prune extra git worktrees");
			expect(result.text).toContain("Usage:");
			expect(result.text).toContain("[--baseDir <path>]");
			expect(result.text).toContain("Options:");
			expect(result.text).toContain("--baseDir");
			expect(result.text).toContain(
				"Directory to scan recursively for git repositories with extra worktrees.",
			);
			expect(result.text).toContain("Examples:");
			expect(result.text).toContain("--baseDir ~/dev");
			expect(result.text).toContain("Notes:");
			expect(result.text).toContain(
				"If omitted, uses worktreePrune.baseDir from config",
			);
		}
	});

	test("renders boolean options as bare flags in usage and options", () => {
		const feature = makeFeature({
			name: "commit",
			args: z.object({
				auto: z.boolean().describe("Skip prompts and do not push"),
			}),
		});

		const result = formatCommandHelp([feature], "commit");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.text).toContain("mole-tools commit [--auto]");
			expect(result.text).toContain("  --auto\n");
			expect(result.text).not.toContain("--auto <auto>");
		}
	});

	test("renders help with zod meta examples", () => {
		const schema = z.object({
			baseDir: z
				.string()
				.optional()
				.describe(
					"Directory to scan recursively for git repositories with extra worktrees.",
				) as z.ZodTypeAny,
		});

		// Add meta manually since zod v4's .meta() may not be available in all builds
		const baseDir = (schema as z.ZodObject).shape.baseDir as z.ZodTypeAny & {
			meta?: () => unknown;
		};
		(baseDir as any).meta = () => ({
			examples: ["~/dev", "/projects"],
		});

		const feature: Feature = {
			name: "scan",
			description: "Scan a directory",
			args: schema,
			run: async () => ({}),
		};

		const result = formatCommandHelp([feature], "scan");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.text).toContain("--baseDir");
			expect(result.text).toContain("Example: ~/dev");
			expect(result.text).toContain("Example: /projects");
		}
	});

	test("returns ok=false for unknown command", () => {
		const features: Feature[] = [
			makeFeature({ name: "commit" }),
			makeFeature({ name: "init" }),
		];

		const result = formatCommandHelp(features, "frobnicate");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.command).toBe("frobnicate");
			expect(result.known).toContain("commit");
			expect(result.known).toContain("init");
		}
	});

	test("omits Options section when no args", () => {
		const feature: Feature = {
			name: "simple",
			description: "A simple command",
			args: z.object({}),
			run: async () => ({}),
		};

		const result = formatCommandHelp([feature], "simple");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.text).not.toContain("Options:");
			expect(result.text).not.toContain("Usage:");
			expect(result.text).toContain("simple");
			expect(result.text).toContain("A simple command");
		}
	});
});

describe("formatUnknownCommand", () => {
	test("renders error message with valid command list", () => {
		const output = formatUnknownCommand("frobnicate", [
			"commit",
			"init",
			"cost-breakdown",
		]);

		expect(output).toContain('Unknown command "frobnicate".');
		expect(output).toContain("Available commands:");
		expect(output).toContain("commit");
		expect(output).toContain("init");
		expect(output).toContain("cost-breakdown");
	});

	test("renders empty known list", () => {
		const output = formatUnknownCommand("xyz", []);

		expect(output).toContain('Unknown command "xyz".');
		expect(output).toContain("Available commands:");
	});
});
