import { expect, test } from "bun:test";
import { splitBddScenario } from "./LayerPane";

test("splits Given, When, Then clauses into display steps", () => {
	expect(
		splitBddScenario(
			"Given a video model with capacity, when tagged assets are calculated, then capacity is used.",
		),
	).toEqual([
		"Given a video model with capacity",
		"when tagged assets are calculated",
		"then capacity is used.",
	]);
});
