import { z } from "zod";
import { defaultConfigPath, writeTemplate } from "../../adapters/config/loader";
import type { Context } from "../../core/context";
import { UserRejectedError } from "../../core/errors";
import type { Feature } from "../../core/feature";

const args = z.object({});

export interface InitResult {
	wrote: boolean;
	path: string;
}

export async function runInit(ctx: Context, path: string): Promise<InitResult> {
	const exists = await Bun.file(path).exists();
	if (exists) {
		const overwrite = await ctx.ui.confirm(
			`Config already exists at ${path}. Overwrite with the default template?`,
		);
		if (!overwrite) throw new UserRejectedError();
	}
	await writeTemplate(path);
	await ctx.ui.info(`Wrote config template to ${path}`);
	return { wrote: true, path };
}

export const init: Feature<typeof args, InitResult> = {
	name: "init",
	description: "Write a default config.json template",
	args,
	run(ctx, _args) {
		return runInit(ctx, defaultConfigPath());
	},
};
