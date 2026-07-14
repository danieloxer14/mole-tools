import type { z } from "zod";
import { ZodObject } from "zod";
import type { Feature } from "../../core/feature";

interface OptionInfo {
	flag: string;
	valuePlaceholder: string;
	description?: string;
	examples?: string[];
}

function extractOptions(schema: z.ZodTypeAny): OptionInfo[] {
	if (!(schema instanceof ZodObject)) return [];

	const options: OptionInfo[] = [];
	for (const [key, fieldSchema] of Object.entries(
		(schema as z.ZodObject).shape,
	)) {
		const typedField = fieldSchema as z.ZodTypeAny & {
			meta?: () => unknown;
			description?: string;
		};
		const meta = typedField.meta?.();
		options.push({
			flag: `--${key}`,
			valuePlaceholder: `<${key}>`,
			description: typedField.description ?? undefined,
			examples: Array.isArray(meta?.examples) ? meta.examples : undefined,
		});
	}
	return options;
}

function buildUsageLine(
	commandName: string,
	options: OptionInfo[],
	helpUsage?: string,
): string {
	if (helpUsage) return helpUsage;

	if (options.length === 0) return ``;

	const flags = options
		.map((o) => `[${o.flag} ${o.valuePlaceholder}]`)
		.join(" ");
	return `mole-tools ${commandName} ${flags}`;
}

export function formatGeneralHelp(features: Feature[]): string {
	const lines: string[] = [];

	lines.push("mole-tools");
	lines.push("");
	lines.push("Available tools:");

	for (const feature of features) {
		lines.push(`  ${feature.name}\t${feature.description}`);
	}

	lines.push("");
	lines.push('Run "mole-tools help <command>" for details.');
	lines.push("");

	return lines.join("\n");
}

export function formatCommandHelp(
	features: Feature[],
	command: string,
):
	| { ok: true; text: string }
	| { ok: false; command: string; known: string[] } {
	const feature = features.find((f) => f.name === command);

	if (!feature) {
		return { ok: false, command, known: features.map((f) => f.name) };
	}

	const options = extractOptions(feature.args);
	const lines: string[] = [];

	lines.push(`${feature.name}`);
	lines.push("");
	lines.push(feature.description);

	if (feature.help?.usage || options.length > 0) {
		lines.push("");
		const usageLine = buildUsageLine(command, options, feature.help?.usage);
		if (usageLine) {
			lines.push("Usage:");
			lines.push(`  ${usageLine}`);
		}
	}

	if (options.length > 0) {
		lines.push("");
		lines.push("Options:");
		for (const opt of options) {
			lines.push(`  ${opt.flag} ${opt.valuePlaceholder}`);
			if (opt.description) {
				lines.push(`     ${opt.description}`);
			}
			if (opt.examples && opt.examples.length > 0) {
				for (const example of opt.examples) {
					lines.push(`     Example: ${example}`);
				}
			}
		}
	}

	if (feature.help?.examples && feature.help.examples.length > 0) {
		lines.push("");
		lines.push("Examples:");
		for (const example of feature.help.examples) {
			lines.push(`  mole-tools ${command} ${example}`.replace(/\s{2,}/g, " "));
		}
	}

	if (feature.help?.notes && feature.help.notes.length > 0) {
		lines.push("");
		lines.push("Notes:");
		for (const note of feature.help.notes) {
			lines.push(`  ${note}`);
		}
	}

	lines.push("");

	return { ok: true, text: lines.join("\n") };
}

export function formatUnknownCommand(command: string, knowN: string[]): string {
	const lines: string[] = [];

	lines.push(`Unknown command "${command}".`);
	lines.push("");
	lines.push("Available commands:");
	for (const name of knowN) {
		lines.push(`  ${name}`);
	}
	lines.push("");

	return lines.join("\n");
}
