import { expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "./toggle-group";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Example({
	value = ["inline"],
	onValueChange,
}: {
	value?: string[];
	onValueChange?: (value: string[]) => void;
}) {
	return (
		<SegmentedToggleGroup
			aria-label="Diff layout"
			multiple={false}
			value={value}
			onValueChange={(next) => onValueChange?.(next)}
		>
			<SegmentedToggleGroupItem value="inline" aria-label="Inline">
				<span aria-hidden>≡</span>
			</SegmentedToggleGroupItem>
			<SegmentedToggleGroupItem value="side-by-side" aria-label="Side by side">
				<span aria-hidden>⇆</span>
			</SegmentedToggleGroupItem>
		</SegmentedToggleGroup>
	);
}

test("renders a compact rounded segmented group with pressed semantics", () => {
	const markup = renderToStaticMarkup(<Example />);

	expect(markup).toContain('data-slot="toggle-group"');
	expect(markup).toContain('data-variant="segmented"');
	expect(markup).toContain('data-size="sm"');
	expect(markup).toContain('data-spacing="0"');
	expect(markup).toContain("rounded-3xl");
	expect(markup).toContain("border-border");
	expect(markup).toContain("bg-input/50");
	expect(markup).toContain("min-w-0");
	expect(markup).toContain("max-w-full");
	expect((markup.match(/data-slot="toggle-group-item"/g) ?? []).length).toBe(2);
	expect(markup).toContain("h-7");
	expect(markup).toContain('aria-label="Inline"');
	expect(markup).toContain('aria-label="Side by side"');
	expect(markup).toContain('aria-pressed="true"');
	expect(markup).toContain('aria-pressed="false"');
	expect(markup).toContain("aria-pressed:bg-primary");
});

test("clears the previous option when selecting its sibling", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	let value = ["inline"];
	const changes: string[][] = [];
	const render = () => {
		root.render(
			<Example
				value={value}
				onValueChange={(next) => {
					changes.push(next);
					value = next;
					render();
				}}
			/>,
		);
	};

	try {
		act(render);
		const inline = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Inline"]',
		);
		const sideBySide = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Side by side"]',
		);
		expect(inline?.getAttribute("aria-pressed")).toBe("true");
		expect(sideBySide?.getAttribute("aria-pressed")).toBe("false");
		if (!sideBySide) return;

		act(() => sideBySide.click());
		expect(changes).toEqual([["side-by-side"]]);
		expect(
			container
				.querySelector('button[aria-label="Inline"]')
				?.getAttribute("aria-pressed"),
		).toBe("false");
		expect(
			container
				.querySelector('button[aria-label="Side by side"]')
				?.getAttribute("aria-pressed"),
		).toBe("true");
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("moves keyboard focus across segmented options", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	function ControlledExample() {
		const [value] = useState(["inline"]);
		return <Example value={value} />;
	}

	try {
		act(() => root.render(<ControlledExample />));
		const inline = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Inline"]',
		);
		const sideBySide = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Side by side"]',
		);
		expect(inline).not.toBeNull();
		expect(sideBySide).not.toBeNull();
		if (!inline || !sideBySide) return;

		await act(async () => {
			inline.focus();
			inline.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "ArrowRight",
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});
		expect(document.activeElement).toBe(sideBySide);
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});
