import type { MrApprovalState } from "../../../ports/git-host";
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
}: LayerPaneProps) {
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
									<input
										id={`layer-done-${layer.id}`}
										type="checkbox"
										checked={layer.done}
										aria-label={`Mark ${layer.title} done`}
										onChange={(event) =>
											onToggleDone(layer.id, event.target.checked)
										}
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
											onClick={() => onSelectFile(path)}
										>
											{path}
										</button>
									))}
									{layerFiles.length === 0 ? (
										<span className="file-chip-empty">No changed files</span>
									) : null}
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</aside>
	);
}
