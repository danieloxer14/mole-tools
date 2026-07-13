import cac, { type Command } from "cac";
import { z } from "zod";
import packageJson from "../package.json";
import { CONFIG_TEMPLATE, loadConfig } from "./adapters/config/loader";
import { appendCostSession } from "./adapters/cost-history/file";
import { runInInk } from "./app";
import { buildContext } from "./core/context";
import { handleError } from "./core/errors";
import type { Feature } from "./core/feature";
import { closeLogger, initializeLogger } from "./core/logger";
import { features } from "./core/registry";
import {
	formatCommandHelp,
	formatGeneralHelp,
	formatUnknownCommand,
} from "./features/help/format";
import { formatCostSavingsTable } from "./shared/cost-estimate";

function applyZodOptions(cmd: Command, schema: z.ZodTypeAny): void {
	if (!(schema instanceof z.ZodObject)) return;
	for (const key of Object.keys(schema.shape)) {
		cmd.option(`--${key} <value>`, `Set ${key}`);
	}
}

const cli = cac("mole-tools");
cli.version(packageJson.version);

// Help command — registered before features so it takes priority.
// This path intentionally bypasses loadConfig, buildContext, and runInInk.
cli
	.command("help [command]", "Show help for available tools", {
		ignoreImplicitRegistration: false,
	})
	.action((command?: string) => {
		if (!command) {
			console.log(formatGeneralHelp(features));
			process.exitCode = 0;
			return;
		}

		const result = formatCommandHelp(features, command);
		if (result.ok) {
			console.log(result.text);
			process.exitCode = 0;
		} else {
			process.stdout.write(formatUnknownCommand(result.command, result.known));
			process.exitCode = 1;
		}
	});

for (const feature of features as Feature[]) {
	// cac has no separate nested-command registry, so Ralph owns its three
	// positional slots and dispatches init/run in the feature implementation.
	const commandName = feature.name === "ralph"
		? "ralph [subcommand] [name] [source]"
		: feature.name;
	const cmd = cli.command(commandName, feature.description);
	applyZodOptions(cmd, feature.args);
	cmd.action(async (...actionArgs: unknown[]) => {
		// Help is handled above and intentionally never enters this lifecycle.
		await initializeLogger();
		try {
			const options = (feature.name === "ralph"
			? actionArgs[actionArgs.length - 1]
			: actionArgs[0]) as Record<string, unknown>;
			let args: unknown;
			try {
				args = feature.args.parse(
					feature.name === "ralph"
						? {
							...options,
							subcommand: actionArgs[0],
							name: actionArgs[1],
							source: actionArgs[2],
						}
						: options,
				);
				// Positional Ralph arguments are intentionally excluded from its
				// option schema (and therefore from the Options help section).
				if (feature.name === "ralph" && args && typeof args === "object") {
					Object.assign(args, {
						subcommand: actionArgs[0],
						name: actionArgs[1],
						source: actionArgs[2],
					});
				}
			} catch (e) {
				console.error(e instanceof Error ? e.message : String(e));
				process.exitCode = 1;
				return;
			}

			// init writes/overwrites the config template itself (with its own
			// existence check + overwrite confirmation) — loading it here first
			// would race with that and always report "config already exists".
			const config =
				feature.name === "init" ? CONFIG_TEMPLATE : await loadConfig();
			const startedAt = new Date().toISOString();
			process.exitCode = await runInInk(async (ui) => {
				try {
					const ctx = buildContext({ config, ui });
					await feature.run(ctx, args);
					const entries = ctx.costTracker.getEntries();
					if (entries.length > 0) {
						await appendCostSession({
							id: crypto.randomUUID(),
							feature: feature.name,
							startedAt,
							entries: [...entries],
						});
						await ui.info(formatCostSavingsTable(entries));
					}
					return 0;
				} catch (e) {
					return handleError(e, ui);
				}
			});
		} finally {
			await closeLogger();
		}
	});
}

cli.help();
cli.parse();
