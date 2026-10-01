import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { OnePagerSnapshot } from "../one-pager";
import type { OnePagerController } from "./use-one-pager";
import { useOnePager } from "./use-one-pager";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "one-pager-test-token";
const originalFetch = globalThis.fetch;
const roots: Root[] = [];
let latest: OnePagerController | null = null;

function HookProbe({ enabled }: { enabled: boolean }) {
	latest = useOnePager(TOKEN, enabled);
	return null;
}

function current(): OnePagerController {
	if (!latest) throw new Error("One pager hook was not rendered");
	return latest;
}

function mountHook(enabled: boolean): {
	rerender(enabled: boolean): void;
	unmount(): void;
} {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	let mounted = true;
	act(() => root.render(<HookProbe enabled={enabled} />));

	return {
		rerender(nextEnabled) {
			act(() => root.render(<HookProbe enabled={nextEnabled} />));
		},
		unmount() {
			if (!mounted) return;
			mounted = false;
			const index = roots.indexOf(root);
			if (index !== -1) roots.splice(index, 1);
			act(() => root.unmount());
		},
	};
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function onePagerSnapshot(
	status: OnePagerSnapshot["status"],
	markdown: string | null = null,
): OnePagerSnapshot {
	return {
		status,
		markdown,
		updatedAt: status === "ready" ? "2026-09-30T12:00:00.000Z" : null,
	};
}

function streamResponse(
	frames: { event: string; data: Record<string, unknown> }[],
): Response {
	return new Response(
		frames
			.map(
				({ event, data }) =>
					`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
			)
			.join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

function requestPath(input: RequestInfo | URL): string {
	return new URL(String(input), "http://localhost").pathname;
}

async function settle(): Promise<void> {
	await act(async () => {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
}
async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
		});
	}
	throw new Error("Timed out waiting for one-pager state");
}

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
	globalThis.fetch = originalFetch;
	latest = null;
});

test("disabled hook stays idle without fetching and enabling loads the snapshot", async () => {
	const requests: { path: string; method: string | undefined }[] = [];
	globalThis.fetch = async (input, init) => {
		requests.push({ path: requestPath(input), method: init?.method });
		return jsonResponse(onePagerSnapshot("idle"));
	};

	const hook = mountHook(false);
	await settle();
	expect(current()).toMatchObject({
		status: "idle",
		markdown: null,
		error: null,
	});
	expect(requests).toEqual([]);

	hook.rerender(true);
	await settle();
	expect(requests).toEqual([{ path: "/api/one-pager", method: undefined }]);
	expect(current().status).toBe("idle");
});

test("a running snapshot attaches to the one pager observe stream", async () => {
	const requests: { path: string; method: string | undefined }[] = [];
	let snapshotCount = 0;
	globalThis.fetch = async (input, init) => {
		const path = requestPath(input);
		requests.push({ path, method: init?.method });
		if (path === "/api/one-pager") {
			snapshotCount += 1;
			return jsonResponse(
				snapshotCount === 1
					? onePagerSnapshot("running")
					: onePagerSnapshot("ready", "# Observed summary"),
			);
		}
		if (path === "/api/one-pager/observe")
			return streamResponse([
				{
					event: "status",
					data: {
						status: "ready",
						markdown: "# Observed summary",
						updatedAt: "2026-09-30T12:01:00.000Z",
					},
				},
				{ event: "done", data: { status: "ready" } },
			]);
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true);
	await settle();

	expect(requests).toEqual([
		{ path: "/api/one-pager", method: undefined },
		{ path: "/api/one-pager/observe", method: "POST" },
		{ path: "/api/one-pager", method: undefined },
	]);
	expect(current()).toMatchObject({
		status: "ready",
		markdown: "# Observed summary",
		error: null,
	});
});
test("observe reconnect clears transient stream error when running status resumes", async () => {
	const requests: string[] = [];
	const readySnapshot = Promise.withResolvers<Response>();
	let snapshotCount = 0;
	let observeCount = 0;
	globalThis.fetch = async (input) => {
		const path = requestPath(input);
		requests.push(path);
		if (path === "/api/one-pager") {
			snapshotCount += 1;
			if (snapshotCount === 3) return readySnapshot.promise;
			return jsonResponse(
				snapshotCount < 3
					? onePagerSnapshot("running")
					: onePagerSnapshot("ready", "# Recovered summary"),
			);
		}
		if (path === "/api/one-pager/observe") {
			observeCount += 1;
			if (observeCount === 1) throw new Error("observe connection dropped");
			return streamResponse([
				{ event: "status", data: { status: "running" } },
				{ event: "done", data: { status: "running" } },
			]);
		}
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true);
	await settle();

	expect(current()).toMatchObject({
		status: "running",
		error: "observe connection dropped",
	});
	await waitFor(() => snapshotCount === 3);
	expect(current()).toMatchObject({ status: "running", error: null });

	readySnapshot.resolve(
		jsonResponse(onePagerSnapshot("ready", "# Recovered summary")),
	);
	await waitFor(() => current().status === "ready");
	expect(current()).toMatchObject({
		status: "ready",
		markdown: "# Recovered summary",
		error: null,
	});
	expect(observeCount).toBe(2);
	expect(requests).toEqual([
		"/api/one-pager",
		"/api/one-pager/observe",
		"/api/one-pager",
		"/api/one-pager/observe",
		"/api/one-pager",
	]);
});

test("observe preserves generation failure after idle snapshot", async () => {
	let snapshotCount = 0;
	globalThis.fetch = async (input) => {
		const path = requestPath(input);
		if (path === "/api/one-pager") {
			snapshotCount += 1;
			return jsonResponse(
				snapshotCount === 1
					? onePagerSnapshot("running")
					: onePagerSnapshot("idle"),
			);
		}
		if (path === "/api/one-pager/observe")
			return streamResponse([
				{ event: "status", data: { status: "idle" } },
				{ event: "error", data: { message: "Generation failed." } },
				{ event: "done", data: { status: "failed" } },
			]);
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true);
	await settle();

	expect(current()).toMatchObject({
		status: "idle",
		markdown: null,
		error: "Generation failed.",
	});
});
test("observe keeps regeneration failure visible with existing ready document", async () => {
	let snapshotCount = 0;
	globalThis.fetch = async (input) => {
		const path = requestPath(input);
		if (path === "/api/one-pager") {
			snapshotCount += 1;
			return jsonResponse(
				snapshotCount === 1
					? onePagerSnapshot("running", "# Existing summary")
					: onePagerSnapshot("ready", "# Existing summary"),
			);
		}
		if (path === "/api/one-pager/observe")
			return streamResponse([
				{
					event: "status",
					data: { status: "running", markdown: "# Existing summary" },
				},
				{ event: "error", data: { message: "Regeneration failed." } },
				{ event: "done", data: { status: "failed" } },
			]);
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true);
	await settle();

	expect(current()).toMatchObject({
		status: "ready",
		markdown: "# Existing summary",
		error: "Regeneration failed.",
	});
});

test("create shows running and applies ready markdown from its stream", async () => {
	const requests: { path: string; method: string | undefined }[] = [];
	const generateResponse = Promise.withResolvers<Response>();
	let getCount = 0;
	globalThis.fetch = async (input, init) => {
		const path = requestPath(input);
		requests.push({ path, method: init?.method });
		if (path === "/api/one-pager") {
			getCount += 1;
			return jsonResponse(
				onePagerSnapshot(
					getCount === 1 ? "idle" : "ready",
					getCount === 1 ? null : "# Generated summary",
				),
			);
		}
		if (path === "/api/one-pager/generate") return generateResponse.promise;
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true);
	await settle();
	act(() => current().create());
	await settle();
	expect(current().status).toBe("running");
	expect(requests.at(-1)).toEqual({
		path: "/api/one-pager/generate",
		method: "POST",
	});

	generateResponse.resolve(
		streamResponse([
			{ event: "status", data: { status: "running" } },
			{
				event: "status",
				data: {
					status: "ready",
					markdown: "# Generated summary",
					updatedAt: "2026-09-30T12:02:00.000Z",
				},
			},
			{ event: "done", data: { status: "ready" } },
		]),
	);
	await settle();

	expect(requests.filter(({ path }) => path === "/api/one-pager")).toHaveLength(
		2,
	);
	expect(current()).toMatchObject({
		status: "ready",
		markdown: "# Generated summary",
		error: null,
	});
});

test("create recovers from a dropped generation stream while server is still running", async () => {
	const requests: string[] = [];
	const generateResponse = Promise.withResolvers<Response>();
	const observeResponse = Promise.withResolvers<Response>();
	let getCount = 0;
	globalThis.fetch = async (input) => {
		const path = requestPath(input);
		requests.push(path);
		if (path === "/api/one-pager") {
			getCount += 1;
			return jsonResponse(
				getCount === 1
					? onePagerSnapshot("idle")
					: getCount === 2
						? onePagerSnapshot("running")
						: onePagerSnapshot("ready", "# Recovered summary"),
			);
		}
		if (path === "/api/one-pager/generate") return generateResponse.promise;
		if (path === "/api/one-pager/observe") return observeResponse.promise;
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true);
	await settle();
	act(() => current().create());
	await settle();
	generateResponse.reject(new Error("generation stream disconnected"));
	await waitFor(() => requests.includes("/api/one-pager/observe"));

	expect(current().status).toBe("running");
	expect(requests).toEqual([
		"/api/one-pager",
		"/api/one-pager/generate",
		"/api/one-pager",
		"/api/one-pager/observe",
	]);

	observeResponse.resolve(
		streamResponse([
			{
				event: "status",
				data: {
					status: "ready",
					markdown: "# Recovered summary",
					updatedAt: "2026-09-30T12:02:00.000Z",
				},
			},
			{ event: "done", data: { status: "ready" } },
		]),
	);
	await waitFor(() => current().status === "ready");

	expect(current()).toMatchObject({
		status: "ready",
		markdown: "# Recovered summary",
	});
});

test("create replaces an open observe stream without stale frames or abort errors", async () => {
	const requests: string[] = [];
	const generateResponse = Promise.withResolvers<Response>();
	let getCount = 0;
	let observeSignal: AbortSignal | undefined;
	globalThis.fetch = async (input, init) => {
		const path = requestPath(input);
		requests.push(path);
		if (path === "/api/one-pager") {
			getCount += 1;
			return jsonResponse(
				onePagerSnapshot(
					getCount === 1 ? "running" : "ready",
					getCount === 1 ? null : "# Generated summary",
				),
			);
		}
		if (path === "/api/one-pager/observe") {
			const signal = init?.signal;
			if (!(signal instanceof AbortSignal))
				throw new Error("Observe stream did not receive an abort signal");
			observeSignal = signal;
			const encoder = new TextEncoder();
			let firstRead = true;
			const reader = {
				read() {
					if (firstRead) {
						firstRead = false;
						return Promise.resolve({
							value: encoder.encode(
								`event: status\ndata: ${JSON.stringify({
									status: "ready",
									markdown: "# Observed summary",
									updatedAt: "2026-09-30T12:01:00.000Z",
								})}\n\n`,
							),
							done: false,
						});
					}
					if (signal.aborted)
						return Promise.reject(new DOMException("Aborted", "AbortError"));
					return new Promise<{ value: Uint8Array; done: boolean }>(
						(resolve) => {
							signal.addEventListener(
								"abort",
								() => {
									resolve({
										value: encoder.encode(
											`event: status\ndata: ${JSON.stringify({
												status: "ready",
												markdown: "# Stale observed summary",
												updatedAt: "2026-09-30T12:02:00.000Z",
											})}\n\n`,
										),
										done: false,
									});
								},
								{ once: true },
							);
						},
					);
				},
				releaseLock() {},
			};
			return {
				ok: true,
				body: { getReader: () => reader },
			} as unknown as Response;
		}
		if (path === "/api/one-pager/generate") return generateResponse.promise;
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true);
	await settle();
	expect(observeSignal).toBeDefined();
	expect(current()).toMatchObject({
		status: "ready",
		markdown: "# Observed summary",
		error: null,
	});

	act(() => current().create());
	await settle();

	expect(observeSignal?.aborted).toBe(true);
	expect(current()).toMatchObject({
		status: "running",
		markdown: "# Observed summary",
		error: null,
	});
	expect(requests.at(-1)).toBe("/api/one-pager/generate");

	generateResponse.resolve(
		streamResponse([
			{ event: "status", data: { status: "running" } },
			{
				event: "status",
				data: {
					status: "ready",
					markdown: "# Generated summary",
					updatedAt: "2026-09-30T12:03:00.000Z",
				},
			},
			{ event: "done", data: { status: "ready" } },
		]),
	);
	await settle();

	expect(current()).toMatchObject({
		status: "ready",
		markdown: "# Generated summary",
		error: null,
	});
});

test("stream error remains visible after idle snapshot refetch", async () => {
	const requests: { path: string; method: string | undefined }[] = [];
	globalThis.fetch = async (input, init) => {
		const path = requestPath(input);
		requests.push({ path, method: init?.method });
		if (path === "/api/one-pager") {
			return jsonResponse(onePagerSnapshot("idle"));
		}
		if (path === "/api/one-pager/generate")
			return streamResponse([
				{ event: "status", data: { status: "running" } },
				{
					event: "status",
					data: { status: "idle", markdown: null, updatedAt: null },
				},
				{ event: "error", data: { message: "Generation failed" } },
				{ event: "done", data: { status: "failed" } },
			]);
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true);
	await settle();
	act(() => current().create());
	await settle();

	expect(requests.filter(({ path }) => path === "/api/one-pager")).toHaveLength(
		2,
	);
	expect(
		requests.filter(({ path }) => path === "/api/one-pager/generate"),
	).toHaveLength(1);
	expect(current()).toMatchObject({
		status: "idle",
		markdown: null,
		error: "Generation failed",
	});
});

test("three scheduled refreshes coalesce into one GET", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		requests.push(requestPath(input));
		return jsonResponse(onePagerSnapshot("ready", "# Summary"));
	};

	mountHook(true);
	await settle();
	requests.length = 0;
	act(() => {
		current().scheduleRefresh();
		current().scheduleRefresh();
		current().scheduleRefresh();
	});
	await act(async () => {
		await Bun.sleep(600);
	});
	await settle();

	expect(requests).toEqual(["/api/one-pager"]);
});

test("unmount aborts active stream and clears scheduled refresh", async () => {
	const requests: string[] = [];
	const signals: AbortSignal[] = [];
	globalThis.fetch = async (input, init) => {
		const path = requestPath(input);
		requests.push(path);
		if (path === "/api/one-pager")
			return jsonResponse(onePagerSnapshot("running"));
		if (path === "/api/one-pager/observe") {
			const signal = init?.signal;
			if (signal instanceof AbortSignal) signals.push(signal);
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			});
		}
		throw new Error(`Unexpected request: ${path}`);
	};

	const hook = mountHook(true);
	await settle();
	expect(requests).toEqual(["/api/one-pager", "/api/one-pager/observe"]);
	act(() => current().scheduleRefresh());
	hook.unmount();

	expect(signals).toHaveLength(1);
	expect(signals[0]?.aborted).toBe(true);
	await Bun.sleep(600);
	expect(requests).toEqual(["/api/one-pager", "/api/one-pager/observe"]);
});
