import { defaultAgentExec, type AgentExec } from "./exec";

export interface CodexModelChoice {
	id: string;
	label: string;
}

export const CODEX_MODEL_DISCOVERY_TIMEOUT_MS = 2_000;

export function parseCodexModelCatalog(output: string): CodexModelChoice[] {
	let catalog: unknown;
	try {
		catalog = JSON.parse(output);
	} catch {
		return [];
	}

	const entries = Array.isArray(catalog)
		? catalog
		: typeof catalog === "object" &&
				catalog !== null &&
					"models" in catalog &&
					Array.isArray(catalog.models)
				? catalog.models
				: [];
	const seen = new Set<string>();
	const choices: CodexModelChoice[] = [];
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null) continue;
		if (!("slug" in entry) || typeof entry.slug !== "string") continue;
		if (
			!("display_name" in entry) ||
			typeof entry.display_name !== "string" ||
			!("visibility" in entry) ||
			entry.visibility !== "list"
		)
			continue;

		const id = entry.slug;
		const label = entry.display_name;
		if (!id.trim() || !label.trim() || seen.has(id)) continue;
		seen.add(id);
		choices.push({ id, label });
	}
	return choices;
}

export async function discoverCodexModels(
	binary: string,
	cwd: string,
	exec: AgentExec = defaultAgentExec,
	timeoutMs = CODEX_MODEL_DISCOVERY_TIMEOUT_MS,
): Promise<CodexModelChoice[]> {
	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const command = (async () => {
		const lines: string[] = [];
		for await (const line of exec(binary, ["debug", "models"], {
			cwd,
			signal: controller.signal,
		})) {
			lines.push(line);
		}
		return parseCodexModelCatalog(lines.join("\n"));
	})().catch(() => []);
	const timeout = new Promise<CodexModelChoice[]>((resolve) => {
		timeoutId = setTimeout(() => {
			controller.abort();
			resolve([]);
		}, timeoutMs);
	});

	try {
		return await Promise.race([command, timeout]);
	} finally {
		clearTimeout(timeoutId);
	}
}
