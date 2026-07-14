import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeVcs } from "../../../test/fakes/FakeVcs";
import type { WorktreeInfo } from "../../ports/vcs";
import { discoverExtraWorktrees, discoverRepos } from "./discovery";

let dir: string;

afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

/** Create a fake git repo by placing a `.git` directory. */
async function createFakeRepo(base: string, name: string): Promise<string> {
	const repoPath = join(base, name);
	await mkdir(join(repoPath, ".git"), { recursive: true });
	return repoPath;
}

describe("discoverRepos", () => {
	test("scanning an empty base dir returns zero repos", async () => {
		dir = join(tmpdir(), "mole-tools-discovery-empty");
		await mkdir(dir, { recursive: true });

		const repos = await discoverRepos(dir);

		expect(repos).toEqual([]);
	});

	test("returns a single repo when one .git exists", async () => {
		dir = join(tmpdir(), "mole-tools-discovery-one");
		await mkdir(dir, { recursive: true });
		const repoPath = await createFakeRepo(dir, "my-repo");

		const repos = await discoverRepos(dir);

		expect(repos).toEqual([repoPath]);
	});

	test("nested paths under the same repo root are deduplicated", async () => {
		dir = join(tmpdir(), "mole-tools-discovery-dedup");
		await mkdir(dir, { recursive: true });

		const repoPath = await createFakeRepo(dir, "my-repo");
		const nestedGit = join(repoPath, "src", "nested", ".git");
		await mkdir(nestedGit, { recursive: true });

		const repos = await discoverRepos(dir, async () => repoPath);

		expect(repos).toEqual([repoPath]);
	});

	test("returns multiple repos sorted by path", async () => {
		dir = join(tmpdir(), "mole-tools-discovery-multi");
		await mkdir(dir, { recursive: true });

		const bRepo = await createFakeRepo(dir, "b-repo");
		const aRepo = await createFakeRepo(dir, "a-repo");

		const repos = await discoverRepos(dir);

		expect(repos).toEqual([aRepo, bRepo]); // sorted alphabetically
	});
});

describe("discoverExtraWorktrees", () => {
	test("returns only extra worktrees when VCS returns mixed main+extras", async () => {
		dir = join(tmpdir(), "mole-tools-discovery-mixed-wt");
		await mkdir(dir, { recursive: true });
		const repoPath = await createFakeRepo(dir, "my-repo");

		const worktrees: WorktreeInfo[] = [
			{ path: repoPath, ref: "main" }, // primary — filtered out
			{ path: join(repoPath, "wt-feature-a"), ref: "feature/a" },
			{ path: join(repoPath, "wt-fix-bug"), ref: "fix/bug" },
		];

		const vcs = new FakeVcs({ worktrees });
		const result = await discoverExtraWorktrees(dir, vcs);

		expect(result).toEqual([
			{
				repoRoot: repoPath,
				worktrees: [
					{ path: join(repoPath, "wt-feature-a"), ref: "feature/a" },
					{ path: join(repoPath, "wt-fix-bug"), ref: "fix/bug" },
				],
				worktreePaths: [
					join(repoPath, "wt-feature-a"),
					join(repoPath, "wt-fix-bug"),
				],
			},
		]);
	});

	test("returns empty array when no repos found", async () => {
		dir = join(tmpdir(), "mole-tools-discovery-no-repos");
		await mkdir(dir, { recursive: true });

		const vcs = new FakeVcs();
		const result = await discoverExtraWorktrees(dir, vcs);

		expect(result).toEqual([]);
	});

	test("skips repos with only primary worktree", async () => {
		dir = join(tmpdir(), "mole-tools-discovery-primary-only");
		await mkdir(dir, { recursive: true });
		const repoPath = await createFakeRepo(dir, "my-repo");

		const worktrees: WorktreeInfo[] = [
			{ path: repoPath, ref: "main" }, // only primary
		];

		const vcs = new FakeVcs({ worktrees });
		const result = await discoverExtraWorktrees(dir, vcs);

		expect(result).toEqual([]);
	});

	test("returns results sorted by path within each repo", async () => {
		dir = join(tmpdir(), "mole-tools-discovery-sorted");
		await mkdir(dir, { recursive: true });
		const repoPath = await createFakeRepo(dir, "my-repo");

		// Provide in non-sorted order deliberately
		const worktrees: WorktreeInfo[] = [
			{ path: repoPath, ref: "main" },
			{ path: join(repoPath, "wt-z-last"), ref: "z" },
			{ path: join(repoPath, "wt-a-first"), ref: "a" },
		];

		const vcs = new FakeVcs({ worktrees });
		const result = await discoverExtraWorktrees(dir, vcs);

		expect(result[0]?.worktreePaths).toEqual([
			join(repoPath, "wt-a-first"),
			join(repoPath, "wt-z-last"),
		]);
	});
});
