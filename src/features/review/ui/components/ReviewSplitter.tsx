import type { ComponentProps } from "react";

const SPLITTER_CLASS_NAME =
	"m-0 h-full w-1 cursor-col-resize border-0 bg-border transition-colors duration-150 hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none";

export function ReviewSplitter(props: ComponentProps<"hr">) {
	return (
		<hr
			{...props}
			aria-orientation="vertical"
			tabIndex={0}
			className={SPLITTER_CLASS_NAME}
		/>
	);
}
