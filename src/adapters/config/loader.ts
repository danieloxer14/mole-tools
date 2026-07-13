import { homedir } from "node:os";
import { join } from "node:path";
import { PortError } from "../../core/errors";
import { stripJsonComments } from "../../shared/jsonc";
import { type Config, ConfigSchema } from "./schema";

export function defaultConfigPath(): string {
	return join(homedir(), ".config", "mole-tools", "config.json");
}

export const CONFIG_TEMPLATE_TEXT = `{
  "providers": {
    "ollama": {
      "provider": "ollama",
      "baseUrl": "http://localhost:11434"
    },
    "pi": {
      "provider": "pi",
      "binary": "pi"
    }
  },
  "models": {
    "default": "llama3.1"
  },
  "llm": {
    "commit": "ollama",
    "mergeRequest": "ollama",
    "ralph": "pi"
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
  // "autoReviewer": { "username": "your-handle" }    // presence enables the "add auto-reviewer?" question
}
`;

// Legacy template still works for backward compat
const LEGACY_TEMPLATE = {
	ollama: {
		commitModel: "llama3.1",
		baseUrl: "http://localhost:11434",
	},
	jira: {
		enabled: false,
		branchPattern: "[A-Z]+-[0-9]+",
	},
	diff: {
		ignore: ["*.lock", "bun.lockb", "package-lock.json", "*.snap"],
	},
};

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

/**
 * Migrate a legacy config (ollama.commitModel etc.) into the new provider-based format.
 */
function migrateLegacyConfig(raw: unknown): unknown {
	const obj = raw as Record<string, unknown>;
	if (!obj.ollama && Object.keys(obj).some((k) => ["providers", "llm"].includes(k))) {
		return raw; // already new format
	}

	const ollama = obj.ollama as Record<string, unknown> | undefined;
	if (!ollama) return raw;

	// Only migrate if there's no providers section yet
	if (obj.providers) return raw;

	return {
		...obj,
		providers: {
			ollama: {
				provider: "ollama",
				baseUrl: ollama.baseUrl || "http://localhost:11434",
			},
		},
		llm: {
			commit: "ollama",
			mergeRequest: "ollama",
			ralph: "pi",
		},
		models: ollama.commitModel
			? { default: ollama.commitModel }
			: undefined,
	};
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
		return directResult.data;
	}

	// Attempt legacy migration
	const migrated = migrateLegacyConfig(raw);
	const migratedResult = ConfigSchema.safeParse(migrated);
	if (migratedResult.success) {
		return migratedResult.data;
	}

	// If neither works, throw with all issues
	const issues = migratedResult.error?.issues ?? directResult.error.issues;
	throw new PortError(
		`Invalid config at ${path}: ${formatZodIssues(issues)}`,
	);
}
