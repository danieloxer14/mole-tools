import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getReviewPaths } from "../review/paths";
import { getBabysitterWorktreePath, getReviewBabysitterPaths } from "./paths";

const ref = {
	host: "gitlab.example.com",
	projectPath: "group/api",
	iid: 42,
};

describe("review babysitter paths", () => {
	test("reuses review cache repo and derives a head-addressed transient worktree", () => {
		const reviewPaths = getReviewPaths(ref, "/tmp/mole-tools/config.json");
		const babysitter = getReviewBabysitterPaths(
			ref,
			"abcdef1234567890",
			reviewPaths,
		);

		expect(babysitter.repoPath).toBe(reviewPaths.repoPath);
		expect(babysitter.worktreePath).toBe(
			join(
				reviewPaths.worktreesRoot,
				"gitlab.example.com",
				"group",
				"api",
				"babysitter-mr-42-abcdef123456",
			),
		);
		expect(babysitter.worktreePath).not.toBe(reviewPaths.worktreePath);
	});

	test("accepts config path when no review paths object is supplied", () => {
		expect(
			getBabysitterWorktreePath(
				ref,
				"0123456789abcdef",
				"/tmp/mole-tools/config.json",
			),
		).toBe(
			"/tmp/mole-tools/worktrees/gitlab.example.com/group/api/babysitter-mr-42-0123456789ab",
		);
	});
});
