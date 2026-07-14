import { describe, expect, test } from "bun:test";
import type { Vcs, WorktreeInfo } from "../ports/vcs";
import { FakeVcs } from "../../test/fakes/FakeVcs";

describe("Vcs port contract — worktrees", () => {
	test("Vcs interface includes worktrees method callable via FakeVcs", async () => {
		const vcs: Vcs = new FakeVcs();
		const result: WorktreeInfo[] = await vcs.worktrees("/fake/repo");

		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBe(0); // empty default from fake stub
	});

	test("Vcs interface includes removeWorktree method callable via FakeVcs", async () => {
		const vcs: Vcs = new FakeVcs();
		// Calls without error; removes the worktree in the implementation
		await vcs.removeWorktree("/fake/repo/wt1", "/fake/repo");
	});

	test("Vcs interface includes forceRemoveWorktree method callable via FakeVcs", async () => {
		const vcs: Vcs = new FakeVcs();
		await vcs.forceRemoveWorktree("/fake/repo/wt2", "/fake/repo");
	});

	test("Vcs interface includes showWorktreeStatus method callable via FakeVcs", async () => {
		const vcs: Vcs = new FakeVcs();
		const status = await vcs.showWorktreeStatus("/fake/repo", "/fake/repo/wt3");
		expect(typeof status).toBe("string");
	});

	test("FakeVcs removeWorktree throws when configured with error", async () => {
		const vcs: Vcs = new FakeVcs({ removeWorktreeError: new Error("worktree busy") });
		await expect(vcs.removeWorktree("/fake/repo/wt1", "/fake/repo")).rejects.toThrow("worktree busy");
	});

	test("FakeVcs forceRemoveWorktree throws when configured with error", async () => {
		const vcs: Vcs = new FakeVcs({ forceRemoveWorktreeError: new Error("permission denied") });
		await expect(vcs.forceRemoveWorktree("/fake/repo/wt2", "/fake/repo")).rejects.toThrow("permission denied");
	});

	test("FakeVcs showWorktreeStatus returns configured output with default fallback", async () => {
		const vcsDefault: Vcs = new FakeVcs();
		expect(await vcsDefault.showWorktreeStatus("/repo", "/repo/wt")).toBe("/fake/repo/wt: clean");

		const vcsCustom: Vcs = new FakeVcs({ showWorktreeStatusOutput: "M file.txt\"" });
		expect(await vcsCustom.showWorktreeStatus("/repo", "/repo/wt")).toBe("M file.txt\"");
	});

	test("FakeVcs worktrees returns configured list with empty default", async () => {
		const vcsDefault: Vcs = new FakeVcs();
		expect(await vcsDefault.worktrees("/repo")).toEqual([]);

		const vcsCustom: Vcs = new FakeVcs({
			worktrees: [{ path: "/repo/wt1", ref: "feature/a" }],
		});
		expect(await vcsCustom.worktrees("/repo")).toEqual([{ path: "/repo/wt1", ref: "feature/a" }]);
	});
});
