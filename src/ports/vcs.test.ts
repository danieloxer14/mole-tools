import { describe, expect, test } from "bun:test";
import type { WorktreeInfo } from "./vcs";

describe("WorktreeInfo port type", () => {
	test("WorktreeInfo is exported from vcs and has path and ref fields", () => {
		const wt: WorktreeInfo = { path: "/repo/wt", ref: "feature/x" };
		expect(wt.path).toBe("/repo/wt");
		expect(wt.ref).toBe("feature/x");
	});

	test("WorktreeInfo can represent multiple worktrees in an array", () => {
		const wts: WorktreeInfo[] = [
			{ path: "/repo/wt1", ref: "dev" },
			{ path: "/repo/wt2", ref: "feature/y" },
		];
		expect(wts).toHaveLength(2);
	});

	test("WorktreeInfo allows empty ref for detached states", () => {
		const wt: WorktreeInfo = { path: "/repo/detached-wt", ref: "" };
		expect(wt.ref).toBe("");
	});
});
