import type { ReviewApiState } from "../routes";

export interface ReviewFreshnessResponse {
	stale: boolean;
	headSha: string;
	newCommitCount: number;
}

export interface ReviewRefreshOperations {
	checkFreshness: () => Promise<ReviewFreshnessResponse>;
	sync: () => Promise<ReviewApiState>;
	regenerate: () => Promise<void>;
	applyFreshness: (freshness: ReviewFreshnessResponse) => void;
	applySyncedState: (state: ReviewApiState) => void;
}

export async function runReviewRefresh({
	checkFreshness,
	sync,
	regenerate,
	applyFreshness,
	applySyncedState,
}: ReviewRefreshOperations): Promise<void> {
	const freshness = await checkFreshness();
	applyFreshness(freshness);
	if (freshness.stale) {
		const syncedState = await sync();
		applySyncedState(syncedState);
	}
	await regenerate();
}
