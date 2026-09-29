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
const currentDiscussion = {
	id: "current-discussion",
	resolved: false,
	notes: [],
	position: null,
};
const syncedState = {
	mr: { title: "Current title" },
	discussions: [currentDiscussion],
} as unknown as ReviewApiState;

function operations(
	events: string[],
	freshness: ReviewFreshnessResponse,
	state: { current: ReviewApiState },
) {
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
			expect(state.current).toBe(syncedState);
			expect(state.current.mr.title).toBe("Current title");
			expect(state.current.discussions).toEqual([currentDiscussion]);
		},
		applyFreshness: () => {
			events.push("freshness");
		},
		applySyncedState: (next: ReviewApiState) => {
			events.push("synced");
			state.current = next;
		},
	};
}

async function expectSuccessfulRefresh(
	freshness: ReviewFreshnessResponse,
): Promise<void> {
	const events: string[] = [];
	const state = { current: {} as ReviewApiState };

	await runReviewRefresh(operations(events, freshness, state));

	expect(events).toEqual([
		"check",
		"freshness",
		"sync",
		"synced",
		"regenerate",
	]);
}

test("syncs and applies full state for an unchanged head before regeneration", async () => {
	await expectSuccessfulRefresh(fresh);
});

test("syncs and applies full state for a changed head before regeneration", async () => {
	await expectSuccessfulRefresh(stale);
});

test("stops before sync and regeneration when freshness fails", async () => {
	const events: string[] = [];
	const state = { current: {} as ReviewApiState };

	await expect(
		runReviewRefresh({
			...operations(events, fresh, state),
			checkFreshness: async () => {
				events.push("check");
				throw new Error("freshness failed");
			},
		}),
	).rejects.toThrow("freshness failed");

	expect(events).toEqual(["check"]);
});

test("stops before applying state or regenerating when sync fails on a fresh head", async () => {
	const events: string[] = [];
	const state = { current: {} as ReviewApiState };

	await expect(
		runReviewRefresh({
			...operations(events, fresh, state),
			sync: async () => {
				events.push("sync");
				throw new Error("sync failed");
			},
		}),
	).rejects.toThrow("sync failed");

	expect(events).toEqual(["check", "freshness", "sync"]);
});
