interface ProgressBarProps {
	value: number;
	max: number;
	label: string;
}

export function ProgressBar({ value, max, label }: ProgressBarProps) {
	const width = `${max ? (value / max) * 100 : 0}%`;
	return (
		<div
			className="progress-bar"
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={value}
		>
			<span style={{ width }} />
		</div>
	);
}
