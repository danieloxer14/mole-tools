import { cn } from "cn";
import {
	type ImportanceReviewProgress,
	importanceProgressColor,
} from "../importance";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function ImportanceProgressBar({
	progress,
	className,
}: {
	progress: ImportanceReviewProgress;
	className?: string;
}) {
	if (!Number.isFinite(progress.total) || progress.total <= 0) return null;

	const total = progress.total;
	const value = Number.isFinite(progress.value)
		? Math.min(Math.max(progress.value, 0), total)
		: 0;
	const threshold = Number.isFinite(progress.threshold)
		? Math.min(Math.max(progress.threshold, 0), total)
		: 0;
	const target = threshold > 0 ? threshold : total;
	const reached = value >= target;
	const ratio = target > 0 ? Math.min(value / target, 1) : 0;
	const roundedPct = Math.round((value / total) * 100);
	const targetPct =
		threshold > 0 ? Math.max(1, Math.round((threshold / total) * 100)) : 0;
	const pct =
		threshold > 0
			? reached
				? Math.max(roundedPct, targetPct)
				: Math.min(roundedPct, targetPct - 1)
			: reached
				? roundedPct
				: Math.min(roundedPct, 99);
	const width = `${(value / total) * 100}%`;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<div
						className={cn(
							"flex min-w-0 items-center gap-2 text-xs text-muted-foreground",
							className,
						)}
						role="progressbar"
						aria-label="Importance review progress"
						aria-valuemin={0}
						aria-valuemax={total}
						aria-valuenow={value}
						aria-valuetext={
							threshold > 0
								? `${pct}% reviewed, target ${targetPct}%`
								: `${pct}% reviewed`
						}
						data-reached={reached ? "true" : "false"}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard focus opens the progress explanation tooltip.
						tabIndex={0}
					/>
				}
			>
				<div className="relative h-1.5 min-w-0 flex-1 rounded-full bg-muted">
					<span className="absolute inset-0 overflow-hidden rounded-full">
						<span
							className="block h-full rounded-full transition-[width,background-color] duration-300 ease-out"
							style={{
								width,
								backgroundColor: importanceProgressColor(ratio),
							}}
						/>
					</span>
					{reached && (
						<span
							aria-hidden
							className="importance-progress-flame"
							style={{ width }}
						/>
					)}
					{threshold > 0 && (
						<span
							aria-hidden
							className="importance-progress-marker"
							style={{ left: `${(threshold / total) * 100}%` }}
						/>
					)}
				</div>
				<span className="tabular-nums">{pct}%</span>
			</TooltipTrigger>
			<TooltipContent className="flex-col items-start gap-0.5">
				<span>
					{threshold > 0 && `Reach ${targetPct}% to meet the review target. `}
					More important files fill the bar faster.
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
