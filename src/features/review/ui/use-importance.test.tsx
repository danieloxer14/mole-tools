import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ImportanceFile, ImportanceSnapshot } from "../importance";
import { type UseImportanceResult, useImportance } from "./use-importance";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = globalThis.fetch;
const roots: Root[] = [];
const revisionKey = "head-one:base-one";
const fileOne: ImportanceFile = {
	path: "src/one.ts",
	spans: [{ side: "new", startLine: 1, endLine: 2, score: 4 }],
};
const fileTwo: ImportanceFile = {
	path: "src/two.ts",
	spans: [{ side: "new", startLine: 3, endLine: 3, score: 5 }],
};
const pending: ImportanceSnapshot = {
	revisionKey,
	status: "pending",
	error: null,
	files: [],
};

function ready(files: ImportanceFile[]): ImportanceSnapshot {
	return { revisionKey, status: "ready", error: null, files };
}

let latest: UseImportanceResult | null = null;

function HookProbe({
	token,
	enabled,
	revisionKey,
}: {
	token: string;
	enabled: boolean;
	revisionKey: string;
}) {
	latest = useImportance(token, enabled, revisionKey);
	return null;
}

function current(): UseImportanceResult {
	if (!latest) throw new Error("Importance hook was not rendered");
	return latest;
}

function mountHook(
	enabled: boolean,
	revisionKey: string,
): { rerender: (nextEnabled: boolean, nextRevisionKey: string) => void } {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<HookProbe
				token="importance-test-token"
				enabled={enabled}
				revisionKey={revisionKey}
			/>,
		),
	);

	return {
		rerender(nextEnabled, nextRevisionKey) {
			act(() =>
				root.render(
					<HookProbe
						token="importance-test-token"
						enabled={nextEnabled}
						revisionKey={nextRevisionKey}
					/>,
				),
			);
		},
	};
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function statusStream(data: Record<string, unknown>): Response {
	return new Response(
		`event: status\ndata: ${JSON.stringify({ revisionKey, ...data })}\n\n`,
		{ headers: { "content-type": "text/event-stream" } },
	);
}

async function settle(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, 0);
	await act(async () => {
		await promise;
	});
}

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
	globalThis.fetch = originalFetch;
	latest = null;
});

test("does not request importance when disabled or revision key is empty", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		requests.push(String(input));
		return jsonResponse(pending);
	};
	const hook = mountHook(false, "revision-one");
	await settle();
	expect(current()).toMatchObject({ status: null, error: null, files: [] });
	hook.rerender(true, "");
	await settle();
	expect(current()).toMatchObject({ status: null, error: null, files: [] });
	expect(requests).toEqual([]);
});

test("observes pending importance, refetches ready files, and ignores retry when ready", async () => {
	const requests: { path: string; method: string | undefined }[] = [];
	const observeResponse = Promise.withResolvers<Response>();
	let getCount = 0;
	globalThis.fetch = async (input, init) => {
		const path = new URL(String(input), "http://localhost").pathname;
		requests.push({ path, method: init?.method });
		if (path === "/api/importance") {
			getCount += 1;
			return jsonResponse(getCount === 1 ? pending : ready([fileOne]));
		}
		if (path === "/api/importance/observe") return observeResponse.promise;
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, "head-one:base-one");
	await settle();
	expect(current().status).toBe("running");
	expect(requests.map(({ path }) => path)).toEqual([
		"/api/importance",
		"/api/importance/observe",
	]);
	observeResponse.resolve(statusStream({ status: "ready", files: [fileOne] }));
	await settle();
	expect(requests.map(({ path }) => path)).toEqual([
		"/api/importance",
		"/api/importance/observe",
		"/api/importance",
	]);
	expect(requests[1]?.method).toBe("POST");
	expect(current()).toMatchObject({
		status: "ready",
		error: null,
		files: [fileOne],
	});
	act(() => current().retry());
	await settle();
	expect(requests).toHaveLength(3);
});

test("fetches a fresh snapshot when revision key changes", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		requests.push(String(input));
		return jsonResponse({
			revisionKey: requests.length === 1 ? revisionKey : "head-two:base-one",
			status: "ready",
			error: null,
			files: [requests.length === 1 ? fileOne : fileTwo],
		});
	};
	const hook = mountHook(true, revisionKey);
	await settle();
	expect(current().files).toEqual([fileOne]);
	hook.rerender(true, "head-two:base-one");
	await settle();
	expect(requests).toHaveLength(2);
	expect(current().files).toEqual([fileTwo]);
});
test("rejects importance GET snapshots for a different revision", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		requests.push(String(input));
		return jsonResponse({
			revisionKey: "newer-head:base-one",
			status: "ready",
			error: null,
			files: [fileOne],
		});
	};

	mountHook(true, revisionKey);
	await settle();

	expect(requests).toHaveLength(1);
	expect(current()).toMatchObject({
		status: "failed",
		error:
			"Importance results are for a different revision. Sync or reload the review.",
		files: [],
		canRetry: false,
	});
	act(() => current().retry());
	await settle();
	expect(requests).toHaveLength(1);
});

test("rejects stale files in importance SSE status frames without refetching", async () => {
	const requests: string[] = [];
	const signals: AbortSignal[] = [];
	globalThis.fetch = async (input, init) => {
		if (init?.signal) signals.push(init.signal);
		const path = new URL(String(input), "http://localhost").pathname;
		requests.push(path);
		if (path === "/api/importance") return jsonResponse(pending);
		if (path === "/api/importance/observe")
			return statusStream({
				revisionKey: "newer-head:base-one",
				status: "ready",
				files: [fileOne],
			});
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, revisionKey);
	await settle();

	expect(signals[1]?.aborted).toBe(true);
	expect(current()).toMatchObject({
		status: "failed",
		error:
			"Importance results are for a different revision. Sync or reload the review.",
		files: [],
		canRetry: false,
	});
});

test("preserves unkeyed server errors and allows retry", async () => {
	const requests: string[] = [];
	let retryUrl: string | null = null;
	let getCount = 0;
	globalThis.fetch = async (input) => {
		const path = new URL(String(input), "http://localhost").pathname;
		requests.push(path);
		if (path === "/api/importance") {
			getCount += 1;
			return jsonResponse(getCount <= 2 ? pending : ready([fileOne]));
		}
		if (path === "/api/importance/observe")
			return new Response(
				`event: error\ndata: ${JSON.stringify({ message: "Review state is unavailable" })}\n\nevent: done\ndata: {}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		if (path === "/api/importance/retry") {
			retryUrl = String(input);
			return statusStream({ status: "ready", error: null, files: [fileOne] });
		}
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, revisionKey);
	await settle();

	expect(current()).toMatchObject({
		status: "failed",
		error: "Review state is unavailable",
		files: [],
		canRetry: true,
	});
	act(() => current().retry());
	await settle();

	expect(requests).toEqual([
		"/api/importance",
		"/api/importance/observe",
		"/api/importance",
		"/api/importance/retry",
		"/api/importance",
	]);
	expect(
		new URL(retryUrl ?? "", "http://localhost").searchParams.get("revisionKey"),
	).toBe(revisionKey);
	expect(current()).toMatchObject({
		status: "ready",
		error: null,
		files: [fileOne],
		canRetry: false,
	});
});

test("keeps ready stream files when the snapshot refetch fails", async () => {
	let getCount = 0;
	globalThis.fetch = async (input) => {
		const path = new URL(String(input), "http://localhost").pathname;
		if (path === "/api/importance") {
			getCount += 1;
			return getCount === 1
				? jsonResponse(pending)
				: jsonResponse({ error: "Snapshot unavailable" }, 503);
		}
		if (path === "/api/importance/observe")
			return statusStream({ status: "ready", files: [fileOne] });
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, revisionKey);
	await settle();

	expect(current()).toMatchObject({
		status: "ready",
		error: null,
		files: [fileOne],
		canRetry: false,
	});
});

test("keeps streamed failure when importance snapshot refetch fails", async () => {
	let getCount = 0;
	globalThis.fetch = async (input) => {
		const path = new URL(String(input), "http://localhost").pathname;
		if (path === "/api/importance") {
			getCount += 1;
			return getCount === 1
				? jsonResponse(pending)
				: jsonResponse({ error: "Snapshot unavailable" }, 503);
		}
		if (path === "/api/importance/observe") {
			return new Response(
				'event: error\ndata: {"message":"Importance agent failed"}\n\nevent: done\ndata: {"status":"failed"}\n\n',
				{ headers: { "content-type": "text/event-stream" } },
			);
		}
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, revisionKey);
	await settle();

	expect(current()).toMatchObject({
		status: "failed",
		error: "Importance agent failed",
		canRetry: true,
	});
	expect(getCount).toBe(2);
});

test("turns an unfinished stream and pending snapshot into retryable failure", async () => {
	let getCount = 0;
	globalThis.fetch = async (input) => {
		const path = new URL(String(input), "http://localhost").pathname;
		if (path === "/api/importance") {
			getCount += 1;
			return jsonResponse(pending);
		}
		if (path === "/api/importance/observe") return new Response("");
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, revisionKey);
	await settle();

	expect(current()).toMatchObject({
		status: "failed",
		error: "Importance stream ended before a result",
		files: [],
		canRetry: true,
	});
	expect(getCount).toBe(2);
});

test("keeps terminal ready stream files when the snapshot remains pending", async () => {
	let getCount = 0;
	globalThis.fetch = async (input) => {
		const path = new URL(String(input), "http://localhost").pathname;
		if (path === "/api/importance") {
			getCount += 1;
			return jsonResponse(pending);
		}
		if (path === "/api/importance/observe")
			return statusStream({ status: "ready", files: [fileOne] });
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, revisionKey);
	await settle();

	expect(current()).toMatchObject({
		status: "ready",
		error: null,
		files: [fileOne],
		canRetry: false,
	});
	expect(getCount).toBe(2);
});

test("retry retires an in-flight observation refetch", async () => {
	const requests: string[] = [];
	const signals: AbortSignal[] = [];
	const staleRefetch = Promise.withResolvers<Response>();
	const retryResponse = Promise.withResolvers<Response>();
	let getCount = 0;
	globalThis.fetch = async (input, init) => {
		const path = new URL(String(input), "http://localhost").pathname;
		if (init?.signal) signals.push(init.signal);
		requests.push(path);
		if (path === "/api/importance") {
			getCount += 1;
			if (getCount === 1) return jsonResponse(pending);
			if (getCount === 2) return staleRefetch.promise;
			return jsonResponse(ready([fileOne]));
		}
		if (path === "/api/importance/observe")
			return new Response(
				`event: error\ndata: ${JSON.stringify({ message: "Run failed" })}\n\nevent: done\ndata: {}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		if (path === "/api/importance/retry") return retryResponse.promise;
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, revisionKey);
	await settle();
	expect(current()).toMatchObject({ status: "failed", canRetry: true });

	act(() => current().retry());
	await settle();
	expect(current().status).toBe("running");
	expect(signals[0]?.aborted).toBe(true);

	staleRefetch.resolve(jsonResponse(pending));
	await settle();
	expect(current().status).toBe("running");

	retryResponse.resolve(
		statusStream({ status: "ready", error: null, files: [fileOne] }),
	);
	await settle();
	expect(current()).toMatchObject({
		status: "ready",
		error: null,
		files: [fileOne],
		canRetry: false,
	});
	expect(requests).toEqual([
		"/api/importance",
		"/api/importance/observe",
		"/api/importance",
		"/api/importance/retry",
		"/api/importance",
	]);
});

test("retries after an observation stream failure then refetches", async () => {
	const requests: { path: string; method: string | undefined }[] = [];
	let getCount = 0;
	globalThis.fetch = async (input, init) => {
		const path = new URL(String(input), "http://localhost").pathname;
		requests.push({ path, method: init?.method });
		if (path === "/api/importance") {
			getCount += 1;
			return jsonResponse(getCount === 1 ? pending : ready([fileTwo]));
		}
		if (path === "/api/importance/observe") return jsonResponse({}, 503);
		if (path === "/api/importance/retry")
			return statusStream({ status: "ready", error: null, files: [fileTwo] });
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, "head-one:base-one");
	await settle();
	expect(current()).toMatchObject({
		status: "failed",
		error: "Importance observe request failed (503)",
		files: [],
	});
	act(() => current().retry());
	await settle();
	expect(requests.map(({ path }) => path)).toEqual([
		"/api/importance",
		"/api/importance/observe",
		"/api/importance/retry",
		"/api/importance",
	]);
	expect(requests[2]?.method).toBe("POST");
	expect(current()).toMatchObject({
		status: "ready",
		error: null,
		files: [fileTwo],
	});
});

test("reports importance GET failures with their server message", async () => {
	globalThis.fetch = async () =>
		jsonResponse({ error: "Importance unavailable" }, 503);
	mountHook(true, "head-one:base-one");
	await settle();
	expect(current()).toMatchObject({
		status: "failed",
		error: "Importance unavailable",
		files: [],
	});
});
test("preserves stream error when refetch is still pending", async () => {
	const requests: string[] = [];
	let getCount = 0;
	globalThis.fetch = async (input) => {
		const path = new URL(String(input), "http://localhost").pathname;
		requests.push(path);
		if (path === "/api/importance") {
			getCount += 1;
			if (getCount < 3) return jsonResponse(pending);
			return jsonResponse(ready([fileOne]));
		}
		if (path === "/api/importance/observe")
			return new Response(
				`event: error\ndata: ${JSON.stringify({ message: "Importance agent is unavailable", revisionKey })}\n\nevent: done\ndata: {"status":"failed"}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		if (path === "/api/importance/retry")
			return statusStream({ status: "ready", error: null, files: [fileOne] });
		throw new Error(`Unexpected request: ${path}`);
	};

	mountHook(true, "head-one:base-one");
	await settle();
	expect(requests).toEqual([
		"/api/importance",
		"/api/importance/observe",
		"/api/importance",
	]);
	expect(current()).toMatchObject({
		status: "failed",
		error: "Importance agent is unavailable",
		files: [],
	});

	act(() => current().retry());
	await settle();
	expect(requests.slice(3)).toEqual([
		"/api/importance/retry",
		"/api/importance",
	]);
	expect(current()).toMatchObject({
		status: "ready",
		error: null,
		files: [fileOne],
	});
});
