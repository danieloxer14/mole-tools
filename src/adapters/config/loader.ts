import { homedir } from "node:os";
import { join } from "node:path";
import { PortError } from "../../core/errors";
import { stripJsonComments } from "../../shared/jsonc";
import { type Config, ConfigSchema } from "./schema";

export function defaultConfigPath(): string {
	return join(homedir(), ".config", "mole-tools", "config.json");
}

export const CONFIG_TEMPLATE_TEXT = `{
  "ollama": {
    "commitModel": "llama3.1",
    "baseUrl": "http://localhost:11434"
    // "mrModel": "llama3.1"          // model for merge-request descriptions (reserved for the merge-request tool)
  },
  "jira": {
    "enabled": false,
    "branchPattern": "[A-Z]+-[0-9]+"
    // "url": "https://your-domain.atlassian.net"   // Jira base URL, required when jira.enabled is true
    // "email": "you@example.com"                    // account email; set this for Jira Cloud (Basic auth) - omit for Server/Data Center PATs (Bearer auth)
    // "apiKey": "your-api-token"                    // Jira API token, stored in plaintext
  },
  "diff": {
    "ignore": ["*.lock", "bun.lockb", "package-lock.json", "*.snap"]
  }
  // "dynamicEnvRepos": ["org/repo"]                  // repos offered the "create dynamic env" option (reserved for the merge-request tool)
  // "dynamicEnvScript": "hack/local/dynamic-env.sh"  // handoff script for configured repositories
  // "autoReviewer": { "username": "your-handle" }    // presence enables the "add auto-reviewer?" question (reserved for the merge-request tool)
}
`;

export const CONFIG_TEMPLATE: Config = ConfigSchema.parse(
	JSON.parse(stripJsonComments(CONFIG_TEMPLATE_TEXT)),
);

export async function writeTemplate(path: string): Promise<void> {
	await Bun.write(path, CONFIG_TEMPLATE_TEXT);
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

	const raw: unknown = JSON.parse(stripJsonComments(await file.text()));
	const result = ConfigSchema.safeParse(raw);
	if (!result.success) {
		throw new PortError(
			`Invalid config at ${path}: ${formatZodIssues(result.error.issues)}`,
		);
	}
	return result.data;
}
