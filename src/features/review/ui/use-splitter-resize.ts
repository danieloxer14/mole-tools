import type { PointerEvent } from "react";
import { useRef } from "react";
import type { ReviewColumn } from "./column-resize";

interface ResizeSession {
	column: ReviewColumn;
	pointerId: number;
	startClientX: number;
	startWidth: number;
	owner: HTMLHRElement;
}

export interface SplitterResizeHandlers {
	onPointerDown(
		event: PointerEvent<HTMLHRElement>,
		column: ReviewColumn,
		width: number,
	): void;
	onPointerMove(event: PointerEvent<HTMLHRElement>): void;
	onPointerEnd(event: PointerEvent<HTMLHRElement>): void;
	onLostPointerCapture(event: PointerEvent<HTMLHRElement>): void;
}

export function useSplitterResize(
	onResize: (column: ReviewColumn, requestedWidth: number) => void,
): SplitterResizeHandlers {
	const session = useRef<ResizeSession | null>(null);

	const endSession = (active: ResizeSession, releaseCapture: boolean) => {
		if (session.current !== active) return;
		session.current = null;
		if (releaseCapture && active.owner.hasPointerCapture(active.pointerId)) {
			active.owner.releasePointerCapture(active.pointerId);
		}
	};

	const onPointerDown = (
		event: PointerEvent<HTMLHRElement>,
		column: ReviewColumn,
		width: number,
	) => {
		if (event.button !== 0) return;

		const active = session.current;
		if (active && active.pointerId !== event.pointerId) return;
		if (active) endSession(active, true);

		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		session.current = {
			column,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startWidth: width,
			owner: event.currentTarget,
		};
	};

	const onPointerMove = (event: PointerEvent<HTMLHRElement>) => {
		const active = session.current;
		if (!active || active.pointerId !== event.pointerId) return;
		if ((event.buttons & 1) === 0) {
			endSession(active, true);
			return;
		}

		const delta = event.clientX - active.startClientX;
		onResize(
			active.column,
			active.startWidth + (active.column === "left" ? delta : -delta),
		);
	};

	const onPointerEnd = (event: PointerEvent<HTMLHRElement>) => {
		const active = session.current;
		if (!active || active.pointerId !== event.pointerId) return;
		endSession(active, true);
	};

	const onLostPointerCapture = (event: PointerEvent<HTMLHRElement>) => {
		const active = session.current;
		if (
			!active ||
			active.pointerId !== event.pointerId ||
			active.owner !== event.currentTarget ||
			active.owner.hasPointerCapture(active.pointerId)
		) {
			return;
		}
		endSession(active, false);
	};

	return {
		onPointerDown,
		onPointerMove,
		onPointerEnd,
		onLostPointerCapture,
	};
}
