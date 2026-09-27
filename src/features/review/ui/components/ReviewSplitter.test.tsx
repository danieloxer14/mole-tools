import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "bun:test";
import { ReviewSplitter } from "./ReviewSplitter";

const roots: Array<{ container: HTMLDivElement; root: Root }> = [];

afterEach(() => {
	for (const { container, root } of roots.splice(0)) {
		act(() => root.unmount());
		container.remove();
	}
});

test("splitter can receive keyboard focus and forwards key events", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push({ container, root });
	const keys: string[] = [];

	act(() => {
		root.render(
			createElement(ReviewSplitter, {
				"aria-label": "Resize left pane",
				role: "separator",
				onKeyDown: (event) => keys.push(event.key),
			}),
		);
	});

	const splitter = container.querySelector("hr");
	expect(splitter).not.toBeNull();
	expect(splitter?.tabIndex).toBe(0);
	splitter?.focus();
	expect(document.activeElement).toBe(splitter);
	const event = document.createEvent("Event");
	event.initEvent("keydown", true, true);
	Object.defineProperty(event, "key", { value: "ArrowRight" });
	act(() => splitter?.dispatchEvent(event));
	expect(keys).toEqual(["ArrowRight"]);
});
