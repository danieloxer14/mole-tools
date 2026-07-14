import { type Command } from "cac";
import { z } from "zod";

export function applyZodOptions(cmd: Command, schema: z.ZodTypeAny): void {
	if (!(schema instanceof z.ZodObject)) return;
	for (const [key, fieldSchema] of Object.entries(schema.shape)) {
		const isBoolean =
			fieldSchema instanceof z.ZodBoolean ||
			(fieldSchema instanceof z.ZodDefault &&
				fieldSchema.unwrap() instanceof z.ZodBoolean);
		if (isBoolean) {
			cmd.option(`--${key}`, `Set ${key}`);
		} else {
			cmd.option(`--${key} <value>`, `Set ${key}`);
		}
	}
}
