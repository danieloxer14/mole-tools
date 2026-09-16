interface IconProps {
	className?: string;
}

const iconProps = {
	"aria-hidden": true,
	focusable: false,
	height: 14,
	viewBox: "0 0 16 16",
	width: 14,
} as const;

export function RefreshIcon({ className }: IconProps = {}) {
	return (
		<svg
			{...iconProps}
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
		>
			<path
				d="M13 4.5V1.75m0 0h-2.75m2.75 0-2 2A5.5 5.5 0 1 0 13.25 9"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

export function ExternalLinkIcon({ className }: IconProps = {}) {
	return (
		<svg
			{...iconProps}
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
		>
			<path
				d="M9.5 2H14v4.5M14 2 8 8m3.5 2.5v2A1.5 1.5 0 0 1 10 14H3.5A1.5 1.5 0 0 1 2 12.5V6A1.5 1.5 0 0 1 3.5 4h2"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

export function SyncIcon({ className }: IconProps = {}) {
	return (
		<svg
			{...iconProps}
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
		>
			<path
				d="M3 5.5A5 5 0 0 1 12.5 4L14 5.5M14 5.5V2.75m0 2.75h-2.75M13 10.5A5 5 0 0 1 3.5 12L2 10.5m0 0v2.75m0-2.75h2.75"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

export function RegenerateIcon({ className }: IconProps = {}) {
	return (
		<svg
			{...iconProps}
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
		>
			<path
				d="M13 4.5V1.75m0 0h-2.75m2.75 0-2 2A5.5 5.5 0 1 0 13.25 9"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
			/>
			<path d="M8 6v4m-2-2h4" strokeLinecap="round" strokeWidth="1.5" />
		</svg>
	);
}

export const RetryIcon = RefreshIcon;

export function PlusIcon({ className }: IconProps = {}) {
	return (
		<svg
			{...iconProps}
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
		>
			<path d="M8 3v10M3 8h10" strokeLinecap="round" strokeWidth="1.5" />
		</svg>
	);
}

export function CogIcon({ className }: IconProps = {}) {
	return (
		<svg
			{...iconProps}
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
		>
			<path
				d="m6.9 2.2.4 1.3a4.8 4.8 0 0 1 1.4 0l.4-1.3 1.3.5-.4 1.3c.4.3.8.6 1.1 1l1.3-.5.7 1.2-1.2.8c.1.5.2.9.2 1.4l1.3.4-.2 1.4-1.4-.1a4.7 4.7 0 0 1-.7 1.2l.8 1.1-1.1.9-.9-1a5 5 0 0 1-1.4.6v1.4H7v-1.4a5 5 0 0 1-1.4-.6l-.9 1-1.1-.9.8-1.1a4.7 4.7 0 0 1-.7-1.2l-1.4.1-.2-1.4 1.3-.4c0-.5.1-.9.2-1.4l-1.2-.8.7-1.2 1.3.5c.3-.4.7-.7 1.1-1l-.4-1.3 1.3-.5Z"
				strokeLinejoin="round"
				strokeWidth="1.1"
			/>
			<circle cx="8" cy="8" r="1.8" strokeWidth="1.1" />
		</svg>
	);
}

export function CopyIcon({ className }: IconProps = {}) {
	return (
		<svg
			{...iconProps}
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			className={className}
		>
			<rect height="8" rx="1" strokeWidth="1.5" width="7" x="5" y="5" />
			<path
				d="M3 10V3.5A1.5 1.5 0 0 1 4.5 2H11"
				strokeLinecap="round"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

export function CheckIcon({ className }: IconProps = {}) {
	return (
		<svg
			{...iconProps}
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
		>
			<path
				d="m3 8.5 3 3 7-7"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.7"
			/>
		</svg>
	);
}
