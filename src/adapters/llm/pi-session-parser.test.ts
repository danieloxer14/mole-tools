import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parsePiSessionJsonl } from "./pi-session-parser";

const fixtures = join(process.cwd(), "test/fixtures/pi-session");

describe("parsePiSessionJsonl", () => {
	test("aggregates usage and USD from assistant messages in the matching session", async () => {
		await expect(parsePiSessionJsonl(fixtures, "session-match")).resolves.toEqual({
			providerSessionId: "session-match",
			usage: {
				inputTokens: 150,
				outputTokens: 15,
				cacheReadTokens: 24,
				cacheWriteTokens: 4,
				source: "reported",
			},
			usdCost: { amount: 0.0125, source: "actual" },
		});
	});

	test("uses the completed JSONL rather than contradictory stream records", async () => {
		const result = await parsePiSessionJsonl(fixtures, "session-contradictory");
		expect(result.usage.inputTokens).toBe(7);
		expect(result.usage.outputTokens).toBe(2);
		expect(result.usdCost).toEqual({ amount: 0.003, source: "actual" });
	});

	test.each([
		["session-missing-header", "missing-header"],
		["session-mismatch", "id-mismatch"],
		["session-malformed", "malformed"],
		["session-invalid", "invalid-usage"],
	])("rejects defective JSONL: %s", async (id, fixture) => {
		await expect(parsePiSessionJsonl(fixtures, id)).rejects.toThrow();
	});

	test("rejects when no session JSONL exists", async () => {
		await expect(parsePiSessionJsonl(join(fixtures, "missing-jsonl"), "none"))
			.rejects.toThrow();
	});
});
