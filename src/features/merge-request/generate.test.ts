import { describe, expect, test } from "bun:test";
import { AbortError } from "../../core/errors";
import { fakeContext } from "../../../test/fakes/fakeContext";
import { FakeLlm } from "../../../test/fakes/FakeLlm";
import { generateMergeRequest } from "./generate";

describe("generateMergeRequest", () => {
	test("uses MR model and does not validate the body", async () => {
		const llm = new FakeLlm([["Title: feat: valid\n\nnot conventional: body"]]);
		const ctx = fakeContext({ llm });
		const result = await generateMergeRequest(ctx, { commits: [], diff: [] });
		expect(result).toEqual({ title: "feat: valid", body: "not conventional: body" });
		expect(llm.requests[0]?.model).toBe(ctx.config.ollama.commitModel);
	});

	test("retries invalid titles at most three times and reports violations", async () => {
		const llm = new FakeLlm([["bad"], ["also bad"], ["still bad"]]);
		const ctx = fakeContext({ llm });
		try {
			await generateMergeRequest(ctx, { commits: [], diff: [] });
			throw new Error("expected generation to abort");
		} catch (error) {
			expect(error).toBeInstanceOf(AbortError);
			expect((error as Error).message).toMatch(/format checks/);
		}
		expect(llm.requests).toHaveLength(3);
	});
});
