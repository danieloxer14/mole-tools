import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FeatureFlagView } from "../../../../shared/feature-flags";
import { resetFeatureFlagsForTests } from "../feature-flags";
import { FeaturesSettings } from "./FeaturesSettings";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const originalFetch = globalThis.fetch;
const roots: Root[] = [];
const flag: FeatureFlagView = {
	id: "layer-importance",
	label: "File important",
	description: "Score each changed line span 1–5.",
	enabled: false,
};

function response(value: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => value,
	} as Response;
}

async function flushPromises(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(): HTMLElement {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(<FeaturesSettings token="secret" />));
	return container;
}

beforeEach(() => resetFeatureFlagsForTests());

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
	globalThis.fetch = originalFetch;
	resetFeatureFlagsForTests();
});

test("lists feature metadata and posts checkbox state", async () => {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		const enabled = init?.method === "POST";
		return response({ flags: [{ ...flag, enabled }] });
	}) as typeof fetch;
	const container = mount();
	await act(async () => flushPromises());

	const checkbox =
		container.querySelector<HTMLButtonElement>('[role="checkbox"]');
	expect(container.textContent).toContain("File important");
	expect(container.textContent).toContain(flag.description);
	expect(checkbox?.getAttribute("aria-checked")).toBe("false");
	await act(async () => checkbox?.click());
	await act(async () => flushPromises());

	expect(calls[1]?.url).toBe("/api/features?t=secret");
	expect(calls[1]?.init?.method).toBe("POST");
	expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
		id: flag.id,
		enabled: true,
	});
	expect(
		container.querySelector('[role="checkbox"]')?.getAttribute("aria-checked"),
	).toBe("true");
});

test("restores checkbox and shows inline alert when a toggle fails", async () => {
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
		init?.method === "POST"
			? response({ error: "disk full" }, 500)
			: response({ flags: [flag] })) as typeof fetch;
	const container = mount();
	await act(async () => flushPromises());
	const checkbox =
		container.querySelector<HTMLButtonElement>('[role="checkbox"]');

	await act(async () => checkbox?.click());
	await act(async () => flushPromises());

	expect(
		container.querySelector('[role="checkbox"]')?.getAttribute("aria-checked"),
	).toBe("false");
	expect(container.querySelector('[role="alert"]')?.textContent).toBe(
		"disk full",
	);
});
