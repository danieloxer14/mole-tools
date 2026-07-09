import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeUiPort } from "../../../test/fakes/FakeUiPort";
import { fakeContext } from "../../../test/fakes/fakeContext";
import { appendCostSession } from "../../adapters/cost-history/file";
import type { CostEntry } from "../../core/cost-tracker";
import { runCostBreakdown } from "./index";

let dir: string;

async function historyPath(): Promise<string> {
	dir = await mkdtemp(join(tmpdir(), "mole-tools-cost-breakdown-"));
	return join(dir, "cost-history.jsonl");
}

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

const entry: CostEntry = {
	type: "git",
	task: "stagedDiff",
	inputTokens: 0,
	outputTokens: 5,
};

describe("runCostBreakdown", () => {
	test("reports no history when nothing has been recorded yet", async () => {
		const path = await historyPath();
		const ui = new FakeUiPort();
		const ctx = fakeContext({ ui });

		const result = await runCostBreakdown(ctx, path);

		expect(result).toEqual({ sessionCount: 0 });
		expect(ui.transcript).toEqual([
					{
					kind: "info",
						text: "No cost history yet — run a feature first.",
					spinner: undefined,
					},
				]);
	});

	test("shows sessions newest-first, pausing between each but not after the last", async () => {
		const path = await historyPath();
			await appendCostSession(
					{
					id: "1",
						feature: "commit",
					startedAt: "2026-07-08T00:00:00.000Z",
						entries: [entry],
					},
					path,
							);
			await appendCostSession(
					{
					id: "2",
						feature: "commit",
					startedAt: "2026-07-09T00:00:00.000Z",
						entries: [entry],
						  },
						path,
					  );
			const ui = new FakeUiPort();
			const ctx = fakeContext({ ui });

			const result = await runCostBreakdown(ctx, path);

				expect(result).toEqual({ sessionCount: 2 });
			const kinds = ui.transcript.map((t) => t.kind);
			expect(kinds).toEqual(["info", "pause", "info"]);
			expect(ui.transcript[0]?.text).toContain("2026-07-09T00:00:00.000Z");
			expect(ui.transcript[2]?.text).toContain("2026-07-08T00:00:00.000Z");
	});
});
