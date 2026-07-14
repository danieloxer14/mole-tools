import { homedir } from "node:os";
import { join } from "node:path";
import { PortError } from "../../core/errors";
import { stripJsonComments } from "../../shared/jsonc";
import { type Config, ConfigSchema, validateModelProviders } from "./schema";

export function defaultConfigPath(): string {
	return join(homedir(), ".config", "mole-tools", "config.json");
}

export const CONFIG_TEMPLATE_TEXT = `{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434"
    },
    "pi": {
      "binary": "pi"
    }
  },
  "models": {
    "commit": { "provider": "ollama", "name": "qwen3.6" },
    "mergeRequest": { "provider": "ollama", "name": "qwen3.6" },
    "ralph": {
      "init": { "provider": "pi", "name": "qwen3.6" },
      "implement": { "provider": "pi", "name": "qwen3.6" },
      "reflect": { "provider": "pi", "name": "qwen3.6" }
    }
  },
  "jira": {
    "enabled": false,
    "branchPattern": "[A-Z]+-[0-9]+"
    // "url": "https://your-domain.atlassian.net"   // Jira base URL, required when jira.enabled is true
    // "email": "you@example.com"                    // account email; set this for Jira Cloud (Basic auth)
    // "apiKey": "your-api-token"                    // Jira API token
  },
  "diff": {
    "ignore": ["*.lock", "bun.lockb", "package-lock.json", "*.snap"]
  }
  // "dynamicEnvRepos": ["org/repo"]                  // repos offered the "create dynamic env" option
  // "dynamicEnvScript": "hack/local/dynamic-env.sh"  // handoff script for configured repositories
  // "autoReviewer": { "username": "your-handle" },   // presence enables the "add auto-reviewer?" question
  // "worktreePrune": {                               // persisted base directory for worktree-prune
  //   "baseDir": "~/repos"                          // scanned for Git repos and extra worktrees
  // }
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
	
	// Try parsing as-is first (new format)
	const directResult = ConfigSchema.safeParse(raw);
	if (directResult.success) {
		try {
			validateModelProviders(directResult.data);
		} catch (error) {
			throw new PortError(`Invalid config at ${path}: ${error instanceof Error ? error.message : String(error)}`);
		}
		return directResult.data;
	}

	// Legacy shapes are rejected; do not silently rewrite routing decisions.
	throw new PortError(
		`Invalid config at ${path}: ${formatZodIssues(directResult.error.issues)}`,
	);
}

/** Write a partial merge back to the user's config file. */
export async function updateConfig(
	partial: Partial<Config>,
	path: string = defaultConfigPath(),
): Promise<void> {
	const existing = await loadConfig(path);
	const merged = { ...existing, ...partial };
	// Re-validate the merged shape
	const validated = ConfigSchema.parse(merged);
	validateModelProviders(validated);
	await Bun.write(path, JSON.stringify(validated, null, 2) + "\n");
}
