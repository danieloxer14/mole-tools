import { describe, expect, test } from "bun:test";
import { CostTracker } from "../../core/cost-tracker";
import { PortError } from "../../core/errors";
import { GitAdapter, type GitExec, type GitExecResult } from "./git";

function ok(stdout: string): GitExecResult {
	return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr: string, exitCode = 1): GitExecResult {
	return { stdout: "", stderr, exitCode };
}

function scriptedExec(
	script: Record<string, GitExecResult>,
	calls: string[][],
): GitExec {
	return async (args: string[]) => {
		calls.push(args);
		const key = args.join(" ");
		const result = script[key];
		if (!result) throw new Error(`unscripted git call: ${key}`);
		return result;
	};
}

describe("GitAdapter", () => {
	test("currentBranch trims the parsed branch name", async () => {
		const calls: string[][] = [];
		const git = new GitAdapter(
			scriptedExec({ "rev-parse --abbrev-ref HEAD": ok("main\n") }, calls),
				);
		expect(await git.currentBranch()).toBe("main");
		expect(calls[0]).toEqual(["rev-parse", "--abbrev-ref", "HEAD"]);
	});

	test("defaultBranch falls back to main when no remote HEAD is set", async () => {
		const git = new GitAdapter(
			scriptedExec(
					{ "symbolic-ref refs/remotes/origin/HEAD": fail("not a symbolic ref") },
				[],
					),
				);
		expect(await git.defaultBranch()).toBe("main");
	});

	test("defaultBranch strips the origin prefix", async () => {
		const git = new GitAdapter(
			scriptedExec(
					{
						"symbolic-ref refs/remotes/origin/HEAD": ok(
								"refs/remotes/origin/develop\n",
							),
					},
				[],
					),
				);
		expect(await git.defaultBranch()).toBe("develop");
	});

	test("hasStagedChanges is true when git diff --quiet exits 1", async () => {
		const git = new GitAdapter(
			scriptedExec({ "diff --staged --quiet": fail("", 1) }, []),
				);
		expect(await git.hasStagedChanges()).toBe(true);
	});

	test("hasStagedChanges is false when git diff --quiet exits 0", async () => {
		const git = new GitAdapter(
			scriptedExec({ "diff --staged --quiet": ok("") }, []),
				);
		expect(await git.hasStagedChanges()).toBe(false);
	});

	test("stagedDiff combines numstat and patch text per file", async () => {
		const patch = [
					"diff --git a/src/a.ts b/src/a.ts",
					"index 111..222 100644",
					"--- a/src/a.ts",
					"+++ b/src/a.ts",
					"@@ -1 +1 @@",
					"-old",
					"+new",
					"",
				].join("\n");
		const git = new GitAdapter(
			scriptedExec(
					{
						"diff --staged --numstat": ok("1\t1\tsrc/a.ts\n"),
						"diff --staged": ok(patch),
					},
				[],
					),
				);
		const diffs = await git.stagedDiff();
		expect(diffs).toHaveLength(1);
		expect(diffs[0]?.path).toBe("src/a.ts");
		expect(diffs[0]?.insertions).toBe(1);
		expect(diffs[0]?.deletions).toBe(1);
		expect(diffs[0]?.patch).toContain("+new");
	});

	test("commit pipes the message via stdin and returns the new sha", async () => {
		const calls: string[][] = [];
		const inputs: (string | undefined)[] = [];
		const exec: GitExec = async (args, input) => {
			calls.push(args);
			inputs.push(input);
			if (args[0] === "commit") return ok("");
			if (args.join(" ") === "rev-parse HEAD") return ok("abc123\n");
			throw new Error(`unscripted: ${args.join(" ")}`);
			};
		const git = new GitAdapter(exec);
		const result = await git.commit("feat: add thing");
		expect(result).toEqual({ sha: "abc123" });
		expect(calls[0]).toEqual(["commit", "--file", "-"]);
		expect(inputs[0]).toBe("feat: add thing");
	});

	test("push sets upstream when requested", async () => {
		const calls: string[][] = [];
		const git = new GitAdapter(
			scriptedExec({ "push -u origin feature/x": ok("") }, calls),
				);
		await git.push({ setUpstream: true, branch: "feature/x" });
		expect(calls[0]).toEqual(["push", "-u", "origin", "feature/x"]);
	});

	test("push without upstream runs a plain push", async () => {
		const calls: string[][] = [];
		const git = new GitAdapter(scriptedExec({ push: ok("") }, calls));
		await git.push({ setUpstream: false, branch: "feature/x" });
		expect(calls[0]).toEqual(["push"]);
	});

	test("push without upstream auto-retries with -u origin when git reports no upstream branch", async () => {
		const calls: string[][] = [];
		const git = new GitAdapter(
			scriptedExec(
					{
				push: fail(
						"fatal: The current branch feature/x has no upstream branch.",
							),
						"push -u origin feature/x": ok(""),
					},
			calls,
					),
				);
		await git.push({ setUpstream: false, branch: "feature/x" });
		expect(calls).toEqual([["push"], ["push", "-u", "origin", "feature/x"]]);
	});

	test("push surfaces git stderr verbatim via PortError on rejection", async () => {
		const git = new GitAdapter(
			scriptedExec(
					{ push: fail("! [rejected] main -> main (fetch first)") },
				[],
					),
				);
		await expect(
			git.push({ setUpstream: false, branch: "main" }),
				).rejects.toThrow(PortError);
		try {
			await git.push({ setUpstream: false, branch: "main" });
			} catch (e) {
			expect(e).toBeInstanceOf(PortError);
			expect((e as PortError).stderr).toBe(
					"! [rejected] main -> main (fetch first)",
						);
				}
	});

	test("commitsAhead parses structured commit metadata", async () => {
		const line = [
					"abc123",
					"feat: x",
					"Daniel Oxer",
					"2026-07-08T00:00:00Z",
				].join("\x1f");
		const git = new GitAdapter(
			scriptedExec(
					{ "log main..HEAD --pretty=format:%H\x1f%s\x1f%an\x1f%aI": ok(line) },
				[],
					),
				);
		const commits = await git.commitsAhead("main");
		expect(commits).toEqual([
					{
				sha: "abc123",
					subject: "feat: x",
				author: "Daniel Oxer",
					date: "2026-07-08T00:00:00Z",
					},
				]);
	});

	test("rangeDiff diffs against a base ref", async () => {
		const git = new GitAdapter(
			scriptedExec(
					{
						"diff main..HEAD --numstat": ok("2\t0\tsrc/b.ts\n"),
						"diff main..HEAD": ok(""),
					},
				[],
					),
				);
		const diffs = await git.rangeDiff("main");
		expect(diffs).toEqual([
				{
			path: "src/b.ts",
			statOnly: false,
			patch: null,
			insertions: 2,
			deletions: 0,
					},
				]);
	});

	test("log respects maxCount and base options", async () => {
		const calls: string[][] = [];
		const git = new GitAdapter(
			scriptedExec(
					{
						"log --pretty=format:%H\x1f%s\x1f%an\x1f%aI -n5 main..HEAD": ok(""),
					},
			calls,
					),
				);
		const commits = await git.log({ base: "main", maxCount: 5 });
		expect(commits).toEqual([]);
		expect(calls[0]).toEqual([
				"log",
				"--pretty=format:%H\x1f%s\x1f%an\x1f%aI",
				"-n5",
				"main..HEAD",
					]);
	});

	test("records a git cost entry per command, sized by stdout length", async () => {
		const costTracker = new CostTracker();
		const git = new GitAdapter(
			scriptedExec({ "rev-parse --abbrev-ref HEAD": ok("main\n") }, []),
			costTracker,
				);
		await git.currentBranch();

		expect(costTracker.getEntries()).toEqual([
				{
			type: "git",
			task: "rev-parse",
			inputTokens: 7,
			outputTokens: 2,
					},
				]);
	});
	test("worktrees parses --porcelain output and filters out the main worktree", async () => {
		// Real git output: uppercase HEAD, "branch refs/heads/name" not "symbolic"
		const porcelain = [
				"worktree /path/to/repo",
				"HEAD abc123",
				"branch refs/heads/main",
				"",
				"worktree /path/to/features/dev-wt",
				"HEAD def456",
				"branch refs/heads/feature/x",
				"",
			].join("\n");
		const calls: string[][] = [];
		const exec: GitExec = async (args, _input, cwd) => {
			calls.push(args);
			if (args[0] === "worktree") return ok(porcelain);
			throw new Error(`unscripted: ${args.join(" ")}`);
			};
		const git = new GitAdapter(exec);
		const worktrees = await git.worktrees("/path/to/repo");

		expect(calls[0]).toEqual(["worktree", "list", "--porcelain"]);
		expect(worktrees.length).toBe(1); // main tree filtered out by path match
		expect(worktrees[0]?.path).toBe("/path/to/features/dev-wt");
		expect(worktrees[0]?.ref).toBe("feature/x");
	});

	test("worktrees filters main tree by path even without joint marker", async () => {
		// When trees don't share a commit, git omits 'joint' entirely
		const porcelain = [
				"worktree /Users/dev/my-repo",
				"HEAD abc123",
				"detached",
				"",
			].join("\n");
		const exec: GitExec = async (args, _input) => {
			if (args[0] === "worktree") return ok(porcelain);
			throw new Error("unscripted");
			};
		const git = new GitAdapter(exec);
		const worktrees = await git.worktrees("/Users/dev/my-repo");

		expect(worktrees).toEqual([]); // repo root filtered by path, no joint
	});

	test("worktrees handles older git format with lowercase head and symbolic", async () => {
		const porcelain = [
				"worktree /path/to/repo",
				"head abc123",
				"symbolic refs/heads/main",
				"",
				"worktree /path/to/features/dev-wt",
				"head def456",
				"symbolic refs/heads/feature/x",
				"",
			].join("\n");
		const exec: GitExec = async (args, _input) => {
			if (args[0] === "worktree") return ok(porcelain);
			throw new Error("unscripted");
			};
		const git = new GitAdapter(exec);
		const worktrees = await git.worktrees("/path/to/repo");

		expect(worktrees.length).toBe(1);
		expect(worktrees[0]?.path).toBe("/path/to/features/dev-wt");
		expect(worktrees[0]?.ref).toBe("feature/x");
	});

	test("worktrees returns empty array when git command fails", async () => {
		const git = new GitAdapter(
			scriptedExec(
					{ "worktree list --porcelain": fail("not a git repo", 128) },
				[],
					),
				);
		const worktrees = await git.worktrees("/nonexistent");
		expect(worktrees).toEqual([]);
	});

	test("removeWorktree succeeds on clean removal", async () => {
		const calls: string[][] = [];
		const exec: GitExec = async (args) => {
			calls.push(args);
			if (args[0] === "worktree") return ok("");
			throw new Error(`unscripted: ${args.join(" ")}`);
			};
		const git = new GitAdapter(exec);
		await git.removeWorktree("/path/to/wt", "/path/to/repo");

		expect(calls).toEqual([["worktree", "remove", "/path/to/wt"]]);
	});

	test("removeWorktree throws PortError when removal fails", async () => {
		const git = new GitAdapter(
			scriptedExec(
					{
						"worktree remove /path/to/wt": fail("fatal: worktree has staged changes", 1),
					},
				[],
					),
				);
		await expect(git.removeWorktree("/path/to/wt", "/path/to/repo")).rejects.toThrow(PortError);
	});

	test("forceRemoveWorktree runs worktree remove --force", async () => {
		const calls: string[][] = [];
		const exec: GitExec = async (args) => {
			calls.push(args);
			if (args[0] === "worktree") return ok("");
			throw new Error(`unscripted: ${args.join(" ")}`);
			};
		const git = new GitAdapter(exec);
		await git.forceRemoveWorktree("/path/to/wt", "/path/to/repo");

		expect(calls[0]).toEqual(["worktree", "remove", "--force", "/path/to/wt"]);
	});

	test("forceRemoveWorktree throws PortError on failure", async () => {
		const git = new GitAdapter(
			scriptedExec(
					{
						"worktree remove --force /path/to/wt": fail("permission denied", 1),
					},
				[],
					),
				);
		await expect(
			git.forceRemoveWorktree("/path/to/wt", "/path/to/repo"),
				).rejects.toThrow(PortError);
	});

	test("showWorktreeStatus returns combined status + diff stat output", async () => {
		const exec: GitExec = async (args) => {
			if (args[0] === "status") return ok(" M src/changed.ts\n");
			if (args[0] === "diff") return ok(" src/changed.ts | 5 +++\n 1 file changed, 5 insertions(+)");
			throw new Error(`unscripted: ${args.join(" ")}`);
			};
		const git = new GitAdapter(exec);
		const output = await git.showWorktreeStatus("/repo", "/worktree/path");

		expect(output).toContain(" M src/changed.ts");
		expect(output).toContain("src/changed.ts | 5 +++");
	});
});