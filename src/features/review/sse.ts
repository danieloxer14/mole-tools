export interface SseFrame {
	event?: string;
	data?: unknown;
}

function encodeData(data: unknown): string {
	if (typeof data === "string") return data;
	return JSON.stringify(data ?? null);
}

export function formatSseFrame(frame: SseFrame): string {
	const event = frame.event ?? "message";
	const data = encodeData(frame.data);
	const lines = data.split("\n");
	return `event: ${event}\n${lines.map((line) => `data: ${line}`).join("\n")}\n\n`;
}

const HEARTBEAT_MS = 5_000;
const HEARTBEAT_FRAME = ": ping\n\n";

/**
 * Turn an async event source into an SSE response.
 *
 * A stream can fail while an agent or subprocess is running. Always close it
 * with a terminal `done` event so browsers do not leave a pending request.
 *
 * A layer or chat turn can think for minutes without emitting a frame, and both
 * `Bun.serve` and intermediaries drop a connection that goes quiet, so silent
 * gaps are filled with comment frames that clients ignore.
 */
export function sseResponse(
	source: AsyncIterable<SseFrame>,
	heartbeatMs: number = HEARTBEAT_MS,
): Response {
	const encoder = new TextEncoder();
	let lastFrameWasDone = false;

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const iterator = source[Symbol.asyncIterator]();
			const heartbeat = Symbol("heartbeat");
			try {
				let pending = iterator.next();
				for (;;) {
					let timer: ReturnType<typeof setTimeout> | undefined;
					const tick = new Promise<typeof heartbeat>((resolve) => {
						timer = setTimeout(() => resolve(heartbeat), heartbeatMs);
					});
					const settled = await Promise.race([pending, tick]);
					clearTimeout(timer);
					if (settled === heartbeat) {
						controller.enqueue(encoder.encode(HEARTBEAT_FRAME));
						continue;
					}
					if (settled.done) break;
					const normalized = settled.value ?? {};
					lastFrameWasDone = normalized.event === "done";
					controller.enqueue(encoder.encode(formatSseFrame(normalized)));
					pending = iterator.next();
				}
			} catch (error) {
				lastFrameWasDone = false;
				controller.enqueue(
					encoder.encode(
						formatSseFrame({
							event: "error",
							data: {
								message: error instanceof Error ? error.message : String(error),
							},
						}),
					),
				);
			} finally {
				if (!lastFrameWasDone) {
					controller.enqueue(
						encoder.encode(formatSseFrame({ event: "done", data: null })),
					);
				}
				controller.close();
			}
		},
	});

	return new Response(body, {
		headers: {
			"cache-control": "no-cache, no-store",
			connection: "keep-alive",
			"content-type": "text/event-stream; charset=utf-8",
		},
	});
}

export const createSseResponse = sseResponse;
