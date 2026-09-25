// biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: listbox semantics require ul/li structure
import { Plus } from "lucide-react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { SkillSummary } from "../../../../shared/skills";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface SkillPickerProps {
	id: string;
	items: readonly SkillSummary[];
	highlighted: number;
	onHighlight: (index: number) => void;
	onSelect: (name: string) => void;
	onOpenSkillsSettings?: () => void;
	search?: {
		value: string;
		onChange: (value: string) => void;
		onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
		onBlur?: () => void;
	};
	style?: CSSProperties;
}

export function SkillPicker({
	id,
	items,
	highlighted,
	onHighlight,
	onSelect,
	onOpenSkillsSettings,
	search,
	style,
}: SkillPickerProps) {
	return (
		<div
			className="absolute z-50 w-64 rounded-md border bg-popover p-1 shadow-md"
			style={style}
			data-skill-picker=""
		>
			{search ? (
				<Input
					aria-label="Search skills"
					autoFocus
					className="mb-1 h-7 px-2 text-xs"
					value={search.value}
					onChange={(event) => search.onChange(event.currentTarget.value)}
					onKeyDown={search.onKeyDown}
					onBlur={search.onBlur}
				/>
			) : null}
			{items.length > 0 ? (
				<ul
					id={id}
					role="listbox"
					aria-label="Skills"
					className="m-0 list-none p-0"
				>
					{items.map((skill, index) => (
						<li
							key={skill.name}
							id={`${id}-${index}`}
							role="option"
							tabIndex={-1}
							aria-selected={index === highlighted}
							className="flex cursor-pointer items-center justify-between rounded-sm px-2 py-0.5 text-xs aria-selected:bg-accent aria-selected:text-accent-foreground"
							onMouseEnter={() => onHighlight(index)}
							onMouseDown={(event) => {
								event.preventDefault();
								onSelect(skill.name);
							}}
						>
							<span>{skill.name}</span>
							<span className="text-[10px] text-muted-foreground">
								v{skill.activeVersion}
							</span>
						</li>
					))}
				</ul>
			) : (
				<div
					id={id}
					role="status"
					className="flex items-center justify-between gap-2 px-2 py-1 text-xs"
				>
					<span>No matches</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Open Skills settings"
						onMouseDown={(event) => event.preventDefault()}
						onClick={onOpenSkillsSettings}
					>
						<Plus aria-hidden />
					</Button>
				</div>
			)}
		</div>
	);
}
