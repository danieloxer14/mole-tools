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
import type { ParsedFileDiff } from "../../../shared/diff-parse";
import { type ChatTag, chatTagsEqual } from "../chat-tags";
import type { ReviewApiState } from "../routes";
import type { Draft, LineSelection } from "../state";
import type { ChatEntry } from "../store";
import {
	clampColumnWidth,
	initialColumnWidth,
	type ReviewColumn,
} from "./column-resize";
import type { ApprovalAction } from "./components/ApprovalControls";
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
import { SyncBanner } from "./components/SyncBanner";
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
interface ReviewFreshnessResponse {
	stale: boolean;
	headSha: string;
	newCommitCount: number;
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
	streamingText: string;
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
	streamingText: "",
	tools: [],
	error: null,
	sending: false,
	stopping: false,
	loaded: false,
};

type ChatRuntimePatch =
	| Partial<ChatRuntime>
	| ((current: ChatRuntime) => Partial<ChatRuntime>);

function ReviewApp() {
	const token = useMemo(tokenFromLocation, []);
	const [data, setData] = useState<ReviewStateResponse | null>(null);

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
	const [fileContents, setFileContents] = useState<string | null>(null);
	const [fileContentsError, setFileContentsError] = useState<string | null>(
		null,
	);
	const [externalFile, setExternalFile] = useState<ExternalFilePreview | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [approvalLoading, setApprovalLoading] = useState(true);
	const [approvalAction, setApprovalAction] = useState<ApprovalAction | null>(
		null,
	);
	const [approvalError, setApprovalError] = useState<string | null>(null);
	const [freshness, setFreshness] = useState<ReviewFreshnessResponse | null>(
		null,
	);
	const [refreshing, setRefreshing] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [regenerateAfterSync, setRegenerateAfterSync] = useState(false);
	const [syncError, setSyncError] = useState<string | null>(null);
	const [layerAction, setLayerAction] = useState<LayerAction | null>(null);
	const [progressError, setProgressError] = useState<string | null>(null);
	const [chatRuntimes, setChatRuntimes] = useState<Record<string, ChatRuntime>>(
		{},
	);
	const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
	const [creatingChat, setCreatingChat] = useState(false);
	const [commentError, setCommentError] = useState<string | null>(null);
	const chatControllers = useRef(new Map<string, AbortController>());
	const chatToolSequence = useRef(0);
	const autoRunRequested = useRef(false);
	const syncCompleted = useRef(false);
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
					setSyncError(null);
				}
			})
			.catch((reason: unknown) => {
				if (active) {
					setSyncError(
						reason instanceof Error ? reason.message : String(reason),
					);
				}
			});
		void fetchState(token)
			.then((next) => {
				if (!active) return;
				setData(next);
				const first = next.diff[0];
				if (first) {
					setSelectedPath(filePath(first));
				}
				if (
					next.layerStatus === "pending" &&
					!autoRunRequested.current &&
					!syncCompleted.current &&
					next.layers.every((layer) => !layer.stale)
				) {
					autoRunRequested.current = true;
					setLayerAction("regenerate");
					void consumeLayerStream(token, "regenerate", applyFrame)
						.then(() => fetchState(token))
						.then((latest) => {
							if (active) setData(latest);
						})
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
	}, [token]);
	const reviewLoaded = data !== null;
	useEffect(() => {
		if (!token || !reviewLoaded) return;
		let active = true;
		setApprovalLoading(true);
		setApprovalError(null);
		void fetchApproval(token)
			.then((next) => {
				if (!active) return;
				setData((current) =>
					current ? { ...current, approval: next } : current,
				);
			})
			.catch((reason: unknown) => {
				if (active) {
					setApprovalError(
						reason instanceof Error ? reason.message : String(reason),
					);
				}
			})
			.finally(() => {
				if (active) setApprovalLoading(false);
			});
		return () => {
			active = false;
		};
	}, [token, reviewLoaded]);
	const activeChatId = selectedChatId ?? data?.activeChatId ?? null;
	const activeChat = activeChatId
		? (chatRuntimes[activeChatId] ?? EMPTY_CHAT_RUNTIME)
		: EMPTY_CHAT_RUNTIME;
	const chatSummaries: ChatSummary[] = (data?.chats ?? []).map((chat) => ({
		id: chat.id,
		title: chat.title,
		createdAt: chat.createdAt,
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

	useEffect(() => {
		if (!activeChatId || activeChatLoaded) return;
		const chatId = activeChatId;
		void fetchChatHistory(token, chatId)
			.then((entries) => {
				patchChat(chatId, { entries, loaded: true, error: null });
			})
			.catch((reason: unknown) => {
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
				const latest = await fetchState(token);
				const chatIds = [
					...new Set([...runningChatIds, ...latest.busyChatIds]),
				];
				await Promise.all(
					chatIds.map(async (chatId) => {
						try {
							const entries = await fetchChatHistory(token, chatId);
							if (active) patchChat(chatId, { entries, loaded: true });
						} catch {
							// Keep polling; a transient history failure must not hide
							// the eventual assistant entry.
						}
					}),
				);
				if (!active) return;
				setData(latest);
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
	}, [token, busyChatIds, patchChat]);

	const selectedFile =
		data?.diff.find((file) => filePath(file) === selectedPath) ?? null;
	const selectedViewMode =
		selectedFile && selectedPath && isMarkdownPath(filePath(selectedFile))
			? (fileViewModes[selectedPath] ?? defaultFileViewMode(selectedFile))
			: "diff";

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

	if (error)
		return (
			<main className="review-error">
				<h1>Review unavailable</h1>
				<p>{error}</p>
			</main>
		);
	if (!data) return <main className="review-loading">Loading review...</main>;
	const handleApprovalAction = (action: ApprovalAction) => {
		if (approvalAction !== null) return;
		setApprovalAction(action);
		setApprovalError(null);
		void updateApproval(token, action)
			.then((next) => {
				setData((current) =>
					current ? { ...current, approval: next } : current,
				);
			})
			.catch((reason: unknown) => {
				setApprovalError(
					reason instanceof Error ? reason.message : String(reason),
				);
			})
			.finally(() => setApprovalAction(null));
	};

	const files = data.diff.map(filePath).filter((path) => path.length > 0);
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
				return (await response.json()) as ReviewStateResponse;
			})
			.then((next) => {
				setProgressError(null);
				setData(next);
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

	const cancelCommentDraft = (id: string) => {
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
				void fetchState(token)
					.then(setData)
					.catch(() => undefined);
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
				const latest = await fetchState(token);
				if (
					postedDiscussion &&
					!latest.discussions.some(
						(discussion) => discussion.id === postedDiscussion?.id,
					)
				) {
					latest.discussions = [...latest.discussions, postedDiscussion];
				}
				setData(latest);
				if (!response.ok)
					throw new Error(
						streamError ?? `Comment send failed (${response.status})`,
					);
			} catch (reason: unknown) {
				setCommentError(
					reason instanceof Error ? reason.message : String(reason),
				);
				try {
					setData(await fetchState(token));
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
			.then(() => fetchState(token))
			.then(setData)
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
	const refreshHead = () => {
		if (refreshing || syncing || layerAction !== null) return;
		setRefreshing(true);
		setSyncError(null);
		void fetchFreshness(token)
			.then((next) => {
				setFreshness(next);
			})
			.catch((reason: unknown) => {
				setSyncError(reason instanceof Error ? reason.message : String(reason));
			})
			.finally(() => setRefreshing(false));
	};

	const syncReviewState = () => {
		if (syncing || layerAction !== null) return;
		syncCompleted.current = true;
		setSyncing(true);
		setSyncError(null);
		void fetch(apiUrl("/api/sync", token), {
			method: "POST",
			headers: { "X-Mole-Token": token },
		})
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Sync request failed (${response.status})`);
				return (await response.json()) as ReviewStateResponse;
			})
			.then(async (next) => {
				setData(next);
				setFreshness({
					stale: false,
					headSha: next.revision.headSha,
					newCommitCount: 0,
				});
				if (regenerateAfterSync) await runLayerAction("regenerate");
			})
			.catch((reason: unknown) => {
				setSyncError(reason instanceof Error ? reason.message : String(reason));
			})
			.finally(() => setSyncing(false));
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
			patchChat(chatId, (current) => ({
				streamingText: `${current.streamingText}${text}`,
			}));
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
				if (tool.phase === "start") {
					chatToolSequence.current += 1;
					return {
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
	const handleChatSend = (message: string) => {
		const chatId = activeChatId;
		if (!chatId || activeChat.sending || activeChatBusy) return;
		const tags = [...activeChat.tags];
		const controller = new AbortController();
		chatControllers.current.set(chatId, controller);
		const sessionId =
			data.chats.find((chat) => chat.id === chatId)?.sessionId ?? null;
		patchChat(chatId, {
			error: null,
			streamingText: "",
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
				const [entries, latest] = await Promise.all([
					fetchChatHistory(token, chatId),
					fetchState(token),
				]);
				patchChat(chatId, {
					entries,
					loaded: true,
					streamingText: "",
				});
				setData(latest);
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
				const latest = await fetchState(token);
				setData(latest);
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
	const handleSelectChat = (chatId: string) => {
		if (!data.chats.some((chat) => chat.id === chatId)) return;
		setSelectedChatId(chatId);
		void fetch(apiUrl("/api/chats/active", token), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"X-Mole-Token": token,
			},
			body: JSON.stringify({ chatId }),
		})
			.then((response) => {
				if (!response.ok)
					throw new Error(`Select chat request failed (${response.status})`);
			})
			.catch((reason: unknown) => {
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
		<main className="review-shell" ref={reviewShell} style={reviewShellStyle}>
			<LayerPane
				state={data}
				files={files}
				selectedPath={selectedPath}
				onSelectFile={selectFile}
				onSelectLayer={selectLayer}
				onToggleDone={(id, done) => saveProgress({ layerId: id, done })}
				layerAction={layerAction}
				actionError={progressError}
				onRegenerate={() => runLayerAction("regenerate")}
				onRetry={() => runLayerAction("retry")}
				approval={data.approval ?? null}
				approvalLoading={approvalLoading}
				approvalAction={approvalAction}
				approvalError={approvalError}
				onApprovalAction={handleApprovalAction}
			/>
			<hr
				aria-label="Resize review layers column"
				aria-orientation="vertical"
				aria-valuemax={leftColumnMaximum}
				aria-valuemin={columnMinimums.left}
				aria-valuenow={columnWidths.left}
				className="column-splitter column-splitter-left"
				onKeyDown={(event) => handleSplitterKeyDown(event, "left")}
				onPointerCancel={stopResizing}
				onPointerDown={(event) => handleSplitterPointerDown(event, "left")}
				onPointerMove={handleSplitterPointerMove}
				onPointerUp={stopResizing}
				tabIndex={0}
			/>
			<section className="centre-column">
				<div className="file-tree-panel">
					<SyncBanner
						stale={freshness?.stale ?? false}
						newCommitCount={freshness?.newCommitCount ?? 0}
						refreshing={refreshing}
						syncing={syncing}
						layerGenerating={layerAction !== null}
						regenerateAfterSync={regenerateAfterSync}
						onRefresh={refreshHead}
						onSync={syncReviewState}
						onRegenerateAfterSyncChange={setRegenerateAfterSync}
					/>
					{syncError ? (
						<p className="layer-error" role="alert">
							{syncError}
						</p>
					) : null}
					<header className="file-tree-header">
						<strong>Changed files</strong>
						<span>{files.length} files</span>
					</header>
					<nav className="file-tree" aria-label="Changed files">
						{data.diff.map((file) => {
							const path = filePath(file);
							return (
								<div
									className={`file-row ${path === selectedPath ? "selected" : ""}`}
									key={path}
								>
									<button type="button" onClick={() => selectFile(path)}>
										{path}
									</button>
									<span className="file-stats">
										<span className="file-additions">+{file.insertions}</span>
										<span className="file-deletions">−{file.deletions}</span>
									</span>
									<label title="Mark file viewed">
										<input
											type="checkbox"
											checked={data.viewedFiles.includes(path)}
											onChange={(event) =>
												saveProgress({
													viewedFile: { path, viewed: event.target.checked },
												})
											}
										/>
										Viewed
									</label>
								</div>
							);
						})}
					</nav>
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
					drafts={data.drafts}
					onModeChange={setDiffMode}
					onViewModeChange={changeViewMode}
					onExpandDiff={(file) => fetchExpandedDiff(token, filePath(file))}
					onLineSelection={handleLineSelection}
					onCommentSelection={createCommentDraft}
					onMarkdownTag={handleMarkdownTag}
					onMarkdownComment={createMarkdownCommentDraft}
					onCancelDraft={cancelCommentDraft}
					onEditDraft={updateCommentDraft}
					onSendDraft={sendCommentDraft}
					onRetryDraft={retryCommentDraft}
				/>
			</section>
			<hr
				aria-label="Resize chat column"
				aria-orientation="vertical"
				aria-valuemax={rightColumnMaximum}
				aria-valuemin={columnMinimums.right}
				aria-valuenow={columnWidths.right}
				className="column-splitter column-splitter-right"
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
				discussions={data.discussions.filter(
					(discussion) => discussion.position === null,
				)}
				streamingText={activeChat.streamingText}
				tools={activeChat.tools}
				error={activeChat.error ?? commentError}
				sending={activeChat.sending}
				busy={activeChatBusy}
				stopping={activeChat.stopping}
				chats={chatSummaries}
				activeChatId={activeChatId}
				onSelectChat={handleSelectChat}
				onNewChat={handleNewChat}
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
			{externalFile ? (
				<div className="file-preview-overlay">
					<div className="file-preview-panel">
						<header className="file-preview-header">
							<code>{externalFile.path}</code>
							<button
								type="button"
								onClick={() => setExternalFile(null)}
								aria-label="Close file preview"
							>
								×
							</button>
						</header>
						{externalFile.loading ? (
							<p className="placeholder">Loading {externalFile.path}...</p>
						) : null}
						{externalFile.error ? (
							<p className="render-error">
								Couldn't open {externalFile.path}: {externalFile.error}
							</p>
						) : null}
						{externalFile.contents !== null ? (
							<pre className="file-preview-contents">
								{externalFile.contents}
							</pre>
						) : null}
					</div>
				</div>
			) : null}
		</main>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("Review UI root is missing");
createRoot(root).render(<ReviewApp />);
