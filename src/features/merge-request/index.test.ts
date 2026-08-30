import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { FakeGitHost } from "../../../test/fakes/FakeGitHost";
import { FakeLlm } from "../../../test/fakes/FakeLlm";
import { FakeUiPort } from "../../../test/fakes/FakeUiPort";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import { fakeContext } from "../../../test/fakes/fakeContext";
import { CONFIG_TEMPLATE } from "../../adapters/config/loader";
import { mergeRequest, runMergeRequestFlow } from "./index";

const commit = {
	sha: "1",
	subject: "feat: add feature",
	author: "A",
	date: "today",
};

describe("merge-request args schema", () => {
	test("rejects whitespace-only context with Zod error", () => {
		expect(() => mergeRequest.args.parse({ context: " \n\t " })).toThrow();
	});
});

describe("merge-request flow", () => {
	test("preflights host before default-branch guard and generation", async () => {
		const calls: string[] = [];
		const host = new FakeGitHost();
		host.preflight = async () => {
			calls.push("preflight");
		};
		const ctx = fakeContext({
			gitHost: host,
			vcs: new FakeVcs({ branch: "main", defaultBranch: "main" }),
			llm: new FakeLlm(),
		});
		await expect(runMergeRequestFlow(ctx)).rejects.toThrow(
			"Cannot open MR from main",
		);
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
			vcs: new FakeVcs({
				staged: false,
				commitsAhead: [commit],
				mergeBaseDiff: [],
			}),
		});
		const result = await runMergeRequestFlow(ctx);
		expect(result.title).toBe("feat: add feature");
		expect(result.commits).toEqual(["feat: add feature"]);
		expect(llm.requests[0]?.prompt).toContain("feat: add feature");
	});

	test("forwards context to both staged commit and MR generation", async () => {
		const context = "Emphasize rollout safety and customer impact";
		const llm = new FakeLlm([
			["feat: commit staged changes"],
			["Title: feat: open merge request\n\nDescription"],
		]);
		const ctx = fakeContext({
			gitHost: new FakeGitHost(),
			llm,
			vcs: new FakeVcs({ staged: true, commitsAhead: [commit] }),
			ui: new FakeUiPort([
				{ select: "accept" },
				{ confirm: false }, // draft
				{ confirm: true }, // create
			]),
		});

		await expect(runMergeRequestFlow(ctx, { context })).resolves.toMatchObject({
			title: "feat: open merge request",
		});
		expect(llm.requests).toHaveLength(2);
		for (const request of llm.requests) {
			expect(request.prompt).toContain("Additional user context:");
			expect(request.prompt).toContain(context);
		}
	});

	test("retains context across MR title-format retries", async () => {
		const context = "Focus on operational impact";
		const llm = new FakeLlm([
			["not conventional"],
			["Title: feat: open merge request\n\nDescription"],
		]);
		const ctx = fakeContext({
			gitHost: new FakeGitHost(),
			llm,
			vcs: new FakeVcs({ staged: false, commitsAhead: [commit] }),
			ui: new FakeUiPort([{ confirm: false }, { confirm: true }]),
		});

		await runMergeRequestFlow(ctx, { context });
		expect(llm.requests).toHaveLength(2);
		for (const request of llm.requests) {
			expect(request.prompt).toContain(context);
		}
	});

	test("allows unstaged changes but only sends the merge-base diff", async () => {
		const llm = new FakeLlm([["Title: feat: add feature\n\nDescription"]]);
		const vcs = new FakeVcs({
			staged: false,
			commitsAhead: [commit],
			mergeBaseDiff: [
				{
					path: "committed.ts",
					statOnly: false,
					patch: "+committed change",
					insertions: 1,
					deletions: 0,
				},
			],
		});
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

	test("uses one additional repository-root lookup for dynamic environment handoff", async () => {
		const root = await mkdtemp(join("/tmp", "mole-tools-merge-request-"));
		const script = join(root, "dynamic-env.sh");
		const marker = join(root, "executed");
		await Bun.write(script, `#!/bin/sh\nprintf executed > "${marker}"\n`);
		await chmod(script, 0o755);

		try {
			const vcs = new FakeVcs({
				staged: false,
				repoRoot: root,
				commitsAhead: [commit],
				mergeBaseDiff: [],
			});
			const ctx = fakeContext({
				config: {
					...CONFIG_TEMPLATE,
					dynamicEnvRepos: [basename(root)],
					dynamicEnvScript: "dynamic-env.sh",
				},
				ui: new FakeUiPort([
					{ confirm: false }, // draft
					{ confirm: true }, // create
					{ confirm: true }, // dynamic environment
				]),
				vcs,
				llm: new FakeLlm([["Title: feat: add feature\n\nDescription"]]),
			});

			await expect(runMergeRequestFlow(ctx)).resolves.toMatchObject({
				url: "https://example.com/mr/1",
			});
			// First call belongs to reviewer discovery; second is dynamic-env lookup.
			expect(vcs.repoRootCalls).toEqual([root, root]);
			expect(await Bun.file(marker).text()).toBe("executed");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("does not look up dynamic-environment root without configured repositories", async () => {
		const root = "/tmp/mole-tools-no-dynamic-environment";
		const vcs = new FakeVcs({
			staged: false,
			repoRoot: root,
			commitsAhead: [commit],
			mergeBaseDiff: [],
		});
		const ui = new FakeUiPort([
			{ confirm: false }, // draft
			{ confirm: true }, // create
		]);
		const ctx = fakeContext({
			ui,
			vcs,
			llm: new FakeLlm([["Title: feat: add feature\n\nDescription"]]),
		});

		await expect(runMergeRequestFlow(ctx)).resolves.toMatchObject({
			url: "https://example.com/mr/1",
		});
		// Reviewer discovery still performs its independent root lookup.
		expect(vcs.repoRootCalls).toEqual([root]);
		expect(
			ui.transcript.some(
				(entry) =>
					entry.kind === "confirm" &&
					entry.q === "Create a dynamic environment?",
			),
		).toBe(false);
	});
});
