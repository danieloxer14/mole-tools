import { describe, expect, test } from "bun:test";
import { FakeVcs } from "../../test/fakes/FakeVcs";
import {
	GitAdapter,
	type GitExec,
	type GitExecResult,
} from "../adapters/vcs/git";

const ok = (stdout = ""): GitExecResult => ({
	stdout,
	stderr: "",
	exitCode: 0,
});

describe("Vcs review worktree contract", () => {
	test("GitAdapter wires clone, fetch, merge-base, worktree, diff, and remote commands", async () => {
		const calls: { args: string[]; cwd?: string }[] = [];
		const exec: GitExec = async (args, _input, cwd) => {
			calls.push({ args, cwd });
			if (args[0] === "merge-base") return ok("base\n");
			if (args[0] === "remote")
				return ok("https://gitlab.example.com/group/api.git\n");
			if (args[0] === "diff" && args.at(-1) === "--numstat") {
				return ok("1\t1\tsrc/app.ts\n");
			}
			return ok();
		};
		const vcs = new GitAdapter(exec);
		await vcs.cloneRepo(
			"https://gitlab.example.com/group/api.git",
			"/cache/api",
		);
		await vcs.fetchRef("/cache/api", "origin", "head");
		expect(await vcs.mergeBase("/cache/api", "main", "head")).toBe("base");
		await vcs.addWorktree({
			repoRoot: "/cache/api",
			path: "/wt/api",
			sha: "head",
		});
		expect(await vcs.diffRange("/cache/api", "base", "head")).toEqual([
			{
				path: "src/app.ts",
				statOnly: false,
				patch: null,
				insertions: 1,
				deletions: 1,
			},
		]);
		expect(await vcs.remoteUrl("/cache/api", "origin")).toBe(
			"https://gitlab.example.com/group/api.git",
		);
		expect(calls).toEqual(
			expect.arrayContaining([
				{
					args: [
						"clone",
						"https://gitlab.example.com/group/api.git",
						"/cache/api",
					],
				},
				{ args: ["fetch", "origin", "head"], cwd: "/cache/api" },
				{ args: ["merge-base", "main", "head"], cwd: "/cache/api" },
				{
					args: ["worktree", "add", "--detach", "/wt/api", "head"],
					cwd: "/cache/api",
				},
				{ args: ["remote", "get-url", "origin"], cwd: "/cache/api" },
			]),
		);
	});

	test("FakeVcs exposes review operations", async () => {
		const vcs = new FakeVcs({ mergeBase: "base", diffRange: [] });
		await vcs.fetchRef("/repo", "origin", "head");
		await vcs.addWorktree({ repoRoot: "/repo", path: "/wt", sha: "head" });
		expect(await vcs.mergeBase("/repo", "main", "head")).toBe("base");
		expect(vcs.fetchRefCalls).toHaveLength(1);
		expect(vcs.addWorktreeCalls).toHaveLength(1);
	});
});
