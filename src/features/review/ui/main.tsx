import { Loader2, TriangleAlert, X } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { HostDiscussion, MrApprovalState } from "../../../ports/git-host";
import { splitSourceLines } from "../../../shared/diff-context";
import type { ParsedFileDiff } from "../../../shared/diff-parse";
import { type ChatTag, chatTagsEqual } from "../chat-tags";
import type { ReviewApiState, ReviewProgressResponse } from "../routes";
import type { Draft, LineSelection } from "../state";
import type { ChatEntry } from "../store";
import { createRequestSequence } from "./chat-request-sequence";
import { bootColorTheme } from "./color-theme";
import {
	clampColumnWidth,
	initialColumnWidth,
	type ReviewColumn,
} from "./column-resize";
import { ChangedFiles } from "./components/ChangedFiles";
import {
	changedFileCount,
	diffLineTotals,
} from "./components/ChangedFilesHeader";
import {
	ChatPane,
	type ChatSummary,
	type ChatToolActivity,
} from "./components/ChatPane";
import {
	type DiffLineSelection,
	type DiffMode,
	DiffView,
	defaultFileViewMode,
	type FileViewMode,
	isMarkdownPath,
	type MarkdownBlockSelection,
} from "./components/DiffView";
import { LayerPane } from "./components/LayerPane";
import { type ApprovalAction, MrHeader, tabTitle } from "./components/MrHeader";
import { SettingsPanel } from "./components/SettingsPanel";
import { errorToastMessage, type Toast, Toasts } from "./components/Toasts";
import { Alert } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "./components/ui/dialog";
import { Spinner } from "./components/ui/spinner";
import { type DraftGeneration, fromChatAvailability } from "./from-chat";
import { generalDiscussions } from "./general-discussions";
import {
	type ReviewFreshnessResponse,
	runReviewRefresh,
} from "./review-refresh";
import { createReviewStateRequestSequence } from "./review-state-request-sequence";

import "./app.css";

type ReviewStateResponse = ReviewApiState;

/** Raw preview of a worktree file the agent referenced that isn't part of
 * this MR's diff (so it has no entry in `data.diff` to select). */
interface ExternalFilePreview {
	path: string;
	contents: string | null;
	error: string | null;
	loading: boolean;
}

function tokenFromLocation(): string {
	return new URLSearchParams(window.location.search).get("t") ?? "";
}

function apiUrl(path: string, token: string): string {
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}t=${encodeURIComponent(token)}`;
}

/** Resolves a file reference mentioned by the agent (e.g. "route.ts") to the
 * matching diff path (e.g. "src/features/review/routes.ts"). Falls back to
 * a unique path-suffix match when the agent used a shortened path. */
function resolveFileRef(ref: string, files: readonly string[]): string | null {
	if (files.includes(ref)) return ref;
	const suffixMatches = files.filter((file) => file.endsWith(`/${ref}`));
	if (suffixMatches.length === 1) return suffixMatches[0];
	if (suffixMatches.length > 1) {
		return suffixMatches.reduce((shortest, candidate) =>
			candidate.length < shortest.length ? candidate : shortest,
		);
	}
	return null;
}

async function fetchState(token: string): Promise<ReviewStateResponse> {
	const response = await fetch(apiUrl("/api/state", token), {
		headers: { "X-Mole-Token": token },
	});
	if (!response.ok)
		throw new Error(`State request failed (${response.status})`);
	return (await response.json()) as ReviewStateResponse;
}
interface WhitespaceDiffResponse {
	showWhitespaceChanges: boolean;
	diff: ParsedFileDiff[];
}

async function updateWhitespaceChanges(
	token: string,
	showWhitespaceChanges: boolean,
): Promise<WhitespaceDiffResponse> {
	const response = await fetch(apiUrl("/api/diff/whitespace", token), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"X-Mole-Token": token,
		},
		body: JSON.stringify({ showWhitespaceChanges }),
	});
	if (!response.ok)
		throw new Error(`Whitespace diff request failed (${response.status})`);
	return (await response.json()) as WhitespaceDiffResponse;
}

async function fetchApproval(token: string): Promise<MrApprovalState | null> {
	const response = await fetch(apiUrl("/api/approval", token), {
		headers: { "X-Mole-Token": token },
	});
	if (!response.ok)
		throw new Error(`Approval request failed (${response.status})`);
	const value: unknown = await response.json();
	return value === null ? null : (value as MrApprovalState);
}

async function updateApproval(
	token: string,
	action: ApprovalAction,
): Promise<MrApprovalState | null> {
	const response = await fetch(apiUrl("/api/approval", token), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"X-Mole-Token": token,
		},
		body: JSON.stringify({ action }),
	});
	if (!response.ok)
		throw new Error(`Approval request failed (${response.status})`);
	const value: unknown = await response.json();
	return value === null ? null : (value as MrApprovalState);
}

async function fetchFreshness(token: string): Promise<ReviewFreshnessResponse> {
	const response = await fetch(apiUrl("/api/refresh", token), {
		headers: { "X-Mole-Token": token },
	});
	if (!response.ok)
		throw new Error(`Refresh request failed (${response.status})`);
	const value: unknown = await response.json();
	if (typeof value !== "object" || value === null)
		throw new Error("Refresh response was invalid");
	const data = value as Record<string, unknown>;
	if (
		typeof data.stale !== "boolean" ||
		typeof data.headSha !== "string" ||
		(typeof data.newCommitCount !== "number" &&
			typeof data.newCommits !== "number")
	) {
		throw new Error("Refresh response was invalid");
	}
	return {
		stale: data.stale,
		headSha: data.headSha,
		newCommitCount:
			typeof data.newCommitCount === "number"
				? data.newCommitCount
				: (data.newCommits as number),
	};
}

async function fetchChatHistory(
	token: string,
	chatId: string,
): Promise<ChatEntry[]> {
	const response = await fetch(
		apiUrl(`/api/chat?chatId=${encodeURIComponent(chatId)}`, token),
		{
			headers: { "X-Mole-Token": token },
		},
	);
	if (!response.ok)
		throw new Error(`Chat history request failed (${response.status})`);
	const value: unknown = await response.json();
	if (!Array.isArray(value))
		throw new Error("Chat history response was invalid");
	return value as ChatEntry[];
}

interface ChatStreamFrame {
	event: string;
	data: unknown;
}

function parseChatSseBlock(block: string): ChatStreamFrame | null {
	let event = "message";
	const dataLines: string[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) event = line.slice(6).trim();
		if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
	}
	if (dataLines.length === 0) return null;
	try {
		return { event, data: JSON.parse(dataLines.join("\n")) as unknown };
	} catch {
		return null;
	}
}

async function consumeChatStream(
	token: string,
	payload: {
		chatId: string;
		message: string;
		tags: ChatTag[];
		openFile: string | null;
	},
	onFrame: (frame: ChatStreamFrame) => void,
	signal: AbortSignal,
): Promise<void> {
	const response = await fetch(apiUrl("/api/chat", token), {
		method: "POST",
		headers: {
			accept: "text/event-stream",
			"content-type": "application/json",
			"X-Mole-Token": token,
		},
		body: JSON.stringify(payload),
		signal,
	});
	if (!response.ok) throw new Error(`Chat request failed (${response.status})`);
	if (!response.body) throw new Error("Chat stream did not return a body");

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			buffer += decoder.decode(result.value, { stream: true });
			const blocks = buffer.split(/\r?\n\r?\n/);
			buffer = blocks.pop() ?? "";
			for (const block of blocks) {
				const frame = parseChatSseBlock(block);
				if (frame) onFrame(frame);
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) {
			const frame = parseChatSseBlock(buffer);
			if (frame) onFrame(frame);
		}
	} finally {
		reader.releaseLock();
	}
}
async function consumeSseResponse(
	response: Response,
	onFrame: (frame: ChatStreamFrame) => void,
): Promise<void> {
	if (!response.body) throw new Error("Comment stream did not return a body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			buffer += decoder.decode(result.value, { stream: true });
			const blocks = buffer.split(/\r?\n\r?\n/);
			buffer = blocks.pop() ?? "";
			for (const block of blocks) {
				const frame = parseChatSseBlock(block);
				if (frame) onFrame(frame);
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) {
			const frame = parseChatSseBlock(buffer);
			if (frame) onFrame(frame);
		}
	} finally {
		reader.releaseLock();
	}
}

async function fetchExpandedDiff(
	token: string,
	path: string,
): Promise<ParsedFileDiff> {
	const response = await fetch(
		apiUrl(`/api/diff?path=${encodeURIComponent(path)}`, token),
		{ headers: { "X-Mole-Token": token } },
	);
	if (!response.ok) throw new Error(`Diff request failed (${response.status})`);
	return (await response.json()) as ParsedFileDiff;
}
async function fetchFileContents(
	token: string,
	path: string,
	side: "new" | "old",
): Promise<string> {
	const response = await fetch(
		apiUrl(`/api/file?path=${encodeURIComponent(path)}&side=${side}`, token),
		{ headers: { "X-Mole-Token": token } },
	);
	if (!response.ok) throw new Error(`File request failed (${response.status})`);
	return response.text();
}

type LayerAction = "regenerate" | "retry";

interface LayerStreamFrame {
	event: string;
	data: Record<string, unknown>;
}

function parseLayerStatus(
	value: unknown,
): ReviewStateResponse["layerStatus"] | null {
	return value === "pending" ||
		value === "running" ||
		value === "ready" ||
		value === "failed"
		? value
		: null;
}

function parseLayerSseBlock(block: string): LayerStreamFrame | null {
	let event = "message";
	const dataLines: string[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) event = line.slice(6).trim();
		if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
	}
	if (dataLines.length === 0) return null;
	try {
		const data: unknown = JSON.parse(dataLines.join("\n"));
		if (typeof data !== "object" || data === null) return null;
		return { event, data: data as Record<string, unknown> };
	} catch {
		return null;
	}
}

async function consumeLayerStream(
	token: string,
	action: LayerAction,
	onFrame: (frame: LayerStreamFrame) => void,
): Promise<void> {
	const response = await fetch(apiUrl(`/api/layers/${action}`, token), {
		method: "POST",
		headers: {
			accept: "text/event-stream",
			"X-Mole-Token": token,
		},
	});
	if (!response.ok)
		throw new Error(`Layer ${action} request failed (${response.status})`);
	if (!response.body) throw new Error("Layer stream did not return a body");

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			buffer += decoder.decode(result.value, { stream: true });
			const blocks = buffer.split(/\r?\n\r?\n/);
			buffer = blocks.pop() ?? "";
			for (const block of blocks) {
				const frame = parseLayerSseBlock(block);
				if (frame) onFrame(frame);
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) {
			const frame = parseLayerSseBlock(buffer);
			if (frame) onFrame(frame);
		}
	} finally {
		reader.releaseLock();
	}
}

function filePath(file: ParsedFileDiff): string {
	return file.newPath ?? file.oldPath ?? "";
}

function mergeLayerStreamFrame(
	state: ReviewStateResponse,
	frame: LayerStreamFrame,
): ReviewStateResponse {
	const status =
		frame.event === "error"
			? ("failed" as const)
			: parseLayerStatus(frame.data.status);
	const message =
		typeof frame.data.message === "string" ? frame.data.message : null;
	const error =
		typeof frame.data.error === "string"
			? frame.data.error
			: frame.data.error === null
				? null
				: undefined;
	const layers = Array.isArray(frame.data.layers)
		? (frame.data.layers as ReviewStateResponse["layers"])
		: state.layers;
	return {
		...state,
		layerStatus: status ?? state.layerStatus,
		layerError:
			frame.event === "error"
				? (message ?? state.layerError)
				: error !== undefined
					? error
					: status === "running"
						? null
						: state.layerError,
		layers,
	};
}
type ColumnWidths = Record<ReviewColumn, number>;

interface ResizeSession {
	column: ReviewColumn;
	pointerId: number;
	startClientX: number;
	startWidth: number;
}

function centreColumnMinimumWidth(): number {
	return window.innerWidth <= 1200 ? 450 : 500;
}

function otherColumn(column: ReviewColumn): ReviewColumn {
	return column === "left" ? "right" : "left";
}
interface ChatRuntime {
	entries: ChatEntry[];
	tags: ChatTag[];
	draft: string;
	streamingSegments: string[];
	tools: ChatToolActivity[];
	error: string | null;
	sending: boolean;
	stopping: boolean;
	loaded: boolean;
}

const EMPTY_CHAT_RUNTIME: ChatRuntime = {
	entries: [],
	tags: [],
	draft: "",
	streamingSegments: [],
	tools: [],
	error: null,
	sending: false,
	stopping: false,
	loaded: false,
};

type ChatRuntimePatch =
	| Partial<ChatRuntime>
	| ((current: ChatRuntime) => Partial<ChatRuntime>);

function useToasts() {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const toastId = useRef(0);
	const dismissToast = useCallback((id: string) => {
		setToasts((current) => current.filter((toast) => toast.id !== id));
	}, []);
	const pushToast = useCallback(
		(toast: Omit<Toast, "id">) => {
			const id = `toast-${++toastId.current}`;
			setToasts((current) => [...current, { ...toast, id }]);
			if (toast.kind === "info") {
				setTimeout(() => dismissToast(id), 3000);
			}
		},
		[dismissToast],
	);
	return { dismissToast, pushToast, toasts };
}

function ReviewApp() {
	const token = useMemo(tokenFromLocation, []);
	const [data, setData] = useState<ReviewStateResponse | null>(null);

	const { dismissToast, pushToast, toasts } = useToasts();
	const [columnMinimums] = useState<ColumnWidths>(() => ({
		left: initialColumnWidth("left", window.innerWidth),
		right: initialColumnWidth("right", window.innerWidth),
	}));
	const [columnWidths, setColumnWidths] =
		useState<ColumnWidths>(columnMinimums);
	const reviewShell = useRef<HTMLElement | null>(null);
	const resizeSession = useRef<ResizeSession | null>(null);

	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [diffMode, setDiffMode] = useState<DiffMode>("inline");
	const [fileViewModes, setFileViewModes] = useState<
		Record<string, FileViewMode>
	>({});
	const [wholeFileModes, setWholeFileModes] = useState<Record<string, boolean>>(
		{},
	);
	const [confirmedWholeFilePaths, setConfirmedWholeFilePaths] = useState<
		Record<string, true>
	>({});
	const [pendingWholeFilePaths, setPendingWholeFilePaths] = useState<
		Record<string, true>
	>({});
	const [fileContents, setFileContents] = useState<string | null>(null);
	const [fileContentsError, setFileContentsError] = useState<string | null>(
		null,
	);
	const [externalFile, setExternalFile] = useState<ExternalFilePreview | null>(
		null,
	);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [approvalLoading, setApprovalLoading] = useState(true);
	const [approvalAction, setApprovalAction] = useState<ApprovalAction | null>(
		null,
	);
	const [freshness, setFreshness] = useState<ReviewFreshnessResponse | null>(
		null,
	);
	const [refreshing, setRefreshing] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [whitespaceChanging, setWhitespaceChanging] = useState(false);
	const whitespaceChangingRef = useRef(false);
	const syncingRef = useRef(false);
	const [layerAction, setLayerAction] = useState<LayerAction | null>(null);
	const [progressError, setProgressError] = useState<string | null>(null);
	const [chatRuntimes, setChatRuntimes] = useState<Record<string, ChatRuntime>>(
		{},
	);
	const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
	const [creatingChat, setCreatingChat] = useState(false);
	const [commentError, setCommentError] = useState<string | null>(null);
	const [draftGenerations, setDraftGenerations] = useState<
		Record<string, DraftGeneration>
	>({});
	const chatControllers = useRef(new Map<string, AbortController>());
	const fromChatControllers = useRef(new Map<string, AbortController>());
	const chatToolSequence = useRef(0);
	const chatHistoryRequests = useRef(createRequestSequence());
	const reviewStateRequests = useRef(createReviewStateRequestSequence());
	const chatSelectionRequests = useRef(createRequestSequence());
	const chatSelectionQueue = useRef(Promise.resolve());
	const autoRunRequested = useRef(false);
	const draftEditSequence = useRef(new Map<string, number>());
	const patchChat = useCallback((chatId: string, patch: ChatRuntimePatch) => {
		setChatRuntimes((current) => {
			const runtime = current[chatId] ?? EMPTY_CHAT_RUNTIME;
			const nextPatch = typeof patch === "function" ? patch(runtime) : patch;
			return {
				...current,
				[chatId]: { ...runtime, ...nextPatch },
			};
		});
	}, []);
	const fetchReviewState = useCallback(async () => {
		const request = reviewStateRequests.current.beginFetch();
		const next = await fetchState(token);
		if (reviewStateRequests.current.canApplyFetch(request)) setData(next);
		return next;
	}, [token]);
	const resizeColumn = (column: ReviewColumn, requestedWidth: number) => {
		const shell = reviewShell.current;
		if (!shell) return;

		setColumnWidths((current) => {
			const minimumWidth = columnMinimums[column];
			const availableWidth =
				shell.clientWidth -
				current[otherColumn(column)] -
				centreColumnMinimumWidth();
			const nextWidth = clampColumnWidth(
				requestedWidth,
				minimumWidth,
				availableWidth,
			);
			return nextWidth === current[column]
				? current
				: { ...current, [column]: nextWidth };
		});
	};
	const maximumColumnWidth = (column: ReviewColumn): number => {
		const shell = reviewShell.current;
		if (!shell) return columnMinimums[column] * 3;
		return clampColumnWidth(
			columnMinimums[column] * 3,
			columnMinimums[column],
			shell.clientWidth -
				columnWidths[otherColumn(column)] -
				centreColumnMinimumWidth(),
		);
	};
	const handleSplitterPointerDown = (
		event: PointerEvent<HTMLHRElement>,
		column: ReviewColumn,
	) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		resizeSession.current = {
			column,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startWidth: columnWidths[column],
		};
	};
	const handleSplitterPointerMove = (event: PointerEvent<HTMLHRElement>) => {
		const session = resizeSession.current;
		if (!session || session.pointerId !== event.pointerId) return;
		const delta = event.clientX - session.startClientX;
		resizeColumn(
			session.column,
			session.startWidth + (session.column === "left" ? delta : -delta),
		);
	};
	const stopResizing = (event: PointerEvent<HTMLHRElement>) => {
		if (resizeSession.current?.pointerId !== event.pointerId) return;
		resizeSession.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};
	const handleSplitterKeyDown = (
		event: KeyboardEvent<HTMLHRElement>,
		column: ReviewColumn,
	) => {
		const minimumWidth = columnMinimums[column];
		const direction = column === "left" ? 1 : -1;
		switch (event.key) {
			case "ArrowLeft":
				event.preventDefault();
				resizeColumn(column, columnWidths[column] - direction * 20);
				break;
			case "ArrowRight":
				event.preventDefault();
				resizeColumn(column, columnWidths[column] + direction * 20);
				break;
			case "Home":
				event.preventDefault();
				resizeColumn(column, minimumWidth);
				break;
			case "End":
				event.preventDefault();
				resizeColumn(column, minimumWidth * 3);
				break;
		}
	};

	useEffect(() => {
		if (!token) {
			setError("Missing review token");
			return;
		}
		let active = true;
		const applyFrame = (frame: LayerStreamFrame) => {
			if (!active) return;
			setData((current) =>
				current ? mergeLayerStreamFrame(current, frame) : current,
			);
		};
		void fetchFreshness(token)
			.then((next) => {
				if (active) {
					setFreshness(next);
				}
			})
			.catch((reason: unknown) => {
				if (active) {
					pushToast({
						kind: "error",
						message: errorToastMessage(reason),
					});
				}
			});
		fetchReviewState()
			.then((next) => {
				if (!active) return;
				if (
					next.layerStatus === "pending" &&
					!autoRunRequested.current &&
					next.layers.every((layer) => !layer.stale)
				) {
					autoRunRequested.current = true;
					setLayerAction("regenerate");
					void consumeLayerStream(token, "regenerate", applyFrame)
						.then(() => fetchReviewState())
						.catch((reason: unknown) => {
							if (!active) return;
							const message =
								reason instanceof Error ? reason.message : String(reason);
							setData((current) =>
								current
									? {
											...current,
											layerStatus: "failed",
											layerError: message,
										}
									: current,
							);
						})
						.finally(() => {
							if (active) setLayerAction(null);
						});
				}
			})
			.catch((reason: unknown) => {
				if (active)
					setError(reason instanceof Error ? reason.message : String(reason));
			});
		return () => {
			active = false;
		};
	}, [token, pushToast, fetchReviewState]);
	useEffect(() => {
		if (!data) return;
		const visiblePaths = data.diff
			.map(filePath)
			.filter((path) => path.length > 0);
		setSelectedPath((current) =>
			current !== null && visiblePaths.includes(current)
				? current
				: (visiblePaths[0] ?? null),
		);
	}, [data]);

	const reviewLoaded = data !== null;
	useEffect(() => {
		if (!token || !reviewLoaded) return;
		let active = true;
		setApprovalLoading(true);
		void fetchApproval(token)
			.then((next) => {
				if (!active) return;
				setData((current) =>
					current ? { ...current, approval: next } : current,
				);
			})
			.catch((reason: unknown) => {
				if (active) {
					pushToast({
						kind: "error",
						message: errorToastMessage(reason),
					});
				}
			})
			.finally(() => {
				if (active) setApprovalLoading(false);
			});
		return () => {
			active = false;
		};
	}, [token, reviewLoaded, pushToast]);
	const mrProjectPath = data?.mr.projectPath;
	const mrIid = data?.mr.iid;
	useEffect(() => {
		if (mrProjectPath === undefined || mrIid === undefined) return;
		document.title = tabTitle(mrProjectPath, mrIid);
	}, [mrProjectPath, mrIid]);
	const activeChatId = selectedChatId ?? data?.activeChatId ?? null;
	const activeChat = activeChatId
		? (chatRuntimes[activeChatId] ?? EMPTY_CHAT_RUNTIME)
		: EMPTY_CHAT_RUNTIME;
	const chatSummaries: ChatSummary[] = (data?.chats ?? []).map((chat) => ({
		id: chat.id,
		title: chat.title,
		createdAt: chat.createdAt,
		agent: chat.agent,
		model: chat.model,
		busy:
			(chatRuntimes[chat.id]?.sending ?? false) ||
			(data?.busyChatIds ?? []).includes(chat.id),
	}));
	const activeChatSummary = chatSummaries.find(
		(chat) => chat.id === activeChatId,
	);
	const activeChatBusy = activeChatSummary?.busy ?? false;
	const activeChatLoaded =
		activeChatId !== null && chatRuntimes[activeChatId]?.loaded === true;
	const activeChatIndex =
		activeChatId === null
			? -1
			: (data?.chats.findIndex((chat) => chat.id === activeChatId) ?? -1);
	const activeFromChatAvailability = fromChatAvailability({
		chat: activeChatSummary ?? null,
		chatIndex: activeChatIndex,
		busy: activeChatBusy,
		loaded: activeChat.loaded,
		entries: activeChat.entries,
	});

	useEffect(() => {
		if (
			!activeChatId ||
			activeChatLoaded ||
			chatControllers.current.has(activeChatId)
		)
			return;
		const chatId = activeChatId;
		const requestId = chatHistoryRequests.current.next(chatId);
		void fetchChatHistory(token, chatId)
			.then((entries) => {
				if (
					!chatHistoryRequests.current.isCurrent(chatId, requestId) ||
					chatControllers.current.has(chatId)
				)
					return;
				patchChat(chatId, { entries, loaded: true, error: null });
			})
			.catch((reason: unknown) => {
				if (
					!chatHistoryRequests.current.isCurrent(chatId, requestId) ||
					chatControllers.current.has(chatId)
				)
					return;
				patchChat(chatId, {
					error: reason instanceof Error ? reason.message : String(reason),
				});
			});
	}, [token, activeChatId, activeChatLoaded, patchChat]);

	// A reload drops browser-side SSE readers while server turns keep running.
	// Polling busy chats lets their completed assistant entry appear without
	// requiring another navigation or a second manual state request.
	const busyChatIds = data?.busyChatIds ?? [];
	useEffect(() => {
		const runningChatIds = busyChatIds;
		if (runningChatIds.length === 0) return;
		let active = true;
		let timer = 0;
		const refresh = async () => {
			if (!active) return;
			try {
				const latest = await fetchReviewState();
				const chatIds = [
					...new Set([...runningChatIds, ...latest.busyChatIds]),
				];
				await Promise.all(
					chatIds.map(async (chatId) => {
						if (chatControllers.current.has(chatId)) return;
						const requestId = chatHistoryRequests.current.next(chatId);
						try {
							const entries = await fetchChatHistory(token, chatId);
							if (
								active &&
								chatHistoryRequests.current.isCurrent(chatId, requestId) &&
								!chatControllers.current.has(chatId)
							)
								patchChat(chatId, { entries, loaded: true });
						} catch {
							// Keep polling; a transient history failure must not hide
							// the eventual assistant entry.
						}
					}),
				);
				if (!active) return;
				if (latest.busyChatIds.length > 0)
					timer = window.setTimeout(refresh, 750);
			} catch {
				if (active) timer = window.setTimeout(refresh, 750);
			}
		};
		timer = window.setTimeout(refresh, 750);
		return () => {
			active = false;
			window.clearTimeout(timer);
		};
	}, [token, busyChatIds, patchChat, fetchReviewState]);

	const selectedFile =
		data?.diff.find((file) => filePath(file) === selectedPath) ?? null;
	const selectedViewMode =
		selectedFile && selectedPath && isMarkdownPath(filePath(selectedFile))
			? (fileViewModes[selectedPath] ?? defaultFileViewMode(selectedFile))
			: "diff";
	const selectedWholeFile =
		selectedPath === null ? false : (wholeFileModes[selectedPath] ?? false);

	// selectedFile is intentionally excluded from this effect's deps below:
	// `/api/state` refetches (chat polling, layer-stream completion, comment
	// sends, ...) replace `data` with a new object graph for an unchanged
	// file, which would otherwise re-trigger this effect on every refetch and
	// cancel in-flight rendered-markdown work (mermaid/Shiki) before it
	// finishes. selectedPath, selectedFile.binary, and selectedFile.status are
	// the only primitives this effect's behavior actually depends on.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedFile identity churns on every unrelated /api/state refetch; only its binary/status primitives matter here.
	useEffect(() => {
		if (!selectedFile || selectedFile.binary) {
			setFileContents(null);
			setFileContentsError(null);
			return;
		}
		const path = selectedPath as string;
		const renderedMarkdown =
			selectedViewMode === "rendered" && isMarkdownPath(path);
		const side =
			selectedFile.status === "deleted" && !renderedMarkdown ? "old" : "new";
		let active = true;
		setFileContents(null);
		setFileContentsError(null);
		void fetchFileContents(token, path, side)
			.then((contents) => {
				if (active) setFileContents(contents);
			})
			.catch((reason: unknown) => {
				if (active)
					setFileContentsError(
						reason instanceof Error ? reason.message : String(reason),
					);
			});
		return () => {
			active = false;
		};
	}, [
		selectedPath,
		selectedFile?.binary,
		selectedFile?.status,
		selectedViewMode,
		token,
	]);
	useEffect(() => {
		if (!data || !selectedPath || !pendingWholeFilePaths[selectedPath]) return;
		if (fileContents === null) {
			if (fileContentsError === null) return;
			setPendingWholeFilePaths((current) => {
				const { [selectedPath]: _, ...remaining } = current;
				return remaining;
			});
			setWholeFileModes((current) => ({
				...current,
				[selectedPath]: true,
			}));
			return;
		}
		const sourceLineCount = splitSourceLines(fileContents).length;
		setPendingWholeFilePaths((current) => {
			const { [selectedPath]: _, ...remaining } = current;
			return remaining;
		});
		if (
			sourceLineCount > data.largeFileLineThreshold &&
			!confirmedWholeFilePaths[selectedPath]
		) {
			if (
				!window.confirm(
					`This file has ${sourceLineCount} lines. Show the whole file?`,
				)
			) {
				return;
			}
			setConfirmedWholeFilePaths((current) => ({
				...current,
				[selectedPath]: true,
			}));
		}
		setWholeFileModes((current) => ({
			...current,
			[selectedPath]: true,
		}));
	}, [
		data,
		selectedPath,
		pendingWholeFilePaths,
		fileContents,
		fileContentsError,
		confirmedWholeFilePaths,
	]);

	if (error)
		return (
			<main className="flex h-screen items-center justify-center gap-2 text-sm text-destructive">
				<TriangleAlert className="size-4 shrink-0" aria-hidden />
				<div>
					<h1 className="font-medium">Review unavailable</h1>
					<p>{error}</p>
				</div>
			</main>
		);
	if (!data)
		return (
			<main className="flex h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
				<Spinner />
				<span>Loading review...</span>
			</main>
		);
	const handleApprovalAction = (action: ApprovalAction) => {
		if (approvalAction !== null) return;
		setApprovalAction(action);
		void updateApproval(token, action)
			.then((next) => {
				setData((current) =>
					current ? { ...current, approval: next } : current,
				);
			})
			.catch((reason: unknown) => {
				pushToast({
					kind: "error",
					message: errorToastMessage(reason),
				});
			})
			.finally(() => setApprovalAction(null));
	};
	const handleShowWhitespaceChangesChange = (show: boolean) => {
		if (
			!data ||
			whitespaceChangingRef.current ||
			syncingRef.current ||
			whitespaceChanging ||
			refreshing ||
			syncing
		)
			return;
		const mutation = reviewStateRequests.current.beginMutation();
		whitespaceChangingRef.current = true;
		setWhitespaceChanging(true);
		void updateWhitespaceChanges(token, show)
			.then((next) => {
				if (!reviewStateRequests.current.canApplyMutation(mutation)) return;
				setData((current) =>
					current
						? {
								...current,
								showWhitespaceChanges: next.showWhitespaceChanges,
								diff: next.diff,
							}
						: current,
				);
			})
			.catch((reason: unknown) => {
				pushToast({
					kind: "error",
					message: errorToastMessage(reason),
				});
			})
			.finally(() => {
				reviewStateRequests.current.finishMutation(mutation);
				whitespaceChangingRef.current = false;
				setWhitespaceChanging(false);
			});
	};

	const files = data.diff.map(filePath).filter((path) => path.length > 0);
	const changedFileTotal = changedFileCount(files);
	const lineTotals = diffLineTotals(data.diff);
	const selectFile = (path: string) => {
		setSelectedPath(path);
	};
	const openFileRef = (ref: string) => {
		const match = resolveFileRef(ref, files);
		if (match) {
			setExternalFile(null);
			selectFile(match);
			return;
		}
		// Chat can reference files the reviewer has open in their worktree but
		// that aren't part of this MR's diff; fetch and preview those directly
		// instead of silently doing nothing.
		setExternalFile({ path: ref, contents: null, error: null, loading: true });
		void fetchFileContents(token, ref, "new")
			.then((contents) => {
				setExternalFile({ path: ref, contents, error: null, loading: false });
			})
			.catch((reason: unknown) => {
				setExternalFile({
					path: ref,
					contents: null,
					error: reason instanceof Error ? reason.message : String(reason),
					loading: false,
				});
			});
	};
	const changeViewMode = (next: FileViewMode) => {
		if (
			!selectedPath ||
			!selectedFile ||
			!isMarkdownPath(filePath(selectedFile))
		) {
			return;
		}
		setFileViewModes((current) => ({
			...current,
			[selectedPath]: next,
		}));
	};
	const changeWholeFile = (
		wholeFile: boolean,
		sourceLineCount: number | null,
	) => {
		if (!selectedPath || !selectedFile) return;
		if (wholeFile && sourceLineCount === null && fileContentsError === null) {
			setPendingWholeFilePaths((current) => ({
				...current,
				[selectedPath]: true,
			}));
			return;
		}
		if (!wholeFile && pendingWholeFilePaths[selectedPath]) {
			setPendingWholeFilePaths((current) => {
				const { [selectedPath]: _, ...remaining } = current;
				return remaining;
			});
		}
		if (
			wholeFile &&
			sourceLineCount !== null &&
			sourceLineCount > data.largeFileLineThreshold &&
			!confirmedWholeFilePaths[selectedPath]
		) {
			if (
				!window.confirm(
					`This file has ${sourceLineCount} lines. Show the whole file?`,
				)
			) {
				return;
			}
			setConfirmedWholeFilePaths((current) => ({
				...current,
				[selectedPath]: true,
			}));
		}
		setWholeFileModes((current) =>
			current[selectedPath] === wholeFile
				? current
				: { ...current, [selectedPath]: wholeFile },
		);
	};
	const saveProgress = (body: Record<string, unknown>) => {
		setProgressError(null);
		void fetch(apiUrl("/api/progress", token), {
			method: "POST",
			headers: { "content-type": "application/json", "X-Mole-Token": token },
			body: JSON.stringify(body),
		})
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Progress request failed (${response.status})`);
				return (await response.json()) as ReviewProgressResponse;
			})
			.then((next) => {
				setProgressError(null);
				setData((current) =>
					current
						? {
								...current,
								layers: next.layers,
								viewedFiles: next.viewedFiles,
							}
						: current,
				);
			})
			.catch((reason: unknown) => {
				setProgressError(
					reason instanceof Error ? reason.message : String(reason),
				);
			});
	};
	const createCommentDraft = (selection: DiffLineSelection) => {
		const target: LineSelection = {
			path: selection.path,
			side: selection.side,
			startLine: selection.startLine,
			endLine: selection.endLine,
		};
		setCommentError(null);
		void fetch(apiUrl("/api/comments/draft", token), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"X-Mole-Token": token,
			},
			body: JSON.stringify({
				selection: target,
				filePath: target.path,
			}),
		})
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Comment creation failed (${response.status})`);
				return (await response.json()) as Draft;
			})
			.then((draft) => {
				setData((current) =>
					current
						? { ...current, drafts: [...current.drafts, draft] }
						: current,
				);
			})
			.catch((reason: unknown) => {
				setCommentError(
					reason instanceof Error ? reason.message : String(reason),
				);
			});
	};

	const createMarkdownCommentDraft = (selection: MarkdownBlockSelection) => {
		setCommentError(null);
		void fetch(apiUrl("/api/comments/draft", token), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"X-Mole-Token": token,
			},
			body: JSON.stringify({
				selection: {
					kind: "markdown",
					path: selection.path,
					startLine: selection.startLine,
					endLine: selection.endLine,
					quote: selection.quote,
				},
				filePath: selection.path,
			}),
		})
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Comment creation failed (${response.status})`);
				return (await response.json()) as Draft;
			})
			.then((draft) => {
				setData((current) =>
					current
						? { ...current, drafts: [...current.drafts, draft] }
						: current,
				);
			})
			.catch((reason: unknown) => {
				setCommentError(
					reason instanceof Error ? reason.message : String(reason),
				);
			});
	};

	const updateCommentDraft = (id: string, body: string) => {
		const revision = (draftEditSequence.current.get(id) ?? 0) + 1;
		draftEditSequence.current.set(id, revision);
		setData((current) =>
			current
				? {
						...current,
						drafts: current.drafts.map((draft) =>
							draft.id === id
								? { ...draft, body, status: "draft", error: null }
								: draft,
						),
					}
				: current,
		);
		void fetch(apiUrl(`/api/comments/${encodeURIComponent(id)}`, token), {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				"X-Mole-Token": token,
			},
			body: JSON.stringify({ body }),
		})
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Comment update failed (${response.status})`);
				return (await response.json()) as Draft;
			})
			.then((updated) => {
				if (draftEditSequence.current.get(id) !== revision) return;
				setData((current) =>
					current
						? {
								...current,
								drafts: current.drafts.map((draft) =>
									draft.id === id ? updated : draft,
								),
							}
						: current,
				);
			})
			.catch((reason: unknown) => {
				if (draftEditSequence.current.get(id) !== revision) return;
				setCommentError(
					reason instanceof Error ? reason.message : String(reason),
				);
			});
	};

	const generateFromChat = (id: string) => {
		const chatId = activeChatId;
		if (!chatId) return;
		const existing = fromChatControllers.current.get(id);
		if (existing) {
			if (draftGenerations[id]?.status !== "failed") return;
			existing.abort();
			fromChatControllers.current.delete(id);
		}
		const controller = new AbortController();
		fromChatControllers.current.set(id, controller);
		setDraftGenerations((current) => ({
			...current,
			[id]: { status: "running" },
		}));

		const isCurrent = () => fromChatControllers.current.get(id) === controller;
		const clearGeneration = () => {
			if (!isCurrent()) return;
			setDraftGenerations((current) => {
				if (!(id in current)) return current;
				const next = { ...current };
				delete next[id];
				return next;
			});
		};
		const failGeneration = (message: string) => {
			if (!isCurrent()) return;
			setDraftGenerations((current) => ({
				...current,
				[id]: { status: "failed", error: message },
			}));
		};

		void (async () => {
			let done = false;
			let streamError: string | null = null;
			try {
				const response = await fetch(
					apiUrl(`/api/comments/${encodeURIComponent(id)}/from-chat`, token),
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							"X-Mole-Token": token,
							accept: "text/event-stream",
						},
						body: JSON.stringify({ chatId }),
						signal: controller.signal,
					},
				);
				await consumeSseResponse(response, (frame) => {
					const frameData =
						typeof frame.data === "object" && frame.data !== null
							? (frame.data as Record<string, unknown>)
							: null;
					if (
						frame.event === "error" &&
						typeof frameData?.message === "string"
					) {
						streamError = frameData.message;
						failGeneration(streamError);
					}
					if (frame.event !== "done" || !frameData) return;
					done = true;
					const status = frameData.status;
					if (status === "ok") {
						const nextDraft = frameData.draft;
						if (
							typeof nextDraft !== "object" ||
							nextDraft === null ||
							!isCurrent()
						) {
							if (isCurrent())
								failGeneration("Comment generation returned no draft");
							return;
						}
						draftEditSequence.current.set(
							id,
							(draftEditSequence.current.get(id) ?? 0) + 1,
						);
						setData((current) =>
							current
								? {
										...current,
										drafts: current.drafts.map((draft) =>
											draft.id === id ? (nextDraft as Draft) : draft,
										),
									}
								: current,
						);
						clearGeneration();
					} else if (status === "failed") {
						const message =
							typeof frameData.error === "string"
								? frameData.error
								: (streamError ?? "Comment generation failed");
						failGeneration(message);
					} else if (status === "stopped") {
						clearGeneration();
					}
				});
				if (!done && isCurrent()) {
					failGeneration(
						streamError ?? `Comment generation failed (${response.status})`,
					);
				}
			} catch (reason: unknown) {
				if (!isCurrent()) return;
				if (
					controller.signal.aborted ||
					(reason instanceof Error && reason.name === "AbortError")
				) {
					clearGeneration();
				} else {
					failGeneration(
						reason instanceof Error ? reason.message : String(reason),
					);
				}
			} finally {
				if (fromChatControllers.current.get(id) === controller) {
					fromChatControllers.current.delete(id);
				}
			}
		})();
	};

	const stopFromChat = (id: string) => {
		const controller = fromChatControllers.current.get(id);
		if (!controller) return;
		void fetch(
			apiUrl(`/api/comments/${encodeURIComponent(id)}/from-chat/cancel`, token),
			{
				method: "POST",
				headers: { "X-Mole-Token": token },
			},
		).catch(() => undefined);
		controller.abort();
		fromChatControllers.current.delete(id);
		setDraftGenerations((current) => {
			if (!(id in current)) return current;
			const next = { ...current };
			delete next[id];
			return next;
		});
	};

	const cancelCommentDraft = (id: string) => {
		const controller = fromChatControllers.current.get(id);
		if (controller) {
			controller.abort();
			fromChatControllers.current.delete(id);
		}
		setDraftGenerations((current) => {
			if (!(id in current)) return current;
			const next = { ...current };
			delete next[id];
			return next;
		});
		setData((current) =>
			current
				? {
						...current,
						drafts: current.drafts.filter((draft) => draft.id !== id),
					}
				: current,
		);
		void fetch(apiUrl(`/api/comments/${encodeURIComponent(id)}`, token), {
			method: "DELETE",
			headers: { "X-Mole-Token": token },
		})
			.then((response) => {
				if (!response.ok)
					throw new Error(`Comment cancel failed (${response.status})`);
			})
			.catch((reason: unknown) => {
				setCommentError(
					reason instanceof Error ? reason.message : String(reason),
				);
				void fetchReviewState().catch(() => undefined);
			});
	};

	const sendCommentDraft = (id: string) => {
		setCommentError(null);
		setData((current) =>
			current
				? {
						...current,
						drafts: current.drafts.map((draft) =>
							draft.id === id
								? { ...draft, status: "sending", error: null }
								: draft,
						),
					}
				: current,
		);
		void (async () => {
			let postedDiscussion: HostDiscussion | null = null;
			let streamError: string | null = null;
			try {
				const response = await fetch(
					apiUrl(`/api/comments/${encodeURIComponent(id)}/send`, token),
					{
						method: "POST",
						headers: {
							accept: "text/event-stream",
							"X-Mole-Token": token,
						},
					},
				);
				await consumeSseResponse(response, (frame) => {
					if (
						frame.event === "error" &&
						typeof frame.data === "object" &&
						frame.data !== null &&
						typeof (frame.data as Record<string, unknown>).message === "string"
					) {
						streamError = (frame.data as Record<string, unknown>)
							.message as string;
					}
					if (
						frame.event === "done" &&
						typeof frame.data === "object" &&
						frame.data !== null
					) {
						const discussion = (frame.data as Record<string, unknown>)
							.discussion;
						if (discussion && typeof discussion === "object")
							postedDiscussion = discussion as HostDiscussion;
					}
				});
				await fetchReviewState();
				if (postedDiscussion) {
					setData((current) =>
						current &&
						!current.discussions.some(
							(discussion) => discussion.id === postedDiscussion?.id,
						)
							? {
									...current,
									discussions: [...current.discussions, postedDiscussion],
								}
							: current,
					);
				}
				if (!response.ok)
					throw new Error(
						streamError ?? `Comment send failed (${response.status})`,
					);
			} catch (reason: unknown) {
				setCommentError(
					reason instanceof Error ? reason.message : String(reason),
				);
				try {
					await fetchReviewState();
				} catch {
					// Draft error from the route remains visible if refresh is unavailable.
				}
			}
		})();
	};

	const retryCommentDraft = (id: string) => {
		sendCommentDraft(id);
	};

	const runLayerAction = (action: LayerAction): Promise<void> => {
		if (layerAction !== null) return Promise.resolve();
		setLayerAction(action);
		return consumeLayerStream(token, action, (frame) => {
			setData((current) =>
				current ? mergeLayerStreamFrame(current, frame) : current,
			);
		})
			.then(() => fetchReviewState())
			.catch((reason: unknown) => {
				const message =
					reason instanceof Error ? reason.message : String(reason);
				setData((current) =>
					current
						? {
								...current,
								layerStatus: "failed",
								layerError: message,
							}
						: current,
				);
			})
			.finally(() => setLayerAction(null))
			.then(() => undefined);
	};
	const refreshReview = () => {
		if (
			refreshing ||
			syncing ||
			syncingRef.current ||
			whitespaceChanging ||
			whitespaceChangingRef.current ||
			layerAction !== null
		)
			return;
		autoRunRequested.current = true;
		setRefreshing(true);
		void runReviewRefresh({
			checkFreshness: () => fetchFreshness(token),
			sync: syncReviewState,
			regenerate: () => runLayerAction("regenerate"),
			applyFreshness: (next) => setFreshness(next),
			applySyncedState: (next) => {
				setData(next);
				setFreshness({
					stale: false,
					headSha: next.revision.headSha,
					newCommitCount: 0,
				});
			},
		})
			.catch((reason: unknown) => {
				pushToast({
					kind: "error",
					message: errorToastMessage(reason),
				});
			})
			.finally(() => setRefreshing(false));
	};

	const syncReviewState = async (): Promise<ReviewStateResponse> => {
		if (
			syncing ||
			syncingRef.current ||
			whitespaceChanging ||
			whitespaceChangingRef.current ||
			layerAction !== null
		)
			throw new Error(
				"Review sync unavailable while another update is in progress",
			);
		const mutation = reviewStateRequests.current.beginMutation();
		syncingRef.current = true;
		setSyncing(true);
		try {
			const response = await fetch(apiUrl("/api/sync", token), {
				method: "POST",
				headers: { "X-Mole-Token": token },
			});
			if (!response.ok)
				throw new Error(`Sync request failed (${response.status})`);
			return (await response.json()) as ReviewStateResponse;
		} finally {
			reviewStateRequests.current.finishMutation(mutation);
			syncingRef.current = false;
			setSyncing(false);
		}
	};

	const selectLayer = (id: string) => {
		const layer = data.layers.find((candidate) => candidate.id === id);
		if (!layer) return;
		const firstFile = layer.files.find((path) => files.includes(path));
		if (firstFile) selectFile(firstFile);
	};
	const handleChatFrame = (chatId: string, frame: ChatStreamFrame) => {
		if (
			frame.event === "text" &&
			typeof frame.data === "object" &&
			frame.data !== null &&
			typeof (frame.data as Record<string, unknown>).text === "string"
		) {
			const text = (frame.data as Record<string, unknown>).text as string;
			if (text.length === 0) return;
			patchChat(chatId, (current) => {
				const streamingSegments = [...current.streamingSegments];
				const lastIndex = streamingSegments.length - 1;
				if (lastIndex < 0) streamingSegments.push(text);
				else
					streamingSegments[lastIndex] =
						`${streamingSegments[lastIndex]}${text}`;
				return { streamingSegments };
			});
			return;
		}
		if (
			frame.event === "tool" &&
			typeof frame.data === "object" &&
			frame.data !== null
		) {
			const tool = frame.data as Record<string, unknown>;
			if (
				typeof tool.name !== "string" ||
				(tool.phase !== "start" && tool.phase !== "end")
			) {
				return;
			}
			patchChat(chatId, (current) => {
				const streamingSegments =
					current.streamingSegments.length === 0 ||
					current.streamingSegments.at(-1)?.length !== 0
						? [...current.streamingSegments, ""]
						: current.streamingSegments;
				if (tool.phase === "start") {
					chatToolSequence.current += 1;
					return {
						streamingSegments,
						tools: [
							...current.tools,
							{
								id: chatToolSequence.current,
								name: tool.name as string,
								phase: "start",
							},
						],
					};
				}
				const index = current.tools.findLastIndex(
					(item) => item.name === tool.name && item.phase === "start",
				);
				if (index < 0) {
					chatToolSequence.current += 1;
					return {
						streamingSegments,
						tools: [
							...current.tools,
							{
								id: chatToolSequence.current,
								name: tool.name as string,
								phase: "end",
							},
						],
					};
				}
				return {
					streamingSegments,
					tools: current.tools.map((item, itemIndex) =>
						itemIndex === index ? { ...item, phase: "end" } : item,
					),
				};
			});
			return;
		}
		if (
			frame.event === "error" &&
			typeof frame.data === "object" &&
			frame.data !== null
		) {
			const message = (frame.data as Record<string, unknown>).message;
			if (typeof message === "string") patchChat(chatId, { error: message });
		}
	};
	const startChatTurn = (chatId: string, message: string, tags: ChatTag[]) => {
		const controller = new AbortController();
		chatControllers.current.set(chatId, controller);
		chatHistoryRequests.current.next(chatId);
		const sessionId =
			data.chats.find((chat) => chat.id === chatId)?.sessionId ?? null;
		patchChat(chatId, {
			error: null,
			streamingSegments: [],
			tools: [],
			tags: [],
			draft: "",
			sending: true,
			stopping: false,
		});
		patchChat(chatId, (current) => ({
			entries: [
				...current.entries,
				{
					role: "user",
					text: message,
					tags,
					at: new Date().toISOString(),
					sessionId,
					partial: false,
				},
			],
		}));
		void consumeChatStream(
			token,
			{ chatId, message, tags, openFile: selectedPath },
			(frame) => handleChatFrame(chatId, frame),
			controller.signal,
		)
			.then(async () => {
				const historyRequestId = chatHistoryRequests.current.next(chatId);
				const [entries] = await Promise.all([
					fetchChatHistory(token, chatId),
					fetchReviewState(),
				]);
				if (chatHistoryRequests.current.isCurrent(chatId, historyRequestId))
					patchChat(chatId, {
						entries,
						loaded: true,
						streamingSegments: [],
					});
			})
			.catch((reason: unknown) => {
				if (controller.signal.aborted) return;
				patchChat(chatId, {
					error: reason instanceof Error ? reason.message : String(reason),
				});
			})
			.finally(() => {
				if (chatControllers.current.get(chatId) === controller)
					chatControllers.current.delete(chatId);
				patchChat(chatId, { sending: false, stopping: false });
			});
	};
	const handleChatSend = (message: string) => {
		const chatId = activeChatId;
		if (
			!chatId ||
			activeChat.sending ||
			activeChatBusy ||
			chatControllers.current.has(chatId)
		)
			return false;
		startChatTurn(chatId, message, [...activeChat.tags]);
		return true;
	};
	const handleChatStop = () => {
		const chatId = activeChatId;
		const summary = chatSummaries.find((chat) => chat.id === chatId);
		if (!chatId || !summary?.busy || activeChat.stopping) return;
		patchChat(chatId, { stopping: true });
		void fetch(apiUrl("/api/chat/cancel", token), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"X-Mole-Token": token,
			},
			body: JSON.stringify({ chatId }),
		})
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Chat cancel request failed (${response.status})`);
				await fetchReviewState();
				patchChat(chatId, { stopping: false });
			})
			.catch((reason: unknown) => {
				patchChat(chatId, {
					stopping: false,
					error: reason instanceof Error ? reason.message : String(reason),
				});
			});
	};
	const handleNewChat = () => {
		if (creatingChat) return;
		setCreatingChat(true);
		void fetch(apiUrl("/api/chats", token), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"X-Mole-Token": token,
			},
		})
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Create chat request failed (${response.status})`);
				return (await response.json()) as {
					chats: ReviewStateResponse["chats"];
					activeChatId: string | null;
				};
			})
			.then((next) => {
				const newChatId =
					next.activeChatId ?? next.chats[next.chats.length - 1]?.id;
				if (!newChatId) throw new Error("Create chat response had no chat");
				setData((current) =>
					current
						? {
								...current,
								chats: next.chats,
								activeChatId: next.activeChatId,
							}
						: current,
				);
				patchChat(newChatId, { ...EMPTY_CHAT_RUNTIME, loaded: true });
				setSelectedChatId(newChatId);
			})
			.catch((reason: unknown) => {
				const message =
					reason instanceof Error ? reason.message : String(reason);
				if (activeChatId) patchChat(activeChatId, { error: message });
				else setError(message);
			})
			.finally(() => setCreatingChat(false));
	};
	const explainDiscussion = (discussionId: string) => {
		if (creatingChat) return;
		setCreatingChat(true);
		void fetch(apiUrl("/api/comments/explain", token), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"X-Mole-Token": token,
			},
			body: JSON.stringify({ discussionId }),
		})
			.then(async (response) => {
				const value: unknown = await response.json().catch(() => null);
				if (!response.ok) {
					const serverError =
						typeof value === "object" &&
						value !== null &&
						typeof (value as Record<string, unknown>).error === "string"
							? ((value as Record<string, unknown>).error as string)
							: null;
					throw new Error(
						serverError ?? `Explain request failed (${response.status})`,
					);
				}
				return value as {
					chatId: string;
					chats: ReviewStateResponse["chats"];
					activeChatId: string | null;
					message: string;
				};
			})
			.then((next) => {
				setData((current) =>
					current
						? {
								...current,
								chats: next.chats,
								activeChatId: next.activeChatId,
							}
						: current,
				);
				patchChat(next.chatId, { ...EMPTY_CHAT_RUNTIME, loaded: true });
				setSelectedChatId(next.chatId);
				startChatTurn(next.chatId, next.message, []);
			})
			.catch((reason: unknown) => {
				const message =
					reason instanceof Error ? reason.message : String(reason);
				if (activeChatId) patchChat(activeChatId, { error: message });
				else setError(message);
			})
			.finally(() => setCreatingChat(false));
	};
	const handleSelectChat = (chatId: string) => {
		if (!data.chats.some((chat) => chat.id === chatId)) return;
		setSelectedChatId(chatId);
		const requestId = chatSelectionRequests.current.next("active-chat");
		const persistSelection = async () => {
			const response = await fetch(apiUrl("/api/chats/active", token), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"X-Mole-Token": token,
				},
				body: JSON.stringify({ chatId }),
			});
			if (!response.ok)
				throw new Error(`Select chat request failed (${response.status})`);
		};
		chatSelectionQueue.current = chatSelectionQueue.current
			.catch(() => undefined)
			.then(persistSelection)
			.catch((reason: unknown) => {
				if (!chatSelectionRequests.current.isCurrent("active-chat", requestId))
					return;
				patchChat(chatId, {
					error: reason instanceof Error ? reason.message : String(reason),
				});
			});
	};
	const handleLineSelection = (selection: DiffLineSelection) => {
		if (!activeChatId) return;
		patchChat(activeChatId, (current) => ({
			tags: current.tags.some((tag) => chatTagsEqual(tag, selection))
				? current.tags
				: [...current.tags, selection],
		}));
	};
	const handleMarkdownTag = (selection: MarkdownBlockSelection) => {
		if (!activeChatId) return;
		const tag: ChatTag = {
			kind: "markdown",
			path: selection.path,
			startLine: selection.startLine,
			endLine: selection.endLine,
			quote: selection.quote,
		};
		patchChat(activeChatId, (current) => ({
			tags: current.tags.some((candidate) => chatTagsEqual(candidate, tag))
				? current.tags
				: [...current.tags, tag],
		}));
	};
	const handleFileTag = (path: string) => {
		if (!activeChatId) return;
		const tag: ChatTag = { kind: "file", path };
		patchChat(activeChatId, (current) => ({
			tags: current.tags.some((candidate) => chatTagsEqual(candidate, tag))
				? current.tags
				: [...current.tags, tag],
		}));
	};
	const removeChatTag = (tag: ChatTag) => {
		if (!activeChatId) return;
		patchChat(activeChatId, (current) => ({
			tags: current.tags.filter((candidate) => !chatTagsEqual(candidate, tag)),
		}));
	};
	const clearTags = () => {
		if (activeChatId) patchChat(activeChatId, { tags: [] });
	};
	const leftColumnMaximum = maximumColumnWidth("left");
	const rightColumnMaximum = maximumColumnWidth("right");
	const reviewShellStyle = {
		"--left-column-width": `${columnWidths.left}px`,
		"--right-column-width": `${columnWidths.right}px`,
	} as CSSProperties;

	return (
		<main
			className="grid h-screen w-screen min-h-0 min-w-0 grid-cols-[var(--left-column-width)_auto_minmax(480px,1fr)_auto_var(--right-column-width)] overflow-hidden bg-background text-foreground"
			ref={reviewShell}
			style={reviewShellStyle}
		>
			<LayerPane
				state={data}
				files={files}
				selectedPath={selectedPath}
				onSelectFile={selectFile}
				onSelectLayer={selectLayer}
				onToggleDone={(id, done) => saveProgress({ layerId: id, done })}
				layerAction={layerAction}
				actionError={progressError}
				externallyDisabled={refreshing}
				onRegenerate={() => runLayerAction("regenerate")}
				onRetry={() => runLayerAction("retry")}
			/>
			<hr
				aria-label="Resize review layers column"
				aria-orientation="vertical"
				aria-valuemax={leftColumnMaximum}
				aria-valuemin={columnMinimums.left}
				aria-valuenow={columnWidths.left}
				className="m-0 h-full w-1 cursor-col-resize border-0 bg-border transition-colors duration-150 hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none"
				onKeyDown={(event) => handleSplitterKeyDown(event, "left")}
				onPointerCancel={stopResizing}
				onPointerDown={(event) => handleSplitterPointerDown(event, "left")}
				onPointerMove={handleSplitterPointerMove}
				onPointerUp={stopResizing}
				tabIndex={0}
			/>
			<section className="flex min-h-0 min-w-0 flex-col">
				<div className="flex min-h-0 max-h-[40vh] shrink-0 flex-col border-b bg-sidebar">
					<MrHeader
						mr={data.mr}
						headSha={data.revision.headSha}
						filesChanged={changedFileTotal}
						insertions={lineTotals.insertions}
						deletions={lineTotals.deletions}
						approval={data.approval ?? null}
						approvalLoading={approvalLoading}
						approvalAction={approvalAction}
						onApprovalAction={handleApprovalAction}
						freshness={freshness}
						refreshing={refreshing}
						layerGenerating={layerAction !== null}
						onRefresh={refreshReview}
					/>
					<Toasts toasts={toasts} onDismiss={dismissToast} />
					<ChangedFiles
						files={data.diff}
						viewedFiles={data.viewedFiles}
						selectedPath={selectedPath}
						onSelectFile={selectFile}
						onViewedChange={(paths, viewed) => {
							saveProgress({
								viewedFiles: { paths, viewed },
							});
						}}
						showWhitespaceChanges={data.showWhitespaceChanges}
						whitespaceChanging={whitespaceChanging}
						syncing={syncing}
						refreshing={refreshing}
						onShowWhitespaceChangesChange={handleShowWhitespaceChangesChange}
					/>
				</div>
				<DiffView
					key={selectedPath ?? "empty"}
					file={selectedFile}
					mode={diffMode}
					viewMode={selectedViewMode}
					largeFileLineThreshold={data.largeFileLineThreshold}
					fileContents={fileContents}
					fileContentsError={fileContentsError}
					discussions={data.discussions}
					onExplainDiscussion={explainDiscussion}
					explainDisabled={creatingChat}
					drafts={data.drafts}
					onModeChange={setDiffMode}
					wholeFile={selectedWholeFile}
					onWholeFileChange={changeWholeFile}
					onViewModeChange={changeViewMode}
					viewed={
						selectedPath !== null && data.viewedFiles.includes(selectedPath)
					}
					onViewedChange={(viewed) => {
						if (selectedPath === null) return;
						saveProgress({
							viewedFile: { path: selectedPath, viewed },
						});
					}}
					onExpandDiff={(file) => fetchExpandedDiff(token, filePath(file))}
					onLineSelection={handleLineSelection}
					onCommentSelection={createCommentDraft}
					onMarkdownTag={handleMarkdownTag}
					onFileTag={handleFileTag}
					onMarkdownComment={createMarkdownCommentDraft}
					onCancelDraft={cancelCommentDraft}
					onEditDraft={updateCommentDraft}
					onSendDraft={sendCommentDraft}
					onRetryDraft={retryCommentDraft}
					fromChat={{
						availability: activeFromChatAvailability,
						generations: draftGenerations,
						onGenerate: generateFromChat,
						onStop: stopFromChat,
					}}
				/>
			</section>
			<hr
				aria-label="Resize chat column"
				aria-orientation="vertical"
				aria-valuemax={rightColumnMaximum}
				aria-valuemin={columnMinimums.right}
				aria-valuenow={columnWidths.right}
				className="m-0 h-full w-1 cursor-col-resize border-0 bg-border transition-colors duration-150 hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none"
				onKeyDown={(event) => handleSplitterKeyDown(event, "right")}
				onPointerCancel={stopResizing}
				onPointerDown={(event) => handleSplitterPointerDown(event, "right")}
				onPointerMove={handleSplitterPointerMove}
				onPointerUp={stopResizing}
				tabIndex={0}
			/>
			<ChatPane
				transcript={activeChat.entries}
				tags={activeChat.tags}
				discussions={generalDiscussions(data.discussions)}
				onExplainDiscussion={explainDiscussion}
				explainDisabled={creatingChat}
				streamingSegments={activeChat.streamingSegments}
				tools={activeChat.tools}
				error={activeChat.error ?? commentError}
				sending={activeChat.sending}
				busy={activeChatBusy}
				stopping={activeChat.stopping}
				chats={chatSummaries}
				activeChatId={activeChatId}
				onSelectChat={handleSelectChat}
				onNewChat={handleNewChat}
				onOpenSettings={() => setSettingsOpen(true)}
				creatingChat={creatingChat}
				draft={activeChat.draft}
				onDraftChange={(value) => {
					if (activeChatId) patchChat(activeChatId, { draft: value });
				}}
				onSend={handleChatSend}
				onStop={handleChatStop}
				onRemoveTag={removeChatTag}
				onClearTags={clearTags}
				onOpenFileRef={openFileRef}
			/>
			<Dialog
				open={externalFile !== null}
				onOpenChange={(open) => {
					if (!open) setExternalFile(null);
				}}
			>
				<DialogContent
					className="w-[min(92vw,56rem)] max-w-none"
					showCloseButton={false}
				>
					{externalFile ? (
						<>
							<DialogHeader>
								<DialogTitle className="font-mono text-sm">
									{externalFile.path}
								</DialogTitle>
							</DialogHeader>
							<DialogClose
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="absolute top-4 right-4 bg-secondary"
										aria-label="Close file preview"
									>
										<X aria-hidden />
										<span className="sr-only">Close file preview</span>
									</Button>
								}
							/>
							{externalFile.loading ? (
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" aria-hidden />
									<span>Loading {externalFile.path}…</span>
								</div>
							) : null}
							{externalFile.error ? (
								<Alert variant="destructive">
									Couldn't open {externalFile.path}: {externalFile.error}
								</Alert>
							) : null}
							{externalFile.contents !== null ? (
								<pre className="max-h-[70vh] overflow-auto rounded-md border bg-card p-4 font-mono text-[13px]">
									{externalFile.contents}
								</pre>
							) : null}
						</>
					) : null}
				</DialogContent>
			</Dialog>
			<Dialog
				open={settingsOpen}
				onOpenChange={(open) => {
					if (!open) setSettingsOpen(false);
				}}
			>
				<DialogContent className="h-[min(calc(100dvh-2rem),56rem)] w-[min(calc(100vw-2rem),64rem)] max-w-none grid-rows-[minmax(0,1fr)] overflow-hidden p-0 sm:max-w-none">
					<DialogHeader className="sr-only">
						<DialogTitle>Settings</DialogTitle>
					</DialogHeader>
					<SettingsPanel token={token} onClose={() => setSettingsOpen(false)} />
				</DialogContent>
			</Dialog>
		</main>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("Review UI root is missing");
const reviewRoot = root;
void bootColorTheme(tokenFromLocation(), () => {
	createRoot(reviewRoot).render(<ReviewApp />);
});
