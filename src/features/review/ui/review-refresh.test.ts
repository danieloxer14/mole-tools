import { expect, test } from "bun:test";
import type { ReviewApiState } from "../routes";
import {
	type ReviewFreshnessResponse,
	runReviewRefresh,
} from "./review-refresh";

const fresh: ReviewFreshnessResponse = {
	stale: false,
	headSha: "head",
	newCommitCount: 0,
};
const stale: ReviewFreshnessResponse = {
	stale: true,
	headSha: "remote-head",
	newCommitCount: 2,
};
const syncedState = {} as ReviewApiState;

function operations(events: string[], freshness: ReviewFreshnessResponse) {
	return {
		checkFreshness: async () => {
			events.push("check");
			return freshness;
		},
		sync: async () => {
			events.push("sync");
			return syncedState;
		},
		regenerate: async () => {
			events.push("regenerate");
		},
		applyFreshness: () => {
			events.push("freshness");
		},
		applySyncedState: () => {
			events.push("synced");
		},
	};
}

test("refreshes a fresh review without syncing before regeneration", async () => {
	const events: string[] = [];

	await runReviewRefresh(operations(events, fresh));

	expect(events).toEqual(["check", "freshness", "regenerate"]);
});

test("syncs a stale review before regenerating layers", async () => {
	const events: string[] = [];

	await runReviewRefresh(operations(events, stale));

	expect(events).toEqual([
		"check",
		"freshness",
		"sync",
		"synced",
		"regenerate",
	]);
});

test("stops before sync and regeneration when freshness fails", async () => {
	const events: string[] = [];

	await expect(
		runReviewRefresh({
			...operations(events, fresh),
			checkFreshness: async () => {
				events.push("check");
				throw new Error("freshness failed");
			},
		}),
	).rejects.toThrow("freshness failed");

	expect(events).toEqual(["check"]);
});

test("stops before regeneration when sync fails", async () => {
	const events: string[] = [];

	await expect(
		runReviewRefresh({
			...operations(events, stale),
			sync: async () => {
				events.push("sync");
				throw new Error("sync failed");
			},
		}),
	).rejects.toThrow("sync failed");

	expect(events).toEqual(["check", "freshness", "sync"]);
});
