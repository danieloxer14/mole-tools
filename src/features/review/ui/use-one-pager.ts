import { useCallback, useEffect, useRef, useState } from "react";
import type { OnePagerSnapshot, OnePagerStatus } from "../one-pager";
import { errorMessage, requestJson } from "./api-json";
import { type LayerStreamFrame, postSseStream } from "./layer-stream";

export const ONE_PAGER_REFRESH_DEBOUNCE_MS = 500;

export type OnePagerViewStatus = "loading" | "idle" | "running" | "ready";

export interface OnePagerView {
	status: OnePagerViewStatus;
	markdown: string | null;
	error: string | null;
}

export interface OnePagerController extends OnePagerView {
	create(): void;
	scheduleRefresh(): void;
}

type OnePagerState = OnePagerView & { updatedAt: string | null };
type SnapshotOptions = {
	preserveError?: boolean;
	skipWhileRunning?: boolean;
};
type StreamAction = "generate" | "observe";

const IDLE_STATE: OnePagerState = {
	status: "idle",
	markdown: null,
	error: null,
	updatedAt: null,
};

function isOnePagerStatus(value: unknown): value is OnePagerStatus {
	return value === "idle" || value === "running" || value === "ready";
}

function applySnapshot(
	snapshot: OnePagerSnapshot,
	error: string | null,
): OnePagerState {
	return {
		status: isOnePagerStatus(snapshot.status) ? snapshot.status : "idle",
		markdown:
			typeof snapshot.markdown === "string" || snapshot.markdown === null
				? snapshot.markdown
				: null,
		error,
		updatedAt:
			typeof snapshot.updatedAt === "string" || snapshot.updatedAt === null
				? snapshot.updatedAt
				: null,
	};
}
function applyStreamFrame(
	state: OnePagerState,
	frame: LayerStreamFrame,
): OnePagerState | null {
	if (frame.event === "error") {
		return {
			...state,
			error:
				typeof frame.data.message === "string"
					? frame.data.message
					: "One pager stream failed",
		};
	}
	if (frame.event !== "status" || !isOnePagerStatus(frame.data.status))
		return null;
	return {
		...state,
		status: frame.data.status,
		error: null,
		markdown:
			typeof frame.data.markdown === "string" || frame.data.markdown === null
				? frame.data.markdown
				: state.markdown,
		updatedAt:
			typeof frame.data.updatedAt === "string" || frame.data.updatedAt === null
				? frame.data.updatedAt
				: state.updatedAt,
	};
}

export function useOnePager(
	token: string,
	enabled: boolean,
): OnePagerController {
	const [state, setState] = useState<OnePagerState>(IDLE_STATE);
	const stateRef = useRef(state);
	const lifecycleRef = useRef(0);
	const mountedRef = useRef(false);
	const requestSequenceRef = useRef(0);
	const controllersRef = useRef(new Set<AbortController>());
	const streamControllerRef = useRef<AbortController | null>(null);
	const locallyRunningRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const commit = useCallback((next: OnePagerState) => {
		stateRef.current = next;
		setState(next);
	}, []);

	const fetchSnapshot = useCallback(
		async (
			requestToken: string,
			lifecycle: number,
			options: SnapshotOptions = {},
		): Promise<OnePagerSnapshot | null> => {
			const requestSequence = ++requestSequenceRef.current;
			const controller = new AbortController();
			controllersRef.current.add(controller);
			const isActive = () =>
				mountedRef.current &&
				lifecycleRef.current === lifecycle &&
				!controller.signal.aborted;

			try {
				const snapshot = await requestJson<OnePagerSnapshot>(
					requestToken,
					"/api/one-pager",
					{ signal: controller.signal },
				);
				if (
					!isActive() ||
					requestSequenceRef.current !== requestSequence ||
					(options.skipWhileRunning && locallyRunningRef.current)
				)
					return null;

				commit(
					applySnapshot(
						snapshot,
						options.preserveError ? stateRef.current.error : null,
					),
				);
				return snapshot;
			} catch (error) {
				if (
					!isActive() ||
					requestSequenceRef.current !== requestSequence ||
					(options.skipWhileRunning && locallyRunningRef.current)
				)
					return null;

				const current = stateRef.current;
				commit({
					...current,
					status: current.markdown === null ? "idle" : "ready",
					error:
						options.preserveError && current.error
							? current.error
							: `Unable to load one pager: ${errorMessage(error)}`,
				});
				return null;
			} finally {
				controllersRef.current.delete(controller);
			}
		},
		[commit],
	);

	const reconcileEndedObservation = useCallback(
		async (
			requestToken: string,
			lifecycle: number,
			error: string | null,
			generationError: string | null,
		): Promise<OnePagerSnapshot | null> => {
			const snapshot = await fetchSnapshot(requestToken, lifecycle, {
				preserveError: true,
			});
			if (!mountedRef.current || lifecycleRef.current !== lifecycle)
				return null;
			if (!snapshot || snapshot.status === "running") {
				const current = stateRef.current;
				commit({
					...current,
					status: "running",
					error:
						current.error ??
						error ??
						"One pager status stream ended while generation is running; reconnecting.",
				});
			} else if (snapshot.status === "ready") {
				commit(applySnapshot(snapshot, generationError));
			}
			return snapshot;
		},
		[commit, fetchSnapshot],
	);

	const openStream = useCallback(
		async (
			requestToken: string,
			lifecycle: number,
			action: StreamAction,
			onFrame: (frame: LayerStreamFrame) => void,
		): Promise<void> => {
			if (!mountedRef.current || lifecycleRef.current !== lifecycle) return;

			streamControllerRef.current?.abort();
			const controller = new AbortController();
			streamControllerRef.current = controller;
			controllersRef.current.add(controller);
			const path =
				action === "generate"
					? "/api/one-pager/generate"
					: "/api/one-pager/observe";
			const onCurrentFrame = (frame: LayerStreamFrame) => {
				if (
					controller.signal.aborted ||
					streamControllerRef.current !== controller
				)
					return;
				onFrame(frame);
			};
			try {
				await postSseStream(
					requestToken,
					path,
					"One pager",
					action,
					onCurrentFrame,
					controller.signal,
				);
			} catch (error) {
				if (!controller.signal.aborted) throw error;
			} finally {
				controllersRef.current.delete(controller);
				if (streamControllerRef.current === controller)
					streamControllerRef.current = null;
			}
		},
		[],
	);

	const observeUntilSettled = useCallback(
		async (requestToken: string, lifecycle: number): Promise<void> => {
			const isActive = () =>
				mountedRef.current && lifecycleRef.current === lifecycle;
			let retryDelayMs = 250;
			while (isActive() && !locallyRunningRef.current) {
				let observeError: string | null = null;
				let generationError: string | null = null;
				try {
					await openStream(requestToken, lifecycle, "observe", (frame) => {
						if (!isActive()) return;
						if (frame.event === "error")
							generationError =
								typeof frame.data.message === "string"
									? frame.data.message
									: "One pager stream failed";
						const next = applyStreamFrame(stateRef.current, frame);
						if (next) commit(next);
					});
				} catch (error) {
					observeError = errorMessage(error);
					if (isActive()) commit({ ...stateRef.current, error: observeError });
				}
				if (!isActive() || locallyRunningRef.current) return;

				const snapshot = await reconcileEndedObservation(
					requestToken,
					lifecycle,
					observeError,
					generationError,
				);
				if (!isActive() || (snapshot && snapshot.status !== "running")) return;

				await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
				retryDelayMs = Math.min(retryDelayMs * 2, 5_000);
			}
		},
		[commit, openStream, reconcileEndedObservation],
	);

	useEffect(() => {
		const lifecycle = ++lifecycleRef.current;
		mountedRef.current = true;
		const isActive = () =>
			mountedRef.current && lifecycleRef.current === lifecycle;
		const clearTimer = () => {
			clearTimeout(timerRef.current);
			timerRef.current = undefined;
		};
		const cleanup = () => {
			if (lifecycleRef.current === lifecycle) lifecycleRef.current++;
			mountedRef.current = false;
			locallyRunningRef.current = false;
			requestSequenceRef.current++;
			clearTimer();
			for (const controller of controllersRef.current) controller.abort();
			controllersRef.current.clear();
			streamControllerRef.current = null;
		};

		if (!enabled) {
			locallyRunningRef.current = false;
			commit(IDLE_STATE);
			return cleanup;
		}

		locallyRunningRef.current = false;
		commit({ ...IDLE_STATE, status: "loading" });
		void (async () => {
			const snapshot = await fetchSnapshot(token, lifecycle, {
				skipWhileRunning: true,
			});
			if (!snapshot || !isActive() || snapshot.status !== "running") return;

			await observeUntilSettled(token, lifecycle);
		})();

		return cleanup;
	}, [commit, enabled, fetchSnapshot, observeUntilSettled, token]);
	const create = useCallback(() => {
		if (
			!enabled ||
			!mountedRef.current ||
			locallyRunningRef.current ||
			stateRef.current.status === "running"
		)
			return;

		const lifecycle = lifecycleRef.current;
		locallyRunningRef.current = true;
		commit({ ...stateRef.current, status: "running", error: null });
		void (async () => {
			try {
				await openStream(token, lifecycle, "generate", (frame) => {
					if (!mountedRef.current || lifecycleRef.current !== lifecycle) return;
					const next = applyStreamFrame(stateRef.current, frame);
					if (next) commit(next);
				});
			} catch (error) {
				if (mountedRef.current && lifecycleRef.current === lifecycle)
					commit({ ...stateRef.current, error: errorMessage(error) });
			} finally {
				if (mountedRef.current && lifecycleRef.current === lifecycle) {
					locallyRunningRef.current = false;
					const snapshot = await fetchSnapshot(token, lifecycle, {
						preserveError: true,
					});
					if (
						snapshot?.status === "running" &&
						mountedRef.current &&
						lifecycleRef.current === lifecycle
					)
						await observeUntilSettled(token, lifecycle);
				}
			}
		})();
	}, [commit, enabled, fetchSnapshot, observeUntilSettled, openStream, token]);

	const scheduleRefresh = useCallback(() => {
		if (!enabled || !mountedRef.current) return;
		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			timerRef.current = undefined;
			void fetchSnapshot(token, lifecycleRef.current, {
				skipWhileRunning: true,
			});
		}, ONE_PAGER_REFRESH_DEBOUNCE_MS);
	}, [enabled, fetchSnapshot, token]);

	const visibleState = enabled ? state : IDLE_STATE;
	return {
		status: visibleState.status,
		markdown: visibleState.markdown,
		error: visibleState.error,
		create,
		scheduleRefresh,
	};
}
