import { describe, expect, test } from "bun:test";
import type { GitHostTarget } from "../ports/git-host";
import {
	gitHostTargetForRemote,
	gitHostTargetForReview,
} from "./git-host-target";

describe("gitHostTargetForRemote", () => {
	const remoteCases: [string | null, GitHostTarget][] = [
		["git@github.com:o/r.git", { provider: "github", host: "github.com" }],
		["https://github.com/o/r", { provider: "github", host: "github.com" }],
		[
			"ssh://git@github.com/o/r.git",
			{ provider: "github", host: "github.com" },
		],
		[
			"SSH://git@github.com/o/r.git",
			{ provider: "github", host: "github.com" },
		],
		["git@github.com:o/r.git", { provider: "github", host: "github.com" }],
		["https://GitHub.com/o/r", { provider: "github", host: "github.com" }],
		["https://github.com:443/o/r", { provider: "github", host: "github.com" }],
		["git@gitlab.com:g/p.git", { provider: "gitlab" }],
		["https://gitlab.example.com/o/r", { provider: "gitlab" }],
		[null, { provider: "gitlab" }],
		["", { provider: "gitlab" }],
		["not a remote", { provider: "gitlab" }],
		["https://[malformed", { provider: "gitlab" }],
	];

	test.each(remoteCases)("maps %j", (remote, target) => {
		expect(gitHostTargetForRemote(remote)).toEqual(target);
	});
});

describe("gitHostTargetForReview", () => {
	const ref = { host: "ghe.example.com", projectPath: "o/r", iid: 42 };

	test("preserves GitHub review host", () => {
		expect(gitHostTargetForReview("github", ref)).toEqual({
			provider: "github",
			host: "ghe.example.com",
		});
	});

	test("returns GitLab target", () => {
		expect(gitHostTargetForReview("gitlab", ref)).toEqual({
			provider: "gitlab",
		});
	});
});
