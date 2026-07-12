import { describe, expect, test } from "bun:test";
import { AbortError } from "../../core/errors";
import { fakeContext } from "../../../test/fakes/fakeContext";
import { FakeGitHost } from "../../../test/fakes/FakeGitHost";
import { FakeLlm } from "../../../test/fakes/FakeLlm";
import { FakeUiPort } from "../../../test/fakes/FakeUiPort";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import { runMergeRequestFlow } from "./index";

const commit = { sha: "1", subject: "feat: add feature", author: "A", date: "today" };

describe("merge-request flow", () => {
	test("preflights host before default-branch guard and generation", async () => {
		const calls: string[] = [];
		const host = new FakeGitHost();
		host.preflight = async () => { calls.push("preflight"); };
		const ctx = fakeContext({
			gitHost: host,
			vcs: new FakeVcs({ branch: "main", defaultBranch: "main" }),
			llm: new FakeLlm(),
		});
		await expect(runMergeRequestFlow(ctx)).rejects.toThrow("Cannot open MR from main");
		expect(calls).toEqual(["preflight"]);
	});

	test("collects filtered diff and returns accepted candidate", async () => {
		const llm = new FakeLlm([["Title: feat: add feature\n\nDescription"]]);
		const ctx = fakeContext({
			ui: new FakeUiPort([
			{ select: "accept" },
			{ confirm: false }, // draft
			{ confirm: true }, // create
		]),
			llm,
			vcs: new FakeVcs({ staged: false, commitsAhead: [commit], mergeBaseDiff: [] }),
		});
		const result = await runMergeRequestFlow(ctx);
		expect(result.title).toBe("feat: add feature");
		expect(result.commits).toEqual(["feat: add feature"]);
		expect(llm.requests[0]?.prompt).toContain("feat: add feature");
	});

	test("rejects unstaged-only changes without staging", async () => {
		const vcs = new FakeVcs({ staged: false });
		vcs.hasUnstagedChanges = async () => true;
		const ctx = fakeContext({ vcs });
		await expect(runMergeRequestFlow(ctx)).rejects.toEqual(
			new AbortError("Unstaged changes — stage them first"),
		);
	});
});
