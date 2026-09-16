import type { ReactNode } from "react";

export interface IconButtonProps {
	label: string;
	tooltip?: string;
	disabled?: boolean;
	busy?: boolean;
	badge?: boolean;
	onClick?: () => void;
	href?: string;
	children: ReactNode;
}

export function IconButton({
	label,
	tooltip,
	disabled = false,
	busy = false,
	badge = false,
	onClick,
	href,
	children,
}: IconButtonProps) {
	const className = "icon-button";
	const title = tooltip ?? label;
	const content = (
		<>
			{children}
			{busy ? (
				<span className="icon-button-spinner" aria-hidden="true">
					↻
				</span>
			) : null}
			{badge ? <span className="icon-button-badge" aria-hidden="true" /> : null}
		</>
	);
	if (href !== undefined) {
		return (
			<a
				className={className}
				href={href}
				target="_blank"
				rel="noreferrer"
				aria-label={label}
				title={title}
				aria-busy={busy ? "true" : undefined}
			>
				{content}
			</a>
		);
	}
	return (
		<button
			type="button"
			className={className}
			aria-label={label}
			title={title}
			disabled={disabled}
			aria-busy={busy ? "true" : undefined}
			onClick={onClick}
		>
			{content}
		</button>
	);
}
