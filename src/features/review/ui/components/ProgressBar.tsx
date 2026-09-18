import { cn } from "cn";

interface ProgressBarProps {
	value: number;
	max: number;
	label: string;
	className?: string;
}

export function ProgressBar({
	value,
	max,
	label,
	className,
}: ProgressBarProps) {
	const normalizedMax = Number.isFinite(max) && max > 0 ? max : 0;
	const normalizedValue =
		normalizedMax === 0 || !Number.isFinite(value)
			? 0
			: Math.min(Math.max(value, 0), normalizedMax);
	const width =
		normalizedMax === 0 ? "0%" : `${(normalizedValue / normalizedMax) * 100}%`;
	return (
		<div
			className={cn(
				"ml-auto h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted",
				className,
			)}
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={normalizedMax}
			aria-valuenow={normalizedValue}
		>
			<span
				className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
				style={{ width }}
			/>
		</div>
	);
}
