import type { Command } from "cac";
import { z } from "zod";

function unwrapToCore(schema: z.ZodTypeAny): z.ZodTypeAny {
	let current = schema;
	while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
		current = (
			current as z.ZodDefault | z.ZodOptional
		).unwrap() as z.ZodTypeAny;
	}
	return current;
}

export function applyZodOptions(cmd: Command, schema: z.ZodTypeAny): void {
	if (!(schema instanceof z.ZodObject)) return;
	for (const [key, fieldSchema] of Object.entries(schema.shape)) {
		const core = unwrapToCore(fieldSchema);
		const isBoolean = core instanceof z.ZodBoolean;
		if (isBoolean) {
			const flag = key === "noOpen" ? "no-open" : key;
			cmd.option(`--${flag}`, `Set ${key}`);
		} else {
			cmd.option(`--${key} <value>`, `Set ${key}`);
		}
	}
}

/** CAC adds an empty `--` option even when no separator was supplied. */
export function stripEmptyDoubleDash(
	options: Record<string, unknown>,
): Record<string, unknown> {
	if (Array.isArray(options["--"]) && options["--"].length === 0) {
		delete options["--"];
	}
	return options;
}
