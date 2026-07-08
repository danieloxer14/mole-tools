import cac, { type Command } from "cac";
import { z } from "zod";
import { loadConfig } from "./adapters/config/loader";
import { runInInk } from "./app";
import { buildContext } from "./core/context";
import { handleError } from "./core/errors";
import type { Feature } from "./core/feature";
import { features } from "./core/registry";

function applyZodOptions(cmd: Command, schema: z.ZodTypeAny): void {
	if (!(schema instanceof z.ZodObject)) return;
	for (const key of Object.keys(schema.shape)) {
		cmd.option(`--${key} <value>`, `Set ${key}`);
	}
}

const cli = cac("mole-tools");

for (const feature of features as Feature[]) {
	const cmd = cli.command(feature.name, feature.description);
	applyZodOptions(cmd, feature.args);
	cmd.action(async (options: Record<string, unknown>) => {
		let args: unknown;
		try {
			args = feature.args.parse(options);
		} catch (e) {
			console.error(e instanceof Error ? e.message : String(e));
			process.exitCode = 1;
			return;
		}

		const config = await loadConfig();
		process.exitCode = await runInInk(async (ui) => {
			try {
				const ctx = buildContext({ config, ui });
				await feature.run(ctx, args);
				return 0;
			} catch (e) {
				return handleError(e, ui);
			}
		});
	});
}

cli.help();
cli.parse();
