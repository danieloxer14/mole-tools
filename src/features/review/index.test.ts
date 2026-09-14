import { describe, expect, test } from "bun:test";
import { reviewFeature } from "./index";

describe("review descriptor", () => {
	test("documents review UI prompt and agent management", () => {
		expect(reviewFeature.name).toBe("review");
		expect(reviewFeature.help?.notes).toEqual([
			"Requires an authenticated `glab` and the configured review agent binary on PATH.",
			"Review state persists under ~/.config/mole-tools/reviews.",
			"Prompts and the review agent/model are managed from the review UI's Prompts & Models panel.",
		]);
	});
});
