import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type DiffDragRow,
	type DiffDragState,
	type DragAction,
	dragScrollDelta,
	nextDiffDragEnd,
} from "./line-drag";

export interface DiffDragHandle {
	/** Active drag, or null. Drives row highlighting. */
	drag: DiffDragState | null;
	/** Attach to a Tag line / Comment button's onMouseDown. */
	start: (
		action: DragAction,
		row: DiffDragRow,
		event: ReactMouseEvent<HTMLElement>,
	) => void;
}

function dragRowFromElement(element: Element | null): DiffDragRow | null {
	const row = element?.closest?.("[data-drag-hunk]");
	if (!row) return null;
	const hunkIndex = Number.parseInt(
		row.getAttribute("data-drag-hunk") ?? "",
		10,
	);
	const line = Number.parseInt(row.getAttribute("data-drag-line") ?? "", 10);
	const side = row.getAttribute("data-drag-side");
	if (Number.isNaN(hunkIndex) || Number.isNaN(line)) return null;
	if (side !== "new" && side !== "old") return null;
	return { hunkIndex, side, line };
}
export function useDiffDrag(options: {
	onCommit: (action: DragAction, origin: DiffDragRow, end: DiffDragRow) => void;
}): DiffDragHandle {
	const [drag, setDrag] = useState<DiffDragState | null>(null);
	const dragRef = useRef<DiffDragState | null>(null);
	const containerRef = useRef<HTMLElement | null>(null);
	const heldClientXRef = useRef(0);
	const heldClientYRef = useRef(0);
	const onCommitRef = useRef(options.onCommit);
	onCommitRef.current = options.onCommit;

	const start = useCallback(
		(
			action: DragAction,
			row: DiffDragRow,
			event: ReactMouseEvent<HTMLElement>,
		) => {
			event.preventDefault();
			event.stopPropagation();
			containerRef.current =
				event.currentTarget.closest<HTMLElement>(".diff-panel");
			heldClientXRef.current = event.clientX;
			heldClientYRef.current = event.clientY;
			const nextDrag = { action, origin: row, end: row };
			dragRef.current = nextDrag;
			setDrag(nextDrag);
		},
		[],
	);

	const isDragging = drag !== null;
	useEffect(() => {
		if (!isDragging) return;

		const updateEnd = (candidate: DiffDragRow | null) => {
			const current = dragRef.current;
			if (!current) return;
			const nextEnd = nextDiffDragEnd(current.origin, current.end, candidate);
			if (nextEnd === current.end) return;
			const nextDrag = { ...current, end: nextEnd };
			dragRef.current = nextDrag;
			setDrag(nextDrag);
		};
		const handleMouseMove = (event: globalThis.MouseEvent) => {
			heldClientXRef.current = event.clientX;
			heldClientYRef.current = event.clientY;
			updateEnd(dragRowFromElement(event.target as HTMLElement | null));
		};
		const handleMouseUp = () => {
			const current = dragRef.current;
			if (!current) return;
			dragRef.current = null;
			containerRef.current = null;
			setDrag(null);
			onCommitRef.current(current.action, current.origin, current.end);
		};
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			dragRef.current = null;
			containerRef.current = null;
			setDrag(null);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		window.addEventListener("keydown", handleKeyDown, { capture: true });

		let frame = 0;
		const scroll = () => {
			const container = containerRef.current;
			const current = dragRef.current;
			if (!container || !current) return;
			const rect = container.getBoundingClientRect();
			const delta = dragScrollDelta(
				heldClientYRef.current,
				rect.top,
				rect.bottom,
			);
			if (delta !== 0) {
				container.scrollTop += delta;
				updateEnd(
					dragRowFromElement(
						document.elementFromPoint(
							heldClientXRef.current,
							heldClientYRef.current,
						),
					),
				);
			}
			frame = window.requestAnimationFrame(scroll);
		};
		frame = window.requestAnimationFrame(scroll);

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
			window.cancelAnimationFrame(frame);
		};
	}, [isDragging]);

	return { drag, start };
}
