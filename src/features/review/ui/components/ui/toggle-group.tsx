import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import * as React from "react";

import { toggleVariants } from "./toggle";

const ToggleGroupContext = React.createContext<
	VariantProps<typeof toggleVariants> & {
		spacing?: number;
		orientation?: "horizontal" | "vertical";
	}
>({
	size: "default",
	variant: "default",
	spacing: 2,
	orientation: "horizontal",
});

function ToggleGroup({
	className,
	variant,
	size,
	spacing = 2,
	orientation = "horizontal",
	children,
	...props
}: ToggleGroupPrimitive.Props &
	VariantProps<typeof toggleVariants> & {
		spacing?: number;
		orientation?: "horizontal" | "vertical";
	}) {
	return (
		<ToggleGroupPrimitive
			data-slot="toggle-group"
			data-variant={variant}
			data-size={size}
			data-spacing={spacing}
			data-orientation={orientation}
			style={{ "--gap": spacing } as React.CSSProperties}
			className={cn(
				"group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] data-[spacing=0]:data-[variant=outline]:rounded-3xl data-[spacing=0]:data-[variant=segmented]:rounded-3xl data-[variant=segmented]:min-w-0 data-[variant=segmented]:max-w-full data-[variant=segmented]:overflow-hidden data-[variant=segmented]:border data-[variant=segmented]:border-border data-[variant=segmented]:bg-input/50 data-[variant=segmented]:p-0.5 data-[variant=segmented]:gap-0 data-vertical:flex-col data-vertical:items-stretch",
				className,
			)}
			{...props}
		>
			<ToggleGroupContext.Provider
				value={{ variant, size, spacing, orientation }}
			>
				{children}
			</ToggleGroupContext.Provider>
		</ToggleGroupPrimitive>
	);
}
function SegmentedToggleGroup({
	className,
	children,
	...props
}: ToggleGroupPrimitive.Props) {
	return (
		<ToggleGroup
			{...props}
			variant="segmented"
			size="sm"
			spacing={0}
			className={cn("min-w-0 max-w-full shrink-0", className)}
		>
			{children}
		</ToggleGroup>
	);
}

function SegmentedToggleGroupItem({
	className,
	...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
	return (
		<ToggleGroupItem
			{...props}
			variant="segmented"
			size="sm"
			className={cn("h-7 min-w-7 flex-1 px-2", className)}
		/>
	);
}

function ToggleGroupItem({
	className,
	children,
	variant = "default",
	size = "default",
	...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
	const context = React.useContext(ToggleGroupContext);

	return (
		<TogglePrimitive
			data-slot="toggle-group-item"
			data-variant={context.variant || variant}
			data-size={context.size || size}
			data-spacing={context.spacing}
			className={cn(
				"shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-3 group-data-[spacing=0]/toggle-group:shadow-none focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-2.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-2.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-3xl group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-3xl group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-3xl group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-3xl group-data-[variant=segmented]/toggle-group:data-[spacing=0]:min-w-8 group-data-[variant=segmented]/toggle-group:data-[spacing=0]:flex-1 group-data-[variant=segmented]/toggle-group:data-[spacing=0]:px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90",
				toggleVariants({
					variant: context.variant || variant,
					size: context.size || size,
				}),
				className,
			)}
			{...props}
		>
			{children}
		</TogglePrimitive>
	);
}

export {
	SegmentedToggleGroup,
	SegmentedToggleGroupItem,
	ToggleGroup,
	ToggleGroupItem,
};
