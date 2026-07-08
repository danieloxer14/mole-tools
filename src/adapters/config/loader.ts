import { homedir } from "node:os";
import { join } from "node:path";
import { PortError } from "../../core/errors";
import { type Config, ConfigSchema } from "./schema";

export function defaultConfigPath(): string {
	return join(homedir(), ".config", "mole-tools", "config.json");
}

export const CONFIG_TEMPLATE: Config = {
	ollama: {
		commitModel: "llama3.1",
		baseUrl: "http://localhost:11434",
	},
	commitSystemPrompt:
		"Write a concise Conventional Commits message for the following staged diff. Reply with only the message.",
	jira: {
		enabled: false,
		branchPattern: "[A-Z]+-[0-9]+",
	},
	diff: {
		ignore: ["*.lock", "bun.lockb", "package-lock.json", "*.snap"],
	},
};

export async function writeTemplate(path: string): Promise<void> {
	await Bun.write(path, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`);
}

function formatZodIssues(
	issues: { path: PropertyKey[]; message: string }[],
): string {
	return issues
		.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
		.join("; ");
}

export async function loadConfig(
	path: string = defaultConfigPath(),
): Promise<Config> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		await writeTemplate(path);
		console.log(`No config found. Wrote default template to ${path}`);
		return CONFIG_TEMPLATE;
	}

	const raw: unknown = await file.json();
	const result = ConfigSchema.safeParse(raw);
	if (!result.success) {
		throw new PortError(
			`Invalid config at ${path}: ${formatZodIssues(result.error.issues)}`,
		);
	}
	return result.data;
}
