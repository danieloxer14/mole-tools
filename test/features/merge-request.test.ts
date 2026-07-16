import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCostSession, listCostSessions } from "../../src/adapters/cost-history/file";
import { runWithCostAccounting } from "../../src/core/cost-accounting";
import { generateMergeRequest } from "../../src/features/merge-request/generate";
import { FakeLlm } from "../fakes/FakeLlm";
import { fakeContext } from "../fakes/fakeContext";

describe("merge-request accounting boundary", () => {
	test("preserves a settled MR generation when history persistence fails", async () => {
		const directory = await mkdtemp(join(tmpdir(), "mole-mr-accounting-"));
		const path = join(directory, "cost-history.jsonl");
		const ctx = fakeContext({ llm: new FakeLlm({ generationAttempts: [["feat: title\n\nbody"]] }) });
		let attempts = 0;
		try {
			const result = await runWithCostAccounting({
				feature: "merge-request", startedAt: new Date().toISOString(), tracker: ctx.costTracker,
				run: async () => {
					const candidate = await generateMergeRequest(ctx, { commits: ["feat: change"], diff: [] });
					ctx.costTracker.record({
						type: "llm", task: "merge-request", provider: "pi", model: "claude",
						providerSessionId: "mr-session-secret",
						usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, source: "reported" },
						usdCost: { source: "actual", amount: 0.01 },
					});
					return candidate;
				},
				options: { path, append: async (session, target) => {
					attempts++;
					if (attempts === 1) throw new Error("session content: /tmp/private-token");
					return appendCostSession(session, target);
				} },
			});
			expect(result.title).toBe("feat: title");
			const entries = (await listCostSessions(path)).flatMap((session) => session.entries);
			expect(entries).toHaveLength(1);
			expect(entries[0]?.usdCost).toEqual({ source: "unavailable" });
			expect(entries[0]?.accountingDiagnostic).not.toContain("/tmp");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
