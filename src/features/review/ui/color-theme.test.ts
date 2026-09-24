import { afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
	applyColorTheme,
	bootColorTheme,
	fetchColorTheme,
	saveColorTheme,
	useColorTheme,
} from "./color-theme";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = globalThis.fetch;
const roots: Root[] = [];

function ThemeLabel() {
	return createElement("span", null, useColorTheme());
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
	document.documentElement.className = "";
	globalThis.fetch = originalFetch;
});

test("applies themes and rerenders useColorTheme subscribers", () => {
	act(() => applyColorTheme("light"));
	expect(document.documentElement.classList.contains("dark")).toBe(false);
	act(() => applyColorTheme("default"));
	expect(document.documentElement.classList.contains("dark")).toBe(true);

	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(createElement(ThemeLabel)));
	expect(container.textContent).toBe("default");
	act(() => applyColorTheme("light"));
	expect(container.textContent).toBe("light");
});

test("uses default theme snapshot during server rendering", () => {
	document.documentElement.className = "";
	expect(renderToStaticMarkup(createElement(ThemeLabel))).toContain("default");
});

test("fetches supported theme and falls back for an invalid theme", async () => {
	globalThis.fetch = (async () =>
		jsonResponse({ colorTheme: "light" })) as unknown as typeof fetch;
	expect(await fetchColorTheme("t")).toBe("light");

	globalThis.fetch = (async () =>
		jsonResponse({ colorTheme: "neon" })) as unknown as typeof fetch;
	expect(await fetchColorTheme("t")).toBe("default");
});

test("rejects unsuccessful theme fetches", async () => {
	globalThis.fetch = (async () =>
		new Response("", { status: 401 })) as unknown as typeof fetch;
	await expect(fetchColorTheme("t")).rejects.toThrow("Request failed (401)");
});

test("posts a theme and surfaces persistence errors", async () => {
	let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		request = { input, init };
		return new Response(null, { status: 200 });
	}) as unknown as typeof fetch;
	await saveColorTheme("t", "light");
	expect(request?.init?.method).toBe("POST");
	expect(request?.init?.body).toBe('{"colorTheme":"light"}');

	globalThis.fetch = (async () =>
		jsonResponse({ error: "persist failed" }, 500)) as unknown as typeof fetch;
	await expect(saveColorTheme("t", "light")).rejects.toMatchObject({
		message: "persist failed",
	});
});

test("boots saved theme before render and renders once after failures", async () => {
	const renderedThemes: boolean[] = [];
	const render = () =>
		renderedThemes.push(document.documentElement.classList.contains("dark"));

	document.documentElement.className = "dark";
	globalThis.fetch = (async () =>
		jsonResponse({ colorTheme: "light" })) as unknown as typeof fetch;
	await bootColorTheme("t", render);
	expect(renderedThemes).toEqual([false]);

	document.documentElement.className = "dark";
	renderedThemes.length = 0;
	globalThis.fetch = (async () => {
		throw new TypeError("network");
	}) as unknown as typeof fetch;
	await bootColorTheme("t", render);
	expect(renderedThemes).toEqual([true]);

	document.documentElement.className = "dark";
	renderedThemes.length = 0;
	globalThis.fetch = (async () =>
		jsonResponse({ colorTheme: "neon" })) as unknown as typeof fetch;
	await bootColorTheme("t", render);
	expect(renderedThemes).toEqual([true]);
});
