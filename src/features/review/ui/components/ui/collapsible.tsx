import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cn } from "cn";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
	return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
	return (
		<CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
	);
}

function CollapsibleContent({
	className,
	...props
}: CollapsiblePrimitive.Panel.Props) {
	const panelClassName =
		typeof className === "function"
			? (state: CollapsiblePrimitive.Panel.State) =>
					cn(
						"h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out [&[hidden]:not([hidden='until-found'])]:hidden data-ending-style:h-0 data-starting-style:h-0",
						className(state),
					)
			: cn(
					"h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out [&[hidden]:not([hidden='until-found'])]:hidden data-ending-style:h-0 data-starting-style:h-0",
					className,
				);

	return (
		<CollapsiblePrimitive.Panel
			data-slot="collapsible-content"
			className={panelClassName}
			{...props}
		/>
	);
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
