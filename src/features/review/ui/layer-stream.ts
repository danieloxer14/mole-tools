import type { ReviewApiState } from "../routes";
import { apiUrl } from "./api-json";

export type LayerAction = "regenerate" | "retry";
type LayerStreamErrorAction = LayerAction | "observe" | "generate";

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

function parseSseBlock(block: string): LayerStreamFrame | null {
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

export async function readSseFrames(
	response: Response,
	onFrame: (frame: LayerStreamFrame) => void,
	missingBodyMessage: string,
): Promise<void> {
	const body = response.body;
	if (!body) throw new Error(missingBodyMessage);
	const reader = body.getReader();
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
				const frame = parseSseBlock(block);
				if (frame) onFrame(frame);
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) {
			const frame = parseSseBlock(buffer);
			if (frame) onFrame(frame);
		}
	} finally {
		reader.releaseLock();
	}
}

export async function postSseStream(
	token: string,
	path: string,
	streamName: "Layer" | "Importance" | "One pager",
	action: LayerStreamErrorAction,
	onFrame: (frame: LayerStreamFrame) => void,
	signal?: AbortSignal,
): Promise<void> {
	const response = await fetch(apiUrl(path, token), {
		method: "POST",
		headers: {
			accept: "text/event-stream",
			"X-Mole-Token": token,
		},
		signal,
	});
	if (!response.ok)
		throw new Error(
			`${streamName} ${action} request failed (${response.status})`,
		);
	await readSseFrames(
		response,
		onFrame,
		`${streamName} stream did not return a body`,
	);
}

export function consumeLayerStream(
	token: string,
	action: LayerAction | "observe",
	onFrame: (frame: LayerStreamFrame) => void,
): Promise<void> {
	return postSseStream(
		token,
		`/api/layers/${action}`,
		"Layer",
		action,
		onFrame,
	);
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
