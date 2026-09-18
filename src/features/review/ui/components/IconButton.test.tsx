import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { IconButton } from "./IconButton";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const icon = <span aria-hidden="true">icon</span>;

function parseMarkup(markup: string): HTMLDivElement {
	const container = document.createElement("div");
	container.innerHTML = markup;
	return container;
}

test("renders labelled disabled button", () => {
	const container = parseMarkup(
		renderToStaticMarkup(
			<IconButton label="Approve" disabled>
				{icon}
			</IconButton>,
		),
	);
	const button = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Approve"]',
	);

	expect(button).not.toBeNull();
	expect(button?.getAttribute("title")).toBeNull();
	expect(button?.disabled).toBe(true);
	expect(button?.textContent).toContain("icon");
});

test("renders busy spinner and badge marker", () => {
	const container = parseMarkup(
		renderToStaticMarkup(
			<IconButton label="Refresh" busy badge>
				{icon}
			</IconButton>,
		),
	);
	const button = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Refresh"]',
	);

	expect(button?.getAttribute("aria-busy")).toBe("true");
	expect(button?.querySelector("svg")).not.toBeNull();
	expect(button?.querySelector("[data-badge]")).not.toBeNull();
	expect(button?.textContent).not.toContain("icon");
});

test("renders href actions as external links instead of buttons", () => {
	const container = parseMarkup(
		renderToStaticMarkup(
			<IconButton label="Open" href="https://gitlab.example.test/mr/1">
				{icon}
			</IconButton>,
		),
	);
	const anchor =
		container.querySelector<HTMLAnchorElement>('a[target="_blank"]');

	expect(anchor).not.toBeNull();
	expect(anchor?.getAttribute("aria-label")).toBe("Open");
	expect(anchor?.getAttribute("href")).toBe("https://gitlab.example.test/mr/1");
	expect(anchor?.getAttribute("rel")).toBe("noreferrer");
	expect(container.querySelector("button")).toBeNull();
});

test("shows one custom tooltip on keyboard focus without a native title", async () => {
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);

	try {
		act(() => {
			root.render(
				<IconButton
					label="Refresh merge request"
					tooltip="Refresh merge request"
				>
					{icon}
				</IconButton>,
			);
		});
		const button = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Refresh merge request"]',
		);
		expect(button).not.toBeNull();
		expect(button?.getAttribute("title")).toBeNull();

		await act(async () => {
			button?.focus();
			await Bun.sleep(0);
		});

		const tooltips = document.body.querySelectorAll(
			'[data-slot="tooltip-content"]',
		);
		expect(tooltips).toHaveLength(1);
		expect(tooltips[0]?.textContent).toBe("Refresh merge request");
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});
