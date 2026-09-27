import { afterEach, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clampColumnWidth, type ReviewColumn } from "./column-resize";
import { useSplitterResize } from "./use-splitter-resize";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface ColumnWidths {
	left: number;
	right: number;
}

const initialWidths: ColumnWidths = { left: 300, right: 320 };
const minimumWidths: ColumnWidths = { left: 260, right: 270 };
const availableWidths: ColumnWidths = { left: 700, right: 680 };
// These capture stubs track ownership only; dispatch does not simulate native retargeting.
const captures = new WeakMap<HTMLHRElement, Set<number>>();
const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.replaceChildren();
});

function installPointerCapture(owner: HTMLHRElement | null): void {
	if (!owner) return;
	const activePointers = new Set<number>();
	captures.set(owner, activePointers);
	owner.setPointerCapture = (pointerId) => activePointers.add(pointerId);
	owner.hasPointerCapture = (pointerId) => activePointers.has(pointerId);
	owner.releasePointerCapture = (pointerId) => {
		if (!activePointers.delete(pointerId)) {
			throw new Error(`Pointer ${pointerId} is not captured by this splitter`);
		}
	};
}

function SplitterHarness() {
	const [widths, setWidths] = useState(initialWidths);
	const resizeColumn = (column: ReviewColumn, requestedWidth: number) => {
		setWidths((current) => ({
			...current,
			[column]: clampColumnWidth(
				requestedWidth,
				minimumWidths[column],
				availableWidths[column],
			),
		}));
	};
	const splitter = useSplitterResize(resizeColumn);

	return (
		<>
			<hr
				aria-label="left splitter"
				aria-valuenow={widths.left}
				data-column="left"
				onPointerCancel={splitter.onPointerEnd}
				onPointerDown={(event) =>
					splitter.onPointerDown(event, "left", widths.left)
				}
				onPointerMove={splitter.onPointerMove}
				onPointerUp={splitter.onPointerEnd}
				onLostPointerCapture={splitter.onLostPointerCapture}
				ref={installPointerCapture}
			/>
			<hr
				aria-label="right splitter"
				aria-valuenow={widths.right}
				data-column="right"
				onPointerCancel={splitter.onPointerEnd}
				onPointerDown={(event) =>
					splitter.onPointerDown(event, "right", widths.right)
				}
				onPointerMove={splitter.onPointerMove}
				onPointerUp={splitter.onPointerEnd}
				onLostPointerCapture={splitter.onLostPointerCapture}
				ref={installPointerCapture}
			/>
		</>
	);
}

function mountHarness(): HTMLDivElement {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(<SplitterHarness />));
	return container;
}

function splitter(
	container: HTMLDivElement,
	column: ReviewColumn,
): HTMLHRElement {
	const element = container.querySelector(`[data-column="${column}"]`);
	if (!element) throw new Error(`Missing ${column} splitter`);
	return element as HTMLHRElement;
}

function width(container: HTMLDivElement, column: ReviewColumn): number {
	const value = splitter(container, column).getAttribute("aria-valuenow");
	if (value === null) throw new Error(`Missing ${column} width`);
	return Number(value);
}

function hasCapture(owner: HTMLHRElement, pointerId: number): boolean {
	return captures.get(owner)?.has(pointerId) ?? false;
}

function loseCapture(owner: HTMLHRElement, pointerId: number): void {
	const activePointers = captures.get(owner);
	if (!activePointers?.delete(pointerId)) {
		throw new Error(`Pointer ${pointerId} is not captured by this splitter`);
	}
}

function dispatchPointer(
	target: HTMLHRElement,
	type:
		| "pointerdown"
		| "pointermove"
		| "pointerup"
		| "pointercancel"
		| "lostpointercapture",
	options: {
		pointerId: number;
		clientX: number;
		button?: number;
		buttons?: number;
	},
): void {
	const event = document.createEvent("Event");
	event.initEvent(type, true, true);
	Object.defineProperties(event, {
		pointerId: { value: options.pointerId },
		button: { value: options.button ?? 0 },
		buttons: { value: options.buttons ?? 1 },
		clientX: { value: options.clientX },
	});
	act(() => target.dispatchEvent(event));
}

test("resizes both columns in opposite directions and ignores unrelated pointers", () => {
	const container = mountHarness();
	const left = splitter(container, "left");
	const right = splitter(container, "right");

	dispatchPointer(left, "pointerdown", {
		pointerId: 1,
		button: 2,
		buttons: 2,
		clientX: 100,
	});
	dispatchPointer(left, "pointermove", {
		pointerId: 1,
		buttons: 1,
		clientX: 150,
	});
	expect(width(container, "left")).toBe(300);

	dispatchPointer(left, "pointerdown", {
		pointerId: 2,
		clientX: 100,
	});
	dispatchPointer(left, "pointermove", {
		pointerId: 3,
		buttons: 1,
		clientX: 900,
	});
	dispatchPointer(right, "pointerdown", {
		pointerId: 3,
		clientX: 100,
	});
	dispatchPointer(right, "pointerup", {
		pointerId: 3,
		buttons: 0,
		clientX: 100,
	});
	dispatchPointer(left, "lostpointercapture", {
		pointerId: 3,
		buttons: 0,
		clientX: 100,
	});
	expect(width(container, "left")).toBe(300);
	expect(width(container, "right")).toBe(320);
	expect(hasCapture(left, 2)).toBe(true);
	expect(hasCapture(right, 3)).toBe(false);

	// A far-away coordinate exercises the active session's delta and clamp.
	dispatchPointer(left, "pointermove", {
		pointerId: 2,
		buttons: 1,
		clientX: 150,
	});
	expect(width(container, "left")).toBe(350);
	dispatchPointer(left, "pointermove", {
		pointerId: 2,
		buttons: 1,
		clientX: 10_000,
	});
	expect(width(container, "left")).toBe(700);
	dispatchPointer(left, "pointermove", {
		pointerId: 2,
		buttons: 1,
		clientX: -10_000,
	});
	expect(width(container, "left")).toBe(260);

	// End event may arrive on another splitter; capture still releases on owner.
	dispatchPointer(right, "pointerup", {
		pointerId: 2,
		buttons: 0,
		clientX: 200,
	});
	expect(hasCapture(left, 2)).toBe(false);
	dispatchPointer(left, "pointermove", {
		pointerId: 2,
		buttons: 0,
		clientX: 500,
	});
	expect(width(container, "left")).toBe(260);

	dispatchPointer(right, "pointerdown", {
		pointerId: 4,
		clientX: 100,
	});
	dispatchPointer(right, "pointermove", {
		pointerId: 4,
		buttons: 1,
		clientX: 50,
	});
	expect(width(container, "right")).toBe(370);
	dispatchPointer(right, "pointermove", {
		pointerId: 4,
		buttons: 1,
		clientX: -10_000,
	});
	expect(width(container, "right")).toBe(680);
	dispatchPointer(right, "pointermove", {
		pointerId: 4,
		buttons: 1,
		clientX: 10_000,
	});
	expect(width(container, "right")).toBe(270);
	dispatchPointer(right, "pointerup", {
		pointerId: 4,
		buttons: 0,
		clientX: 10_000,
	});
	expect(hasCapture(right, 4)).toBe(false);
});

test("pointerup and pointercancel end matching drags without later hover resizing", () => {
	const container = mountHarness();
	const left = splitter(container, "left");
	const right = splitter(container, "right");

	dispatchPointer(left, "pointerdown", { pointerId: 11, clientX: 100 });
	dispatchPointer(left, "pointermove", {
		pointerId: 11,
		buttons: 1,
		clientX: 120,
	});
	expect(width(container, "left")).toBe(320);
	dispatchPointer(right, "pointerup", {
		pointerId: 11,
		buttons: 0,
		clientX: 120,
	});
	expect(hasCapture(left, 11)).toBe(false);
	dispatchPointer(left, "pointermove", {
		pointerId: 11,
		buttons: 0,
		clientX: 500,
	});
	expect(width(container, "left")).toBe(320);

	dispatchPointer(right, "pointerdown", { pointerId: 12, clientX: 100 });
	dispatchPointer(right, "pointermove", {
		pointerId: 12,
		buttons: 1,
		clientX: 110,
	});
	expect(width(container, "right")).toBe(310);
	dispatchPointer(right, "pointercancel", {
		pointerId: 12,
		buttons: 0,
		clientX: 110,
	});
	expect(hasCapture(right, 12)).toBe(false);
	dispatchPointer(right, "pointermove", {
		pointerId: 12,
		buttons: 0,
		clientX: 500,
	});
	expect(width(container, "right")).toBe(310);
});

test("ends on first button-up move and permits a fresh same-pointer press", () => {
	const container = mountHarness();
	const left = splitter(container, "left");

	dispatchPointer(left, "pointerdown", { pointerId: 21, clientX: 100 });
	dispatchPointer(left, "pointermove", {
		pointerId: 21,
		buttons: 0,
		clientX: 900,
	});
	expect(width(container, "left")).toBe(300);
	expect(hasCapture(left, 21)).toBe(false);

	// No hover event intervenes before the new primary press with same ID.
	dispatchPointer(left, "pointerdown", { pointerId: 21, clientX: 200 });
	dispatchPointer(left, "pointermove", {
		pointerId: 21,
		buttons: 1,
		clientX: 225,
	});
	expect(width(container, "left")).toBe(325);
	dispatchPointer(left, "pointerup", {
		pointerId: 21,
		buttons: 0,
		clientX: 225,
	});
	expect(hasCapture(left, 21)).toBe(false);
});

test("ends on capture loss and ignores delayed loss from old or other owners", () => {
	const container = mountHarness();
	const left = splitter(container, "left");
	const right = splitter(container, "right");

	dispatchPointer(left, "pointerdown", { pointerId: 31, clientX: 100 });
	dispatchPointer(left, "pointermove", {
		pointerId: 31,
		buttons: 1,
		clientX: 120,
	});
	expect(width(container, "left")).toBe(320);
	loseCapture(left, 31);
	dispatchPointer(left, "lostpointercapture", {
		pointerId: 31,
		buttons: 0,
		clientX: 120,
	});
	dispatchPointer(left, "pointermove", {
		pointerId: 31,
		buttons: 1,
		clientX: 200,
	});
	expect(width(container, "left")).toBe(320);

	// An old loss on the same handle cannot terminate a new live capture.
	dispatchPointer(left, "pointerdown", { pointerId: 31, clientX: 200 });
	dispatchPointer(left, "lostpointercapture", {
		pointerId: 31,
		buttons: 0,
		clientX: 200,
	});
	dispatchPointer(left, "pointermove", {
		pointerId: 31,
		buttons: 1,
		clientX: 220,
	});
	expect(width(container, "left")).toBe(340);
	dispatchPointer(left, "pointerdown", { pointerId: 31, clientX: 300 });
	dispatchPointer(left, "lostpointercapture", {
		pointerId: 31,
		buttons: 0,
		clientX: 300,
	});
	dispatchPointer(left, "pointermove", {
		pointerId: 31,
		buttons: 1,
		clientX: 310,
	});
	expect(width(container, "left")).toBe(350);
	dispatchPointer(left, "pointerup", {
		pointerId: 31,
		buttons: 0,
		clientX: 220,
	});

	// A delayed loss from the old left owner cannot stop a new right owner.
	dispatchPointer(right, "pointerdown", { pointerId: 31, clientX: 200 });
	dispatchPointer(left, "lostpointercapture", {
		pointerId: 31,
		buttons: 0,
		clientX: 200,
	});
	dispatchPointer(right, "pointermove", {
		pointerId: 31,
		buttons: 1,
		clientX: 180,
	});
	expect(width(container, "right")).toBe(340);
	dispatchPointer(right, "pointerup", {
		pointerId: 31,
		buttons: 0,
		clientX: 180,
	});
});
