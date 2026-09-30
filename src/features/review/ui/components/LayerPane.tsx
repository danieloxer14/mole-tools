import { cn } from "cn";
import { Check, ChevronDown, Loader2, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdownHtml } from "../../../../shared/markdown";
import type { ReviewState } from "../../state";
import {
	IMPORTANCE_BG_CLASS,
	type ImportanceRating,
	type ImportanceReviewProgress,
	importanceTitle,
} from "../importance";
import { changedFileCount, viewedFileCount } from "./ChangedFilesHeader";
import { IconButton } from "./IconButton";
import { ImportanceProgressBar } from "./ImportanceProgressBar";
import { ProgressBar } from "./ProgressBar";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type LayerAction = "regenerate" | "retry";

interface LayerPaneProps {
	state: ReviewState;
	files: string[];
	filesContent: ReactNode;
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
	onSelectLayer: (id: string) => void;
	onToggleDone: (id: string, done: boolean) => void;
	layerAction: LayerAction | null;
	actionError: string | null;
	externallyDisabled: boolean;
	onRegenerate: () => void;
	onRetry: () => void;
	importanceByPath?: ReadonlyMap<string, ImportanceRating>;
	importanceProgress?: ImportanceReviewProgress;
}

export function layersStatusMessage(
	status: ReviewState["layerStatus"],
): string {
	switch (status) {
		case "pending":
			return "Preparing layers…";
		case "running":
			return "Generating layers…";
		case "failed":
			return "Layer generation failed";
		case "ready":
			return "Completed";
	}
}
export function layersActionState(
	status: ReviewState["layerStatus"],
	layerAction: LayerAction | null,
	externallyDisabled = false,
): {
	mode: LayerAction;
	disabled: boolean;
	tooltip: string;
	label: string;
} {
	const mode = status === "failed" ? "retry" : "regenerate";
	const disabled =
		externallyDisabled || status === "running" || layerAction !== null;
	return {
		mode,
		disabled,
		tooltip: externallyDisabled
			? "Refresh in progress…"
			: disabled
				? "Generating layers…"
				: mode === "retry"
					? "Retry layer generation"
					: "Regenerate layers (resets completed)",
		label: mode === "retry" ? "Retry layer generation" : "Regenerate layers",
	};
}

export function completedLayerCount(layers: ReviewState["layers"]): number {
	return layers.filter((layer) => layer.done && !layer.stale).length;
}

export function splitBddScenario(scenario: string): string[] {
	return scenario
		.split(/(?=\b(?:given|when|then)\b)/gi)
		.map((step) => step.trim().replace(/,$/, ""))
		.filter(Boolean);
}

export function toggleLayerCollapsed(
	collapsedLayerIds: ReadonlySet<string>,
	layerId: string,
): Set<string> {
	const next = new Set(collapsedLayerIds);
	if (next.has(layerId)) {
		next.delete(layerId);
	} else {
		next.add(layerId);
	}
	return next;
}

export function collapseLayerOnDoneTransition(
	collapsedLayerIds: ReadonlySet<string>,
	layerId: string,
	previousDone: boolean | undefined,
	done: boolean,
): Set<string> {
	const next = new Set(collapsedLayerIds);
	if (previousDone === false && done) next.add(layerId);
	return next;
}

/** Shortens a changed-file path to the shortest suffix of whole path
 * segments that is still unique among the given paths, so layer file chips
 * display compact relative names. Falls back to the full path when no
 * shorter suffix is unique. */
export function shortFilePath(
	path: string,
	allPaths: readonly string[],
): string {
	const segments = path.split("/");
	for (let start = segments.length - 1; start >= 0; start -= 1) {
		const suffix = segments.slice(start);
		const collides = allPaths.some((other) => {
			if (other === path) return false;
			const otherSuffix = other.split("/").slice(-suffix.length);
			return (
				otherSuffix.length === suffix.length &&
				otherSuffix.join("/") === suffix.join("/")
			);
		});
		if (!collides) return suffix.join("/");
	}
	return path;
}

function LayerDescription({ text }: { text: string }) {
	const html = useMemo(() => {
		try {
			return renderMarkdownHtml(text, undefined, { breaks: true });
		} catch {
			return null;
		}
	}, [text]);

	if (html === null) {
		return <div className="layer-markdown layer-markdown-plain">{text}</div>;
	}

	return (
		<div
			className="layer-markdown"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown output is sanitized with DOMPurify.
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

export function LayerPane({
	state,
	files,
	filesContent,
	selectedPath,
	onSelectFile,
	onSelectLayer,
	onToggleDone,
	layerAction,
	actionError,
	externallyDisabled,
	onRegenerate,
	onRetry,
	importanceByPath,
	importanceProgress,
}: LayerPaneProps) {
	const [collapsedLayerIds, setCollapsedLayerIds] = useState<Set<string>>(
		() =>
			new Set(
				state.layers.filter((layer) => layer.done).map((layer) => layer.id),
			),
	);
	const previousDone = useRef(
		new Map(state.layers.map((layer) => [layer.id, layer.done])),
	);
	useEffect(() => {
		const previousDoneById = previousDone.current;
		const nextDone = new Map(
			state.layers.map((layer) => [layer.id, layer.done]),
		);
		const newlyDone = state.layers.filter(
			(layer) => previousDoneById.get(layer.id) === false && layer.done,
		);
		previousDone.current = nextDone;
		if (newlyDone.length === 0) return;
		setCollapsedLayerIds((current) =>
			newlyDone.reduce(
				(collapsed, layer) =>
					collapseLayerOnDoneTransition(
						collapsed,
						layer.id,
						previousDoneById.get(layer.id),
						layer.done,
					),
				current,
			),
		);
	}, [state.layers]);
	const currentFilePaths = files.filter((path) => path.length > 0);
	const changedFiles = new Set(currentFilePaths);
	const changedFilePaths = [...new Set(currentFilePaths)];
	const viewed = new Set(state.viewedFiles);
	const action = layersActionState(
		state.layerStatus,
		layerAction,
		externallyDisabled,
	);
	const completed = completedLayerCount(state.layers);
	const changedFileTotal = changedFileCount(currentFilePaths);
	const viewedFileTotal = viewedFileCount(currentFilePaths, state.viewedFiles);
	const actionRunning = layerAction !== null;
	const running = state.layerStatus === "running";
	const actionBusy = running || actionRunning;
	const actionIcon = <RefreshCw aria-hidden />;
	const layerActionButton = (
		<IconButton
			label={action.label}
			tooltip={action.tooltip}
			disabled={action.disabled}
			busy={actionBusy}
			onClick={action.mode === "retry" ? onRetry : onRegenerate}
		>
			{actionIcon}
		</IconButton>
	);
	const layerActionControl = externallyDisabled ? (
		<Tooltip>
			<TooltipTrigger
				render={<span className="inline-flex items-center leading-none" />}
			>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="relative"
					aria-label={action.label}
					disabled={action.disabled}
					focusableWhenDisabled
					aria-busy={actionBusy ? "true" : undefined}
					onClick={action.mode === "retry" ? onRetry : onRegenerate}
				>
					{actionBusy ? (
						<Loader2 className="animate-spin" aria-hidden />
					) : (
						actionIcon
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{action.tooltip}</TooltipContent>
		</Tooltip>
	) : (
		layerActionButton
	);
	return (
		<aside className="review-sidebar-container flex h-full min-h-0 flex-col border-r bg-sidebar">
			<Tabs
				defaultValue="layers"
				className="flex h-full min-h-0 flex-col gap-0"
			>
				<div className="shrink-0 border-b bg-card px-4 py-3">
					<TabsList aria-label="Review sections" className="w-full">
						<TabsTrigger
							value="layers"
							className="flex-1 gap-2"
							aria-label={`Layers, ${completed} of ${state.layers.length} layers complete`}
						>
							<span>Layers</span>
							<span
								className="review-sidebar-tab-progress tabular-nums"
								aria-hidden="true"
							>
								{completed}/{state.layers.length}
							</span>
						</TabsTrigger>
						<TabsTrigger
							value="files"
							className="flex-1 gap-2"
							aria-label={`Files, ${viewedFileTotal} of ${changedFileTotal} current diff files viewed`}
						>
							<span>Files</span>
							<span
								className="review-sidebar-tab-progress tabular-nums"
								aria-hidden="true"
							>
								{viewedFileTotal}/{changedFileTotal}
							</span>
						</TabsTrigger>
					</TabsList>
					{importanceProgress ? (
						<ImportanceProgressBar
							className="mt-3"
							progress={importanceProgress}
						/>
					) : null}
				</div>
				<TabsContent
					value="layers"
					keepMounted
					className="flex min-h-0 flex-1 flex-col overflow-hidden data-[hidden]:hidden"
				>
					<header className="sticky top-0 z-10 shrink-0 border-b bg-card/95 backdrop-blur">
						{state.layerStatus === "ready" ? (
							<div className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,1fr)_auto_auto] items-center gap-2 px-4 pt-3 pb-3 text-xs leading-none text-muted-foreground">
								<span className="min-w-0 truncate">
									{layersStatusMessage("ready")}
								</span>
								<ProgressBar
									className="min-w-0"
									label="Completed"
									value={completed}
									max={state.layers.length}
								/>
								<span className="inline-flex items-center tabular-nums leading-none">
									{completed}/{state.layers.length}
								</span>
								{layerActionControl}
							</div>
						) : (
							<div className="flex items-center justify-between gap-2 px-4 pt-3 pb-3 text-xs leading-none text-muted-foreground">
								<div className="flex min-w-0 items-center gap-2">
									{running ? (
										<Loader2 className="size-4 animate-spin" aria-hidden />
									) : null}
									<span className="min-w-0 truncate">
										{layersStatusMessage(state.layerStatus)}
									</span>
								</div>
								{layerActionControl}
							</div>
						)}
						{state.layerStatus === "failed" && state.layerError ? (
							<Alert className="mx-4 mb-3" variant="destructive">
								{state.layerError}
							</Alert>
						) : null}
						{actionError ? (
							<Alert className="mx-4 mb-3" variant="destructive">
								{actionError}
							</Alert>
						) : null}
					</header>
					{state.layers.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{state.layerStatus === "ready"
								? "No review layers."
								: layersStatusMessage(state.layerStatus)}
						</p>
					) : (
						<ul
							className="m-0 min-h-0 flex-1 list-none space-y-2 overflow-auto px-4 py-4 transition-opacity duration-200 ease-out data-[dimmed]:opacity-60"
							data-dimmed={running ? "" : undefined}
						>
							{state.layers.map((layer, index) => {
								const layerFiles = [...new Set(layer.files)].filter((path) =>
									changedFiles.has(path),
								);
								const layerViewedCount = layerFiles.filter((path) =>
									viewed.has(path),
								).length;
								const collapsed = collapsedLayerIds.has(layer.id);
								const layerState = layer.stale
									? "stale"
									: layer.done
										? "done"
										: "open";
								return (
									<li
										className="animate-in fade-in slide-in-from-left-2 duration-200 ease-out"
										key={layer.id}
										style={{
											animationDelay: `${Math.min(index, 8) * 30}ms`,
										}}
									>
										<Collapsible
											className="rounded-md border bg-card shadow-xs transition-colors duration-150 ease-out data-[done]:opacity-70 data-[stale]:border-warning/40"
											data-done={layer.done ? "" : undefined}
											data-stale={layer.stale ? "" : undefined}
											open={!collapsed}
											onOpenChange={(open) => {
												setCollapsedLayerIds((current) => {
													const next = new Set(current);
													if (open) {
														next.delete(layer.id);
													} else {
														next.add(layer.id);
													}
													return next;
												});
											}}
										>
											<div className="flex items-center gap-2 p-3">
												<CollapsibleTrigger
													aria-label={`${collapsed ? "Expand" : "Collapse"} ${
														layer.title
													}`}
													aria-controls={`layer-details-${layer.id}`}
													render={
														<Button
															type="button"
															variant="ghost"
															size="icon-xs"
															className="group"
															title={`${collapsed ? "Expand" : "Collapse"} ${
																layer.title
															}`}
														>
															<ChevronDown
																className="transition-transform duration-200 ease-out -rotate-90 group-data-[panel-open]:rotate-0"
																aria-hidden
															/>
														</Button>
													}
												/>
												<button
													type="button"
													className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground transition-colors duration-150 ease-out"
													data-active={
														layerFiles.includes(selectedPath ?? "")
															? "true"
															: "false"
													}
													onClick={() => onSelectLayer(layer.id)}
												>
													{layer.title}
												</button>
												{layerState === "stale" ? (
													<Badge
														variant="secondary"
														className="bg-warning/15 text-warning"
														data-layer-state="stale"
													>
														Stale
													</Badge>
												) : null}
												<button
													type="button"
													aria-label={`Mark ${layer.title} ${
														layer.done ? "not done" : "done"
													}`}
													aria-pressed={layer.done}
													data-layer-state={layerState}
													className={`group inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-transparent transition-colors duration-150 ease-out focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 ${
														layer.done
															? "bg-success text-success-foreground hover:bg-success/80"
															: "bg-secondary text-secondary-foreground hover:bg-secondary"
													}`}
													onClick={() => onToggleDone(layer.id, !layer.done)}
												>
													{layer.done ? (
														<>
															<Check
																className="size-3 group-hover:hidden group-focus-visible:hidden"
																aria-hidden
															/>
															<X
																className="hidden size-3 group-hover:block group-focus-visible:block"
																aria-hidden
															/>
														</>
													) : (
														<Check
															className="invisible size-3 group-hover:visible group-focus-visible:visible"
															aria-hidden
														/>
													)}
												</button>
											</div>
											<CollapsibleContent
												keepMounted
												id={`layer-details-${layer.id}`}
												className="space-y-3 px-3 pb-3 text-sm text-foreground"
												data-collapsed={collapsed ? "true" : "false"}
											>
												<LayerDescription text={layer.tldr} />
												<div className="flex items-center gap-3 text-xs">
													<span className="shrink-0">File coverage</span>
													<ProgressBar
														className="ml-0 min-w-0 max-w-none flex-1"
														label={`${layer.title} file coverage`}
														value={layerViewedCount}
														max={layerFiles.length}
													/>
													<span className="shrink-0 tabular-nums">
														{layerViewedCount}/{layerFiles.length}
													</span>
												</div>
												<div className="flex min-w-0 flex-wrap gap-1.5">
													{layerFiles.map((path) => {
														const active = path === selectedPath;
														const isViewed = viewed.has(path);
														const rating = importanceByPath?.get(path);
														const pill = (
															<Badge
																className={cn(
																	"h-auto max-w-full min-w-0 shrink cursor-pointer justify-start gap-1 overflow-visible text-left font-mono text-xs whitespace-normal break-words [overflow-wrap:anywhere]",
																	active
																		? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
																		: isViewed
																			? "bg-success/15 text-success hover:bg-success/20 hover:text-success"
																			: "hover:bg-muted hover:text-foreground",
																	rating !== undefined &&
																		"overflow-hidden pl-0",
																)}
																key={path}
																variant="secondary"
																render={
																	<button
																		type="button"
																		aria-label={path}
																		aria-current={active ? "true" : undefined}
																		data-active={active ? "true" : "false"}
																		onClick={() => onSelectFile(path)}
																	/>
																}
															>
																{rating !== undefined ? (
																	<span
																		aria-hidden="true"
																		className={cn(
																			"-my-0.5 mr-0.5 w-4 self-stretch",
																			IMPORTANCE_BG_CLASS[rating.score],
																		)}
																	/>
																) : null}

																{shortFilePath(path, changedFilePaths)}
															</Badge>
														);
														return (
															<Tooltip key={path}>
																<TooltipTrigger
																	render={
																		<span className="inline-flex min-w-0 max-w-full" />
																	}
																>
																	{pill}
																</TooltipTrigger>
																<TooltipContent
																	className={
																		rating === undefined
																			? undefined
																			: "flex-col items-start gap-0.5"
																	}
																>
																	{rating === undefined ? (
																		path
																	) : (
																		<>
																			<span className="font-medium">
																				{importanceTitle(rating.score)}
																			</span>
																			<span>{rating.reason}</span>
																		</>
																	)}
																</TooltipContent>
															</Tooltip>
														);
													})}
													{layerFiles.length === 0 ? (
														<span className="text-xs text-muted-foreground">
															No changed files
														</span>
													) : null}
												</div>
											</CollapsibleContent>
										</Collapsible>
									</li>
								);
							})}
						</ul>
					)}
				</TabsContent>
				<TabsContent
					value="files"
					keepMounted
					className="flex min-h-0 flex-1 flex-col overflow-hidden data-[hidden]:hidden"
				>
					{filesContent}
				</TabsContent>
			</Tabs>
		</aside>
	);
}
