import { expect, test } from "bun:test";
import { createReviewStateRequestSequence } from "./review-state-request-sequence";

test("ignores state responses that resolve around a newer mutation", () => {
	const sequence = createReviewStateRequestSequence();
	const olderFetch = sequence.beginFetch();
	const mutation = sequence.beginMutation();

	expect(sequence.canApplyFetch(olderFetch)).toBe(false);
	expect(sequence.canApplyMutation(mutation)).toBe(true);

	sequence.finishMutation(mutation);
	expect(sequence.canApplyFetch(olderFetch)).toBe(false);

	const latestFetch = sequence.beginFetch();
	expect(sequence.canApplyFetch(latestFetch)).toBe(true);
});

test("ignores fetches started while a mutation is in flight", () => {
	const sequence = createReviewStateRequestSequence();
	const mutation = sequence.beginMutation();
	const fetchDuringMutation = sequence.beginFetch();

	expect(sequence.canApplyFetch(fetchDuringMutation)).toBe(false);
	expect(sequence.canApplyMutation(mutation)).toBe(true);

	sequence.finishMutation(mutation);
	expect(sequence.canApplyFetch(fetchDuringMutation)).toBe(false);
});
