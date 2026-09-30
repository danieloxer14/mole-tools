import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ImportanceFile,
	ImportanceSnapshot,
	ImportanceStatus,
} from "../importance";
import { errorMessage, requestJson } from "./api-json";
import { consumeImportanceStream } from "./importance-stream";
import type { LayerStreamFrame } from "./layer-stream";

export interface UseImportanceResult {
	status: ImportanceStatus | null;
	error: string | null;
	files: ImportanceFile[];
	canRetry: boolean;
	retry: () => void;
}

type ImportanceState = Omit<UseImportanceResult, "canRetry" | "retry"> & {
	revisionMismatch: boolean;
};
type ImportanceAction = "observe" | "retry";
const REVISION_MISMATCH_ERROR =
	"Importance results are for a different revision. Sync or reload the review.";
const IMPORTANCE_STREAM_INCOMPLETE_ERROR =
	"Importance stream ended before a result";
const REVISION_MISMATCH_STATE: ImportanceState = {
	status: "failed",
	error: REVISION_MISMATCH_ERROR,
	files: [],
	revisionMismatch: true,
};
const INITIAL_STATE: ImportanceState = {
	status: null,
	error: null,
	files: [],
	revisionMismatch: false,
};

function applyStreamFrame(
	state: ImportanceState,
	frame: LayerStreamFrame,
): ImportanceState {
	if (frame.event === "error") {
		return {
			status: "failed",
			error:
				typeof frame.data.message === "string"
					? frame.data.message
					: "Importance stream failed",
			files: [],
			revisionMismatch: false,
		};
	}

	if (frame.event !== "status") return state;
	const status = frame.data.status;
	if (status !== "ready" && status !== "failed") return state;

	return {
		...state,
		status,
		error:
			typeof frame.data.error === "string" || frame.data.error === null
				? frame.data.error
				: state.error,
		files: Array.isArray(frame.data.files)
			? (frame.data.files as ImportanceFile[])
			: state.files,
	};
}

async function streamAndRefetch(
	token: string,
	action: ImportanceAction,
	revisionKey: string,
	controller: AbortController,
	isActive: () => boolean,
	update: (state: ImportanceState) => void,
): Promise<void> {
	let streamState: ImportanceState = {
		status: "running",
		error: null,
		files: [],
		revisionMismatch: false,
	};
	let terminalFailure: ImportanceState | null = null;
	let revisionMismatch = false;
	await consumeImportanceStream(
		token,
		action,
		revisionKey,
		(frame) => {
			if (!isActive() || revisionMismatch) return;
			if (
				frame.event !== "done" &&
				typeof frame.data.revisionKey === "string" &&
				frame.data.revisionKey !== revisionKey
			) {
				revisionMismatch = true;
				update(REVISION_MISMATCH_STATE);
				controller.abort();
				return;
			}
			streamState = applyStreamFrame(streamState, frame);
			if (frame.event === "error") terminalFailure = streamState;
			else if (frame.event === "status") {
				if (streamState.status === "failed") terminalFailure = streamState;
				else if (streamState.status === "ready") terminalFailure = null;
			}
			update(streamState);
		},
		controller.signal,
	);
	if (revisionMismatch || !isActive()) return;

	let snapshot: ImportanceSnapshot;
	try {
		snapshot = await requestJson<ImportanceSnapshot>(token, "/api/importance", {
			signal: controller.signal,
		});
	} catch (error) {
		if (!isActive()) throw error;
		if (terminalFailure) {
			update(terminalFailure);
			return;
		}
		if (streamState.status === "ready") {
			update(streamState);
			return;
		}
		throw error;
	}
	if (!isActive()) return;
	if (snapshot.revisionKey !== revisionKey) update(REVISION_MISMATCH_STATE);
	else if (snapshot.status === "pending" || snapshot.status === "running") {
		if (streamState.status === "ready") update(streamState);
		else if (terminalFailure) update(terminalFailure);
		else {
			update({
				status: "failed",
				error: IMPORTANCE_STREAM_INCOMPLETE_ERROR,
				files: [],
				revisionMismatch: false,
			});
		}
	} else update({ ...snapshot, revisionMismatch: false });
}

export function useImportance(
	token: string,
	enabled: boolean,
	revisionKey: string,
): UseImportanceResult {
	const [state, setState] = useState<ImportanceState>(INITIAL_STATE);
	const stateRef = useRef(state);
	const operationRef = useRef(0);
	const controllerRef = useRef<AbortController | null>(null);

	const commit = useCallback((next: ImportanceState) => {
		stateRef.current = next;
		setState(next);
	}, []);
	const beginOperation = useCallback(() => {
		controllerRef.current?.abort();
		const operation = ++operationRef.current;
		const controller = new AbortController();
		controllerRef.current = controller;
		const isActive = () =>
			operationRef.current === operation && !controller.signal.aborted;
		const update = (next: ImportanceState) => {
			if (isActive()) commit(next);
		};
		return { controller, isActive, update };
	}, [commit]);

	useEffect(() => {
		const { controller, isActive, update } = beginOperation();
		update(INITIAL_STATE);
		const cleanup = () => {
			operationRef.current++;
			controllerRef.current?.abort();
			controllerRef.current = null;
		};
		if (!enabled || revisionKey === "") return cleanup;

		void (async () => {
			try {
				const snapshot = await requestJson<ImportanceSnapshot>(
					token,
					"/api/importance",
					{ signal: controller.signal },
				);
				if (!isActive()) return;
				if (snapshot.revisionKey !== revisionKey) {
					update(REVISION_MISMATCH_STATE);
				} else if (
					snapshot.status === "pending" ||
					snapshot.status === "running"
				) {
					update({
						status: "running",
						error: null,
						files: [],
						revisionMismatch: false,
					});
					await streamAndRefetch(
						token,
						"observe",
						revisionKey,
						controller,
						isActive,
						update,
					);
				} else {
					update({ ...snapshot, revisionMismatch: false });
				}
			} catch (error) {
				update({
					status: "failed",
					error: errorMessage(error),
					files: [],
					revisionMismatch: false,
				});
			}
		})();

		return cleanup;
	}, [token, enabled, revisionKey, beginOperation]);

	const retry = useCallback(() => {
		if (
			stateRef.current.status !== "failed" ||
			stateRef.current.revisionMismatch ||
			!enabled ||
			revisionKey === ""
		)
			return;
		const { controller, isActive, update } = beginOperation();
		update({
			status: "running",
			error: null,
			files: [],
			revisionMismatch: false,
		});
		void (async () => {
			try {
				await streamAndRefetch(
					token,
					"retry",
					revisionKey,
					controller,
					isActive,
					update,
				);
			} catch (error) {
				update({
					status: "failed",
					error: errorMessage(error),
					files: [],
					revisionMismatch: false,
				});
			}
		})();
	}, [beginOperation, enabled, revisionKey, token]);

	return {
		...state,
		canRetry: state.status === "failed" && !state.revisionMismatch,
		retry,
	};
}
