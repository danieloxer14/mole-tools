export interface SyncBannerProps {
	stale: boolean;
	newCommitCount: number;
	refreshing: boolean;
	syncing: boolean;
	layerGenerating?: boolean;
	regenerateAfterSync: boolean;
	onRefresh: () => void;
	onSync: () => void;
	onRegenerateAfterSyncChange: (value: boolean) => void;
}

export function SyncBanner({
	stale,
	newCommitCount,
	refreshing,
	syncing,
	layerGenerating = false,
	regenerateAfterSync,
	onRefresh,
	onSync,
	onRegenerateAfterSyncChange,
}: SyncBannerProps) {
	const commitLabel = newCommitCount === 1 ? "new commit" : "new commits";
	return (
		<section
			className={`sync-banner${stale ? " sync-banner-stale" : ""}`}
			aria-live="polite"
			aria-label="Merge request sync"
		>
			<div className="sync-banner-copy">
				<strong>
					{stale ? "Merge request has changed" : "Merge request is current"}
				</strong>
				{stale ? (
					<p>
						{newCommitCount} {commitLabel} detected. Sync before posting
						comments or relying on review layers.
					</p>
				) : null}
			</div>
			<div className="sync-banner-actions">
				<button
					type="button"
					disabled={refreshing || syncing || layerGenerating}
					onClick={onRefresh}
				>
					{refreshing ? "Refreshing…" : "Refresh"}
				</button>
				{stale ? (
					<>
						<label>
							<input
								type="checkbox"
								checked={regenerateAfterSync}
								disabled={syncing || layerGenerating}
								onChange={(event) =>
									onRegenerateAfterSyncChange(event.target.checked)
								}
							/>
							Regenerate layers after sync
						</label>
						<button
							type="button"
							disabled={syncing || layerGenerating}
							onClick={onSync}
						>
							{syncing ? "Syncing…" : "Sync"}
						</button>
					</>
				) : null}
			</div>
		</section>
	);
}
