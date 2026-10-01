import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { OnePagerView } from "../use-one-pager";
import { OnePagerPanel } from "./OnePagerPanel";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.replaceChildren();
});

function mountPanel(view: OnePagerView, onCreate = () => {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<OnePagerPanel view={view} onCreate={onCreate} onTagBlock={() => {}} />,
		),
	);
	return container;
}

test("shows centered create state and calls onCreate", () => {
	let createCalls = 0;
	const container = mountPanel(
		{ status: "idle", markdown: null, error: null },
		() => createCalls++,
	);
	const wrapper = container.firstElementChild;

	expect(wrapper?.className).toBe(
		"flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center",
	);
	expect(container.textContent).toContain(
		"Click here to create a one-page summary of this MR",
	);
	const button = container.querySelector("button");
	expect(button?.textContent).toBe("Create");
	act(() => button?.click());
	expect(createCalls).toBe(1);
});

test("shows idle error before create prompt and button", () => {
	const container = mountPanel({
		status: "idle",
		markdown: null,
		error: "Generation failed",
	});
	const alert = container.querySelector('[role="alert"]');
	const prompt = container.querySelector("p");
	const button = container.querySelector("button");

	expect(alert?.textContent).toBe("Generation failed");
	expect(alert?.className).toContain("text-destructive");
	expect(
		Boolean(
			alert &&
				prompt &&
				button &&
				alert.compareDocumentPosition(prompt) &
					Node.DOCUMENT_POSITION_FOLLOWING,
		),
	).toBe(true);
	expect(
		Boolean(
			prompt &&
				button &&
				prompt.compareDocumentPosition(button) &
					Node.DOCUMENT_POSITION_FOLLOWING,
		),
	).toBe(true);
});

test("shows loading state", () => {
	const container = mountPanel({
		status: "loading",
		markdown: null,
		error: null,
	});

	expect(container.textContent).toContain("Loading one pager");
	expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull();
	expect(container.querySelector("button")).toBeNull();
});

test("shows accessible running state and observation error without a button", () => {
	const container = mountPanel({
		status: "running",
		markdown: null,
		error: "Observe connection dropped; reconnecting.",
	});
	const status = container.querySelector('[role="status"]');

	expect(status?.getAttribute("aria-live")).toBe("polite");
	expect(status?.querySelector('[data-slot="spinner"]')).not.toBeNull();
	expect(container.textContent).toContain("Creating your one pager");
	expect(container.textContent).toContain(
		"Observe connection dropped; reconnecting.",
	);
	expect(container.querySelector('[role="alert"]')).not.toBeNull();
	expect(container.querySelector("button")).toBeNull();
});

test("renders ready markdown and displays regenerate error before document", () => {
	const container = mountPanel({
		status: "ready",
		markdown: "# Summary title",
		error: "Regeneration failed",
	});
	const alert = container.querySelector('[role="alert"]');
	const heading = container.querySelector("h1");

	expect(alert?.textContent).toBe("Regeneration failed");
	expect(heading?.textContent).toBe("Summary title");
	expect(
		Boolean(
			alert &&
				heading &&
				alert.compareDocumentPosition(heading) &
					Node.DOCUMENT_POSITION_FOLLOWING,
		),
	).toBe(true);
	expect(
		[...container.querySelectorAll("button")].some((button) =>
			button.textContent?.includes("Create"),
		),
	).toBe(false);
});
