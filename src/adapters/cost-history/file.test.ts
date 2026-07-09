import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CostEntry } from "../../core/cost-tracker";
import { appendCostSession, listCostSessions } from "./file";

let dir: string;

async function historyPath(): Promise<string> {
	dir = await mkdtemp(join(tmpdir(), "mole-tools-cost-history-"));
	return join(dir, "nested", "cost-history.jsonl");
}

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

const entry: CostEntry = {
	type: "llm",
	task: "commit-message",
	inputTokens: 100,
	outputTokens: 5,
};

describe("listCostSessions", () => {
	test("returns an empty array when no history file exists", async () => {
		const path = await historyPath();
		expect(await listCostSessions(path)).toEqual([]);
	});
});

describe("appendCostSession", () => {
	test("creates the containing directory and writes one JSON line", async () => {
		const path = await historyPath();
		const session = {
			id: "session-1",
			feature: "commit",
			startedAt: "2026-07-09T00:00:00.000Z",
			entries: [entry],
				};

			await appendCostSession(session, path);

			expect(await listCostSessions(path)).toEqual([session]);
	});

	test("appends subsequent sessions without clobbering earlier ones", async () => {
				const path = await historyPath();
			const first = {
					id: "session-1",
					feature: "commit",
					startedAt: "2026-07-09T00:00:00.000Z",
						entries: [entry],
						};
			const second = {
					id: "session-2",
				feature: "commit",
					startedAt: "2026-07-09T01:00:00.000Z",
						entries: [entry, entry],
							};

				await appendCostSession(first, path);
			await appendCostSession(second, path);

				expect(await listCostSessions(path)).toEqual([first, second]);
	});
});
