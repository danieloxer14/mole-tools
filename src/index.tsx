import cac from "cac";
import packageJson from "../package.json";
import { CONFIG_TEMPLATE, loadConfig } from "./adapters/config/loader";
import { runInInk } from "./app";
import { applyZodOptions } from "./cli/options";
import { buildContext } from "./core/context";
import { handleError } from "./core/errors";
import { closeLogger, initializeLogger } from "./core/logger";
import { features } from "./core/registry";
import {
	formatCommandHelp,
	formatGeneralHelp,
	formatUnknownCommand,
} from "./features/help/format";

export { applyZodOptions } from "./cli/options";

const cli = cac("mole-tools");
cli.version(packageJson.version);

// Help command — registered before features so it takes priority.
// This path intentionally bypasses loadConfig, buildContext, and runInInk.
cli
	.command("help [command]", "Show help for available tools")
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

for (const feature of features) {
	const cmd = cli.command(feature.name, feature.description);
	applyZodOptions(cmd, feature.args);
	cmd.action(async (...actionArgs: unknown[]) => {
		// Help is handled above and intentionally never enters this lifecycle.
		await initializeLogger();
		try {
			const options = actionArgs[0] as Record<string, unknown>;
			let args: unknown;
			try {
				args = feature.args.parse(options);
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
			process.exitCode = await runInInk(async (ui) => {
				try {
					const ctx = buildContext({ config, ui });
					await feature.run(ctx, args);
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
