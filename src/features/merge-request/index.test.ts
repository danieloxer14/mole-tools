import { describe, expect, test } from "bun:test";
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
		// staged=false → no commit flow runs, so first UI interaction is the draft confirm, not a select
		const ctx = fakeContext({
			ui: new FakeUiPort([
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

	test("allows unstaged changes but only sends the merge-base diff", async () => {
		const llm = new FakeLlm([["Title: feat: add feature\n\nDescription"]]);
		const vcs = new FakeVcs({
			staged: false,
			commitsAhead: [commit],
			mergeBaseDiff: [{
				path: "committed.ts",
				statOnly: false,
				patch: "+committed change",
				insertions: 1,
				deletions: 0,
			}],
		});
		vcs.hasUnstagedChanges = async () => true;
		const ctx = fakeContext({
			vcs,
			llm,
			ui: new FakeUiPort([
				{ confirm: false }, // draft
				{ confirm: true }, // create
			]),
		});

		await expect(runMergeRequestFlow(ctx)).resolves.toMatchObject({
			title: "feat: add feature",
		});
		expect(llm.requests[0]?.prompt).toContain("committed.ts");
		expect(llm.requests[0]?.prompt).not.toContain("unstaged");
	});
});
