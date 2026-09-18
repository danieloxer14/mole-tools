import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface IconButtonProps {
	label: string;
	tooltip?: string;
	disabled?: boolean;
	busy?: boolean;
	badge?: boolean;
	size?: "icon-sm" | "icon-xs";
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
	size = "icon-sm",
	onClick,
	href,
	children,
}: IconButtonProps) {
	const title = tooltip ?? label;
	const content = (
		<>
			{busy ? <Loader2 className="animate-spin" aria-hidden /> : children}
			{badge ? (
				<span
					data-badge=""
					className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary animate-in zoom-in duration-150 ease-out"
					aria-hidden
				/>
			) : null}
		</>
	);
	const trigger =
		href !== undefined ? (
			<a
				className={buttonVariants({
					variant: "ghost",
					size,
					className: "relative",
				})}
				href={href}
				target="_blank"
				rel="noreferrer"
				aria-label={label}
				aria-busy={busy ? "true" : undefined}
			>
				{content}
			</a>
		) : (
			<Button
				type="button"
				variant="ghost"
				size={size}
				className="relative"
				aria-label={label}
				disabled={disabled}
				aria-busy={busy ? "true" : undefined}
				onClick={onClick}
			>
				{content}
			</Button>
		);

	return (
		<Tooltip>
			<TooltipTrigger render={trigger} />
			<TooltipContent>{title}</TooltipContent>
		</Tooltip>
	);
}
