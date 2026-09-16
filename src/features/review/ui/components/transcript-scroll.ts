export const TRANSCRIPT_BOTTOM_TOLERANCE = 16;

export function isTranscriptAtBottom(
	element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
	tolerance = TRANSCRIPT_BOTTOM_TOLERANCE,
): boolean {
	return (
		element.scrollHeight - element.scrollTop - element.clientHeight <= tolerance
	);
}

export function scrollTranscriptToBottom(
	element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
): void {
	element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
}
