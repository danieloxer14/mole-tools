import { describe, expect, test } from "bun:test";
import { FakeLlm } from "../../../test/fakes/FakeLlm";
import { fakeContext } from "../../../test/fakes/fakeContext";
import { summarizeWorktree } from "./summary";

describe("summarizeWorktree", () => {
	test("calls the LLM with a git status/diff snapshot and returns generated text", async () => {
		const llm = new FakeLlm([["The worktree contains uncommitted changes."]]);
		const ctx = fakeContext({ llm });
		const snapshot =
			" M src/index.ts\n diff --git a/src/index.ts b/src/index.ts";

		const result = await summarizeWorktree(ctx, snapshot);

		expect(result).toBe("The worktree contains uncommitted changes.");
		expect(llm.requests).toHaveLength(1);
		expect(llm.requests[0]?.prompt).toContain(snapshot);
	});

	test("returns an empty string when the LLM throws", async () => {
		const llm = {
			capabilities: () => ["text-generation" as const],
			generate: () => {
				throw new Error("provider unavailable");
			},
			runAgent: async () => ({ output: "", ok: false }),
		};
		const ctx = fakeContext({ llm });

		expect(await summarizeWorktree(ctx, " M src/index.ts")).toBe("");
	});

	test("returns an empty string when the LLM times out", async () => {
		const llm = {
			capabilities: () => ["text-generation" as const],
			generate: () => ({
				[Symbol.asyncIterator]: () => ({
					next: () => new Promise<IteratorResult<string>>(() => {}),
				}),
			}),
			runAgent: async () => ({ output: "", ok: false }),
		};
		const ctx = fakeContext({ llm });

		expect(await summarizeWorktree(ctx, " M src/index.ts", 1)).toBe("");
	});
});
