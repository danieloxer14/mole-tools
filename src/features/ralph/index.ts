import { z } from "zod";
import type { Context } from "../../core/context";
import type { Feature } from "../../core/feature";

const cliArgs = z.object({
	maxIterations: z.coerce
		.number()
		.int()
		.min(1)
		.optional()
		.describe("Maximum total worker iterations."),
	reflectEvery: z.coerce
		.number()
		.int()
		.min(0)
		.optional()
		.describe("Run reflection every N iterations."),
});

type RalphCliArgs = z.infer<typeof cliArgs> & {
	subcommand?: string;
	name?: string;
	source?: string;
};

export {
	type ClassifiedSource,
	classifySource,
	type RalphInitArgs,
	type RalphInitResult,
	ralphInitArgs,
	runRalphInit,
	type SourceKind,
} from "./init";
export {
	type RalphRunArgs,
	RalphRunError,
	type RalphRunResult,
	ralphRunArgs,
	runRalph,
	runRalphRun,
} from "./run";

import { ralphInitArgs, runRalphInit } from "./init";
import { ralphRunArgs, runRalphRun } from "./run";

/** The single registry entry for Ralph's nested init/run commands. */
export const ralph: Feature<typeof cliArgs> = {
	name: "ralph",
	description: "Create and run durable implementation loops",
	args: cliArgs,
	help: {
		usage: [
			"mole-tools ralph init <name> <source> [--maxIterations <number>] [--reflectEvery <number>]",
			"mole-tools ralph run <name> [--maxIterations <total>]",
		].join("\n  "),
		examples: [
			"init refactor-auth ./brief.md",
			"run refactor-auth --maxIterations 40",
		],
		notes: [
			"<source> may be a local path, an http(s) URL, or an inline brief.",
			"<name> must be kebab-case: ^[a-z0-9]+(?:-[a-z0-9]+)*$.",
			"Artifacts are stored in .ralph/<name>.md and .ralph/<name>.state.json.",
			"ralph init never overwrites an existing loop.",
			"ralph run continues until the loop completes, pauses, or reaches its iteration cap.",
		],
	},
	async run(ctx: Context, input) {
		const args = input as RalphCliArgs;
		if (args.subcommand === "init") {
			if (!args.name || args.source === undefined) {
				throw new Error("Usage: mole-tools ralph init <name> <source>");
			}
			return runRalphInit(
				ctx,
				ralphInitArgs.parse({
					name: args.name,
					source: args.source,
					maxIterations: args.maxIterations,
					reflectEvery: args.reflectEvery,
				}),
			);
		}
		if (args.subcommand === "run") {
			if (!args.name)
				throw new Error(
					"Usage: mole-tools ralph run <name> [--maxIterations <total>]",
				);
			return runRalphRun(
				ctx,
				ralphRunArgs.parse({
					name: args.name,
					maxIterations: args.maxIterations,
				}),
			);
		}
		throw new Error(
			"Usage: mole-tools ralph <subcommand> ...\nAvailable subcommands: init, run",
		);
	},
};
