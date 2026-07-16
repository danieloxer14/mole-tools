import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { costEntrySchema } from "../../shared/cost/schema";

const costSessionSchema = z
	.object({
		id: z.string().min(1),
		feature: z.string().min(1),
		startedAt: z.string().datetime(),
		entries: z.array(costEntrySchema),
	})
	.strict();

const costHistoryRecordSchema = z
	.object({
		version: z.literal(1),
		session: costSessionSchema,
	})
	.strict();

export type CostSession = z.infer<typeof costSessionSchema>;

export function defaultCostHistoryPath(): string {
	return join(homedir(), ".config", "mole-tools", "cost-history.jsonl");
}

export async function appendCostSession(
	session: CostSession,
	path: string = defaultCostHistoryPath(),
): Promise<void> {
	const validatedSession = costSessionSchema.parse(session);
	await mkdir(dirname(path), { recursive: true });
	await appendFile(
		path,
		`${JSON.stringify({ version: 1, session: validatedSession })}\n`,
	);
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
		.map((line) => costHistoryRecordSchema.parse(JSON.parse(line)).session);
}
