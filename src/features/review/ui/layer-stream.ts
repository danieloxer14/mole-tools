import type { ReviewApiState } from "../routes";

export type LayerAction = "regenerate" | "retry";
type LayerStreamAction = LayerAction | "observe";

export interface LayerStreamFrame {
	event: string;
	data: Record<string, unknown>;
}

function parseLayerStatus(
	value: unknown,
): ReviewApiState["layerStatus"] | null {
	return value === "pending" ||
		value === "running" ||
		value === "ready" ||
		value === "failed"
		? value
		: null;
}

function parseLayerSseBlock(block: string): LayerStreamFrame | null {
	let event = "message";
	const dataLines: string[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) event = line.slice(6).trim();
		if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
	}
	if (dataLines.length === 0) return null;
	try {
		const data: unknown = JSON.parse(dataLines.join("\n"));
		if (typeof data !== "object" || data === null) return null;
		return { event, data: data as Record<string, unknown> };
	} catch {
		return null;
	}
}

export async function consumeLayerStream(
	token: string,
	action: LayerStreamAction,
	onFrame: (frame: LayerStreamFrame) => void,
): Promise<void> {
	const response = await fetch(
		`/api/layers/${action}?t=${encodeURIComponent(token)}`,
		{
			method: "POST",
			headers: {
				accept: "text/event-stream",
				"X-Mole-Token": token,
			},
		},
	);
	if (!response.ok)
		throw new Error(`Layer ${action} request failed (${response.status})`);
	if (!response.body) throw new Error("Layer stream did not return a body");

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			buffer += decoder.decode(result.value, { stream: true });
			const blocks = buffer.split(/\r?\n\r?\n/);
			buffer = blocks.pop() ?? "";
			for (const block of blocks) {
				const frame = parseLayerSseBlock(block);
				if (frame) onFrame(frame);
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) {
			const frame = parseLayerSseBlock(buffer);
			if (frame) onFrame(frame);
		}
	} finally {
		reader.releaseLock();
	}
}

export function mergeLayerStreamFrame(
	state: ReviewApiState,
	frame: LayerStreamFrame,
): ReviewApiState {
	const status =
		frame.event === "error"
			? ("failed" as const)
			: parseLayerStatus(frame.data.status);
	const message =
		typeof frame.data.message === "string" ? frame.data.message : null;
	const error =
		typeof frame.data.error === "string"
			? frame.data.error
			: frame.data.error === null
				? null
				: undefined;
	const layers = Array.isArray(frame.data.layers)
		? (frame.data.layers as ReviewApiState["layers"])
		: state.layers;
	return {
		...state,
		layerStatus: status ?? state.layerStatus,
		layerError:
			frame.event === "error"
				? (message ?? state.layerError)
				: error !== undefined
					? error
					: status === "running"
						? null
						: state.layerError,
		layers,
	};
}

export function startInitialLayerStream(
	token: string,
	state: Pick<ReviewApiState, "layerStatus" | "layers">,
	onFrame: (frame: LayerStreamFrame) => void,
): { action: "regenerate" | "observe"; stream: Promise<void> } | null {
	const action =
		state.layerStatus === "running"
			? "observe"
			: state.layerStatus === "pending" &&
					state.layers.every((layer) => !layer.stale)
				? "regenerate"
				: null;
	if (!action) return null;
	return {
		action,
		stream: Promise.resolve().then(() =>
			consumeLayerStream(token, action, onFrame),
		),
	};
}
