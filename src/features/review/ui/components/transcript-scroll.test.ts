import { expect, test } from "bun:test";
import {
	isTranscriptAtBottom,
	scrollTranscriptToBottom,
	TRANSCRIPT_BOTTOM_TOLERANCE,
} from "./transcript-scroll";

function transcriptMetrics(scrollTop: number) {
	return {
		scrollHeight: 1000,
		scrollTop,
		clientHeight: 400,
	};
}

test("treats exactly 16px from transcript bottom as at bottom", () => {
	expect(TRANSCRIPT_BOTTOM_TOLERANCE).toBe(16);
	expect(isTranscriptAtBottom(transcriptMetrics(584))).toBe(true);
});

test("does not follow when transcript is more than 16px from bottom", () => {
	expect(isTranscriptAtBottom(transcriptMetrics(583))).toBe(false);
});

test("scrolls transcript to its latest content", () => {
	const element = transcriptMetrics(0);
	scrollTranscriptToBottom(element);
	expect(element.scrollTop).toBe(600);
});
