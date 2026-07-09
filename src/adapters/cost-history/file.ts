import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CostEntry } from "../../core/cost-tracker";

export interface CostSession {
	id: string;
	feature: string;
	startedAt: string;
	entries: CostEntry[];
}

export function defaultCostHistoryPath(): string {
	return join(homedir(), ".config", "mole-tools", "cost-history.jsonl");
}

export async function appendCostSession(
	session: CostSession,
	path: string = defaultCostHistoryPath(),
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${JSON.stringify(session)}\n`);
}

export async function listCostSessions(
	path: string = defaultCostHistoryPath(),
): Promise<CostSession[]> {
	const file = Bun.file(path);
	if (!(await file.exists())) return [];
	const text = await file.text();
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as CostSession);
}
