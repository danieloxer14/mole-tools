import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { withMockFetch } from "../../../../test/fakes/mockFetch";
import type { ImportanceFile, ImportanceSnapshot } from "../importance";
import { type UseImportanceResult, useImportance } from "./use-importance";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const originalFetch = globalThis.fetch;
const roots: Root[] = [];
const revisionKey = "head-one:base-one";
const fileOne: ImportanceFile = {
	path: "src/one.ts",
	spans: [
		{
			side: "new",
			startLine: 1,
			endLine: 2,
			score: 4,
			reason: "The validation path affects request handling.",
		},
	],
};
const fileTwo: ImportanceFile = {
	path: "src/two.ts",
	spans: [
		{
			side: "new",
			startLine: 3,
			endLine: 3,
			score: 5,
			reason: "This changes request authorization.",
		},
	],
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
	revisionKey: currentRevision,
}: {
	token: string;
	revisionKey: string;
}) {
	latest = useImportance(token, currentRevision);
	return null;
}

function current(): UseImportanceResult {
	if (latest === null) throw new Error("Importance hook was not rendered");
	return latest;
}

function mountHook(currentRevision: string): {
	rerender: (revisionKey: string) => void;
} {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const render = (revision: string) =>
		root.render(
			<HookProbe token="importance-test-token" revisionKey={revision} />,
		);
	act(() => render(currentRevision));
	return {
		rerender(revision) {
			act(() => render(revision));
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
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
	globalThis.fetch = originalFetch;
	latest = null;
});

test("waits for revision readiness, then observes without feature flags", async () => {
	const requests: string[] = [];
	let getCount = 0;
	globalThis.fetch = withMockFetch(async (input, init) => {
		const path = new URL(String(input), "http://localhost").pathname;
		requests.push(`${init?.method ?? "GET"} ${path}`);
		if (path === "/api/importance") {
			getCount++;
			return jsonResponse(getCount === 1 ? pending : ready([fileOne]));
		}
		if (path === "/api/importance/observe") {
			return statusStream({ status: "ready", files: [fileOne] });
		}
		throw new Error(`Unexpected request: ${path}`);
	});

	const hook = mountHook("");
	await settle();
	expect(requests).toEqual([]);
	hook.rerender(revisionKey);
	await settle();
	expect(requests).toEqual([
		"GET /api/importance",
		"POST /api/importance/observe",
		"GET /api/importance",
	]);
	expect(current()).toMatchObject({ status: "ready", files: [fileOne] });
});

test("preserves failure details and retries failed observation", async () => {
	const requests: string[] = [];
	let getCount = 0;
	globalThis.fetch = withMockFetch(async (input, init) => {
		const path = new URL(String(input), "http://localhost").pathname;
		requests.push(`${init?.method ?? "GET"} ${String(input)}`);
		if (path === "/api/importance") {
			getCount++;
			return jsonResponse(getCount <= 2 ? pending : ready([fileTwo]));
		}
		if (path === "/api/importance/observe") {
			return new Response(
				`event: error\ndata: {"message":"Review state is unavailable"}\n\nevent: done\ndata: {}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		}
		if (path === "/api/importance/retry") {
			return statusStream({ status: "ready", error: null, files: [fileTwo] });
		}
		throw new Error(`Unexpected request: ${path}`);
	});

	mountHook(revisionKey);
	await settle();
	expect(current()).toMatchObject({
		status: "failed",
		error: "Review state is unavailable",
		canRetry: true,
	});
	act(() => current().retry());
	await settle();
	expect(
		requests.some((request) =>
			request.includes("/api/importance/retry?revisionKey=head-one%3Abase-one"),
		),
	).toBe(true);
	expect(current()).toMatchObject({ status: "ready", files: [fileTwo] });
});

test("aborts stale revision work and rejects mismatched stream results", async () => {
	const firstGet = Promise.withResolvers<Response>();
	const signals: AbortSignal[] = [];
	let getCount = 0;
	globalThis.fetch = withMockFetch(async (input, init) => {
		if (init?.signal) signals.push(init.signal);
		const path = new URL(String(input), "http://localhost").pathname;
		if (path !== "/api/importance")
			throw new Error(`Unexpected request: ${path}`);
		getCount++;
		if (getCount === 1) return firstGet.promise;
		return jsonResponse({
			revisionKey: "head-two:base-one",
			status: "ready",
			error: null,
			files: [fileTwo],
		});
	});
	const hook = mountHook(revisionKey);
	await settle();
	hook.rerender("head-two:base-one");
	await settle();
	expect(signals[0]?.aborted).toBe(true);
	expect(current()).toMatchObject({ status: "ready", files: [fileTwo] });

	const mismatchSignals: AbortSignal[] = [];
	globalThis.fetch = withMockFetch(async (input, init) => {
		if (init?.signal) mismatchSignals.push(init.signal);
		const path = new URL(String(input), "http://localhost").pathname;
		if (path === "/api/importance") return jsonResponse(pending);
		if (path === "/api/importance/observe") {
			const mismatchFrame = JSON.stringify({
				revisionKey: "stale-head:base-one",
				status: "ready",
				files: [fileOne],
			});
			return new Response(`event: status\ndata: ${mismatchFrame}\n\n`, {
				headers: { "content-type": "text/event-stream" },
			});
		}
		throw new Error(`Unexpected request: ${path}`);
	});
	mountHook(revisionKey);
	await settle();
	expect(mismatchSignals[1]?.aborted).toBe(true);
	expect(current()).toMatchObject({
		status: "failed",
		canRetry: false,
		files: [],
	});
});

test("updates ready files after a contest response", async () => {
	const originalSpan = fileOne.spans[0];
	if (!originalSpan) throw new Error("Test fixture span is missing");
	const changedFile = {
		...fileOne,
		spans: [{ ...originalSpan, score: 2 as const }],
	};
	globalThis.fetch = withMockFetch(async (input) => {
		const path = new URL(String(input), "http://localhost").pathname;
		if (path === "/api/importance") return jsonResponse(ready([fileOne]));
		if (path === "/api/importance/contest") {
			return jsonResponse({
				snapshot: ready([changedFile]),
				report: "Contest report",
			});
		}
		throw new Error(`Unexpected request: ${path}`);
	});
	mountHook(revisionKey);
	await settle();
	let report = "";
	await act(async () => {
		report = await current().contest({
			path: fileOne.path,
			fileIndex: 0,
			spanIndex: 0,
			expected: originalSpan,
			score: 2,
			reason: "Updated behavior reason.",
		});
	});
	expect(report).toBe("Contest report");
	expect(current()).toMatchObject({ status: "ready", files: [changedFile] });
});
