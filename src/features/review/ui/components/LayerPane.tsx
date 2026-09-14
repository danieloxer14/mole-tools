import { useEffect, useRef, useState } from "react";
import type { MrApprovalState } from "../../../../ports/git-host";
import type { ReviewState } from "../../state";
import { type ApprovalAction, ApprovalControls } from "./ApprovalControls";

type LayerAction = "regenerate" | "retry";
type VisibleLayerStatus = ReviewState["layerStatus"] | "stale";

interface LayerPaneProps {
	state: ReviewState;
	files: string[];
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
	onSelectLayer: (id: string) => void;
	onToggleDone: (id: string, done: boolean) => void;
	layerAction: LayerAction | null;
	actionError: string | null;
	onRegenerate: () => void;
	onRetry: () => void;
	approval: MrApprovalState | null;
	approvalLoading: boolean;
	approvalAction: ApprovalAction | null;
	approvalError: string | null;
	onApprovalAction: (action: ApprovalAction) => void;
	onOpenSettings: () => void;
}

function statusLabel(status: VisibleLayerStatus): string {
	switch (status) {
		case "pending":
			return "Pending";
		case "running":
			return "Running";
		case "ready":
			return "Ready";
		case "failed":
			return "Failed";
		case "stale":
			return "Stale";
	}
}

function statusDescription(
	status: VisibleLayerStatus,
	layerCount: number,
): string {
	switch (status) {
		case "pending":
			return "Layer guide is waiting to be generated.";
		case "running":
			return "Layer guide is being generated. Diff stays available.";
		case "ready":
			return `${layerCount} ${layerCount === 1 ? "layer" : "layers"} ready.`;
		case "failed":
			return "Layer guide failed. Diff and file navigation remain available.";
		case "stale":
			return "Layer guide is stale. Regenerate to refresh it.";
	}
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

export function collapseLayerWhenDone(
	collapsedLayerIds: ReadonlySet<string>,
	layerId: string,
	done: boolean,
): Set<string> {
	const next = new Set(collapsedLayerIds);
	if (done) next.add(layerId);
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
export function LayerPane({
	state,
	files,
	selectedPath,
	onSelectFile,
	onSelectLayer,
	onToggleDone,
	layerAction,
	actionError,
	onRegenerate,
	onRetry,
	approval,
	approvalLoading,
	approvalAction,
	approvalError,
	onApprovalAction,
	onOpenSettings,
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
	const changedFiles = new Set(files);
	const changedFilePaths = [...new Set(files)];
	const viewed = new Set(state.viewedFiles);
	const viewedCount = changedFilePaths.filter((path) =>
		viewed.has(path),
	).length;
	const hasStaleLayer = state.layers.some((layer) => layer.stale);
	const visibleStatus: VisibleLayerStatus =
		hasStaleLayer && state.layerStatus === "ready"
			? "stale"
			: state.layerStatus;
	const actionRunning = layerAction !== null;
	return (
		<aside className="left-column">
			<header className="column-header">
				<p className="eyebrow">Review layers</p>
				<h1>{state.mr.title}</h1>
				<ApprovalControls
					mrWebUrl={state.mr.webUrl}
					approval={approval}
					loading={approvalLoading}
					pendingAction={approvalAction}
					error={approvalError}
					onAction={onApprovalAction}
				/>
				<div className="layer-status-row" role="status" aria-live="polite">
					<span className={`layer-status layer-status-${visibleStatus}`}>
						{statusLabel(visibleStatus)}
					</span>
					{hasStaleLayer && visibleStatus !== "stale" ? (
						<span className="layer-status layer-status-stale">Stale</span>
					) : null}
				</div>
				<p>{statusDescription(visibleStatus, state.layers.length)}</p>
				{state.layerError ? (
					<p className="layer-error" role="alert">
						{state.layerError}
					</p>
				) : null}
				{actionError ? (
					<p className="layer-error" role="alert">
						{actionError}
					</p>
				) : null}
				<div className="layer-actions">
					<button
						type="button"
						disabled={actionRunning || state.layerStatus === "running"}
						onClick={onRegenerate}
					>
						{layerAction === "regenerate" ? "Regenerating…" : "Regenerate"}
					</button>
					<button type="button" onClick={onOpenSettings}>
						Prompts &amp; Models
					</button>
					{state.layerStatus === "failed" ? (
						<button type="button" disabled={actionRunning} onClick={onRetry}>
							{layerAction === "retry" ? "Retrying…" : "Retry"}
						</button>
					) : null}
				</div>
			</header>
			<div className="coverage-summary">
				<span>
					Viewed files <strong>{viewedCount}</strong>/{changedFilePaths.length}
				</span>
				<div
					className="coverage-bar"
					role="progressbar"
					aria-label="Viewed file coverage"
					aria-valuemin={0}
					aria-valuemax={changedFilePaths.length}
					aria-valuenow={viewedCount}
				>
					<span
						style={{
							width: `${
								changedFilePaths.length
									? (viewedCount / changedFilePaths.length) * 100
									: 0
							}%`,
						}}
					/>
				</div>
			</div>
			{state.layers.length === 0 ? (
				<p className="placeholder">
					{statusDescription(visibleStatus, state.layers.length)}
				</p>
			) : (
				<ul className="layer-list">
					{state.layers.map((layer) => {
						const layerFiles = [...new Set(layer.files)].filter((path) =>
							changedFiles.has(path),
						);
						const layerViewedCount = layerFiles.filter((path) =>
							viewed.has(path),
						).length;
						const layerCoverage = layerFiles.length
							? (layerViewedCount / layerFiles.length) * 100
							: 0;
						return (
							<li
								className={`${layer.stale ? "stale" : ""} ${
									layer.done ? "done" : ""
								}`.trim()}
								key={layer.id}
							>
								<div className="layer-title-row">
									<button
										type="button"
										className="layer-collapse"
										aria-label={`${
											collapsedLayerIds.has(layer.id) ? "Expand" : "Collapse"
										} ${layer.title}`}
										aria-expanded={!collapsedLayerIds.has(layer.id)}
										aria-controls={`layer-details-${layer.id}`}
										onClick={() =>
											setCollapsedLayerIds((current) =>
												toggleLayerCollapsed(current, layer.id),
											)
										}
									>
										<svg
											className="layer-collapse-icon"
											viewBox="0 0 16 16"
											aria-hidden="true"
											focusable="false"
										>
											<path
												d="M3 6l5 5 5-5"
												fill="none"
												stroke="currentColor"
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth="2"
											/>
										</svg>
									</button>
									<input
										id={`layer-done-${layer.id}`}
										type="checkbox"
										checked={layer.done}
										aria-label={`Mark ${layer.title} done`}
										onChange={(event) => {
											const done = event.target.checked;
											setCollapsedLayerIds((current) =>
												collapseLayerWhenDone(current, layer.id, done),
											);
											onToggleDone(layer.id, done);
										}}
									/>
									<button
										type="button"
										className={`layer-select ${
											layerFiles.includes(selectedPath ?? "") ? "active" : ""
										}`}
										onClick={() => onSelectLayer(layer.id)}
									>
										{layer.title}
									</button>
									<span className="layer-state">
										{layer.stale ? "Stale" : layer.done ? "Done" : "Open"}
									</span>
								</div>
								<div
									id={`layer-details-${layer.id}`}
									className={`layer-details ${
										collapsedLayerIds.has(layer.id) ? "is-collapsed" : ""
									}`.trim()}
									aria-hidden={collapsedLayerIds.has(layer.id)}
									inert={collapsedLayerIds.has(layer.id)}
								>
									<div className="layer-details-content">
										<p>{layer.tldr}</p>
										{layer.bdd.length > 0 ? (
											<details className="layer-bdd">
												<summary>BDD scenarios ({layer.bdd.length})</summary>
												<ul>
													{layer.bdd.map((scenario) => (
														<li key={scenario}>
															{splitBddScenario(scenario).map((step) => (
																<span className="layer-bdd-step" key={step}>
																	{step}
																</span>
															))}
														</li>
													))}
												</ul>
											</details>
										) : null}
										<div className="layer-coverage">
											<div className="layer-coverage-label">
												<span>File coverage</span>
												<span>
													{layerViewedCount}/{layerFiles.length}
												</span>
											</div>
											<div
												className="layer-coverage-bar"
												role="progressbar"
												aria-label={`${layer.title} file coverage`}
												aria-valuemin={0}
												aria-valuemax={layerFiles.length}
												aria-valuenow={layerViewedCount}
											>
												<span style={{ width: `${layerCoverage}%` }} />
											</div>
										</div>
										<div className="file-chips">
											{layerFiles.map((path) => (
												<button
													type="button"
													className={path === selectedPath ? "active" : ""}
													key={path}
													title={path}
													aria-label={path}
													onClick={() => onSelectFile(path)}
												>
													{shortFilePath(path, changedFilePaths)}
												</button>
											))}
											{layerFiles.length === 0 ? (
												<span className="file-chip-empty">
													No changed files
												</span>
											) : null}
										</div>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</aside>
	);
}
