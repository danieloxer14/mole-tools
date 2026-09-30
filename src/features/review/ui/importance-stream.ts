import { type LayerStreamFrame, postSseStream } from "./layer-stream";

export async function consumeImportanceStream(
	token: string,
	action: "observe" | "retry",
	revisionKey: string,
	onFrame: (frame: LayerStreamFrame) => void,
	signal?: AbortSignal,
): Promise<void> {
	const path =
		action === "retry"
			? `/api/importance/retry?revisionKey=${encodeURIComponent(revisionKey)}`
			: "/api/importance/observe";
	await postSseStream(token, path, "Importance", action, onFrame, signal);
}
