export interface StateRequestToken {
	epoch: number;
	id: number;
}

export interface ReviewStateRequestSequence {
	beginFetch(): StateRequestToken;
	beginMutation(): StateRequestToken;
	canApplyFetch(token: StateRequestToken): boolean;
	canApplyMutation(token: StateRequestToken): boolean;
	finishMutation(token: StateRequestToken): void;
}

export function createReviewStateRequestSequence(): ReviewStateRequestSequence {
	let epoch = 0;
	let nextId = 0;
	let latestFetchId = 0;
	let mutationEpoch: number | null = null;

	const canApplyMutation = (token: StateRequestToken): boolean =>
		mutationEpoch === token.epoch && token.epoch === epoch;

	return {
		beginFetch() {
			const token = { epoch, id: ++nextId };
			latestFetchId = token.id;
			return token;
		},
		beginMutation() {
			epoch += 1;
			mutationEpoch = epoch;
			latestFetchId = 0;
			return { epoch, id: ++nextId };
		},
		canApplyFetch(token) {
			return (
				mutationEpoch === null &&
				token.epoch === epoch &&
				token.id === latestFetchId
			);
		},
		canApplyMutation,
		finishMutation(token) {
			if (!canApplyMutation(token)) return;
			mutationEpoch = null;
			epoch += 1;
			latestFetchId = 0;
		},
	};
}
