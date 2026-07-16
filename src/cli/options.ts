import type { Command } from "cac";
import { z } from "zod";

function unwrapToCore(schema: z.ZodTypeAny): z.ZodTypeAny {
	let current = schema;
	while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
		// TypeScript narrowest to union; both have unwrap() returning inner type.
		current =
			current instanceof z.ZodDefault ? current.unwrap() : current.unwrap();
	}
	return current;
}

export function applyZodOptions(cmd: Command, schema: z.ZodTypeAny): void {
	if (!(schema instanceof z.ZodObject)) return;
	for (const [key, fieldSchema] of Object.entries(schema.shape)) {
		const core = unwrapToCore(fieldSchema);
		const isBoolean = core instanceof z.ZodBoolean;
		if (isBoolean) {
			cmd.option(`--${key}`, `Set ${key}`);
		} else {
			cmd.option(`--${key} <value>`, `Set ${key}`);
		}
	}
}
