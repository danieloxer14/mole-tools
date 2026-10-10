import { describe, expect, test } from "bun:test";
import { FakeGitHost } from "../../../test/fakes/FakeGitHost";
import { fakeContext } from "../../../test/fakes/fakeContext";
import type { GitHostTarget } from "../../ports/git-host";
import { reviewFeature, runReviewFlow } from "./index";

describe("review descriptor", () => {
	test("documents review UI prompt and agent management", () => {
		expect(reviewFeature.name).toBe("review");
		expect(reviewFeature.help?.notes).toEqual([
			"Requires an authenticated `glab` (GitLab) or `gh` (GitHub) for the URL's host, and the configured review agent binary on PATH.",
			"Review state persists under ~/.config/mole-tools/reviews.",
			"Prompts and the review agent/model are managed from the review UI's Settings panel.",
		]);
	});
});

describe("runReviewFlow host selection", () => {
	test("selects GitHub host for pull request URL", async () => {
		const targets: GitHostTarget[] = [];
		const ctx = fakeContext({
			gitHostFor: (target) => {
				targets.push(target);
				return new FakeGitHost({
					fetchMr: async () => {
						throw new Error("stop");
					},
				});
			},
		});

		await expect(
			runReviewFlow(ctx, {
				url: "https://github.com/o/r/pull/42",
				noOpen: true,
				refresh: false,
			}),
		).rejects.toThrow("stop");
		expect(targets).toEqual([{ provider: "github", host: "github.com" }]);
	});

	test("selects GitLab host for merge request URL", async () => {
		const targets: GitHostTarget[] = [];
		const ctx = fakeContext({
			gitHostFor: (target) => {
				targets.push(target);
				return new FakeGitHost({
					fetchMr: async () => {
						throw new Error("stop");
					},
				});
			},
		});

		await expect(
			runReviewFlow(ctx, {
				url: "https://gitlab.com/g/p/-/merge_requests/42",
				noOpen: true,
				refresh: false,
			}),
		).rejects.toThrow("stop");
		expect(targets).toEqual([{ provider: "gitlab" }]);
	});
});
