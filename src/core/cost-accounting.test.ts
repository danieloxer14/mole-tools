import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCostSessions, type CostSession } from "../adapters/cost-history/file";
import { persistCostSessionFailOpen } from "./cost-accounting";

describe("non-Ralph cost accounting boundary", () => {
	test("preserves settled work and writes one sanitized unavailable entry when accounting fails", async () => {
		const directory = await mkdtemp(join(tmpdir(), "mole-accounting-test-"));
		const path = join(directory, "history.jsonl");
		let primaryWork = false;
		let attempts = 0;
		const session: CostSession = {
			id: "feature-session",
			feature: "commit",
			startedAt: new Date().toISOString(),
			entries: [{
				type: "llm", task: "commit-message", provider: "pi", model: "claude",
				providerSessionId: "session-secret",
				usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" },
				usdCost: { source: "actual", amount: 0.01 },
			}],
		};
		try {
			// The feature settles its primary work before ancillary accounting.
			primaryWork = true;
			await persistCostSessionFailOpen(session, { path, append: async (value, target) => {
				attempts++;
				if (attempts === 1) throw new Error("session content: /tmp/private-token");
				const { appendCostSession } = await import("../adapters/cost-history/file");
				return appendCostSession(value, target);
			}});
			const entries = (await listCostSessions(path)).flatMap((item) => item.entries);
			expect(primaryWork).toBe(true);
			expect(entries).toHaveLength(1);
			expect(entries[0]?.usdCost).toEqual({ source: "unavailable" });
			expect(entries[0]?.accountingDiagnostic).not.toContain("/tmp");
			expect(entries[0]?.accountingDiagnostic).not.toContain("session content");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
