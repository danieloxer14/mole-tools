import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SkillSummary } from "../../../shared/skills";
import { useSkills } from "./use-skills";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = globalThis.fetch;
const roots: Root[] = [];

function response(skills: SkillSummary[]): Response {
	return {
		ok: true,
		json: async () => ({ skills }),
	} as Response;
}

function flushPromises(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, 0);
	return promise;
}

function HookOutput({
	token,
	refreshKey,
}: {
	token: string;
	refreshKey: number;
}) {
	const skills = useSkills(token, refreshKey);
	return <output>{skills.map(({ name }) => name).join(",")}</output>;
}

function mountHook(token: string, refreshKey: number) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(<HookOutput token={token} refreshKey={refreshKey} />));

	return {
		container,
		rerender(nextRefreshKey: number) {
			act(() =>
				root.render(<HookOutput token={token} refreshKey={nextRefreshKey} />),
			);
		},
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
	globalThis.fetch = originalFetch;
});

test("loads skills on mount and refresh, retaining the last list on failure", async () => {
	const firstSkills: SkillSummary[] = [
		{
			name: "review-first",
			activeVersion: 1,
			versions: [1],
			lastUsedAt: null,
		},
	];
	const refreshedSkills: SkillSummary[] = [
		{
			name: "review-refreshed",
			activeVersion: 2,
			versions: [1, 2],
			lastUsedAt: "2026-09-24T12:00:00.000Z",
		},
	];
	const calls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		calls.push(String(input));
		if (calls.length === 1) return response(firstSkills);
		if (calls.length === 2) return response(refreshedSkills);
		throw new Error("network unavailable");
	}) as unknown as typeof fetch;

	const mounted = mountHook("secret", 0);
	await act(async () => flushPromises());
	expect(calls).toEqual(["/api/skills?t=secret"]);
	expect(mounted.container.textContent).toBe("review-first");

	mounted.rerender(1);
	await act(async () => flushPromises());
	expect(calls).toEqual(["/api/skills?t=secret", "/api/skills?t=secret"]);
	expect(mounted.container.textContent).toBe("review-refreshed");

	mounted.rerender(2);
	await act(async () => flushPromises());
	expect(calls).toHaveLength(3);
	expect(mounted.container.textContent).toBe("review-refreshed");
});

test("ignores a response superseded by a refresh", async () => {
	const firstRequest = Promise.withResolvers<Response>();
	const secondRequest = Promise.withResolvers<Response>();
	const requests = [firstRequest, secondRequest];
	let fetchCount = 0;
	globalThis.fetch = (() =>
		requests[fetchCount++].promise) as unknown as typeof fetch;

	const mounted = mountHook("secret", 0);
	expect(fetchCount).toBe(1);

	mounted.rerender(1);
	expect(fetchCount).toBe(2);

	const latestSkills: SkillSummary[] = [
		{
			name: "review-latest",
			activeVersion: 1,
			versions: [1],
			lastUsedAt: null,
		},
	];
	await act(async () => {
		secondRequest.resolve(response(latestSkills));
		await secondRequest.promise;
		await flushPromises();
	});
	expect(mounted.container.textContent).toBe("review-latest");

	const staleSkills: SkillSummary[] = [
		{
			name: "review-stale",
			activeVersion: 1,
			versions: [1],
			lastUsedAt: null,
		},
	];
	await act(async () => {
		firstRequest.resolve(response(staleSkills));
		await firstRequest.promise;
		await flushPromises();
	});
	expect(mounted.container.textContent).toBe("review-latest");
});
