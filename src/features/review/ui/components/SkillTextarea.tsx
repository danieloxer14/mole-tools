import {
	type CSSProperties,
	Fragment,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	findSkillTokens,
	rankSkills,
	type SkillSummary,
} from "../../../../shared/skills";
import {
	activeSlashQuery,
	atomicTokenDelete,
	insertSkillAtCaret,
	replaceWithSkillToken,
	type SlashQuery,
} from "../skill-composer";
import { SkillPicker } from "./SkillPicker";
import { Textarea } from "./ui/textarea";

export interface SkillTextareaProps {
	value: string;
	onChange: (value: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	skills: readonly SkillSummary[];
	onOpenSkillsSettings?: () => void;
	pickerRequest: number;
	"aria-label"?: string;
	placeholder?: string;
	rows?: number;
	className?: string;
}

function renderTextRange(
	value: string,
	start: number,
	end: number,
	slashStart: number | null,
	key: string,
): ReactNode {
	if (start >= end) return null;
	if (slashStart === null || slashStart < start || slashStart >= end) {
		return <Fragment key={key}>{value.slice(start, end)}</Fragment>;
	}

	return (
		<Fragment key={key}>
			{value.slice(start, slashStart)}
			<span data-slash-anchor>/</span>
			{value.slice(slashStart + 1, end)}
		</Fragment>
	);
}

export function SkillTextarea({
	value,
	onChange,
	onKeyDown,
	skills,
	pickerRequest,
	onOpenSkillsSettings,
	"aria-label": ariaLabel,
	placeholder,
	rows,
	className,
}: SkillTextareaProps) {
	const id = useId();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const previousSlashQuery = useRef<SlashQuery | null>(null);
	const previousPickerRequest = useRef(pickerRequest);
	const lastCaret = useRef(value.length);
	const [slashQuery, setSlashQuery] = useState<SlashQuery | null>(null);
	const [dismissedStart, setDismissedStart] = useState<number | null>(null);
	const [iconPickerOpen, setIconPickerOpen] = useState(false);
	const [iconSearch, setIconSearch] = useState("");
	const [highlighted, setHighlighted] = useState(0);
	const [pickerStyle, setPickerStyle] = useState<CSSProperties>({
		bottom: "100%",
		left: 0,
	});
	const [caretRequest, setCaretRequest] = useState<{
		value: string;
		caret: number;
	} | null>(null);

	const names = useMemo(
		() => new Set(skills.map((skill) => skill.name)),
		[skills],
	);
	const tokens = useMemo(() => findSkillTokens(value, names), [value, names]);
	const searchQuery = iconPickerOpen ? iconSearch : (slashQuery?.query ?? "");
	const items = useMemo(
		() => rankSkills(skills, searchQuery),
		[skills, searchQuery],
	);
	const isSlashPickerOpen =
		slashQuery !== null && dismissedStart !== slashQuery.start;
	const isPickerOpen = iconPickerOpen || isSlashPickerOpen;
	const updateSlashQuery = useCallback((textarea: HTMLTextAreaElement) => {
		const next = activeSlashQuery(
			textarea.value,
			textarea.selectionStart,
			textarea.selectionEnd,
		);
		setSlashQuery(next);
		setDismissedStart((current) =>
			next === null || (current !== null && next.start !== current)
				? null
				: current,
		);
	}, []);

	const trackCaret = (textarea: HTMLTextAreaElement) => {
		lastCaret.current = textarea.selectionStart;
		updateSlashQuery(textarea);
	};

	useLayoutEffect(() => {
		if (previousPickerRequest.current === pickerRequest) return;
		previousPickerRequest.current = pickerRequest;
		const caret = Math.min(lastCaret.current, value.length);
		const currentQuery = activeSlashQuery(value, caret, caret);
		setDismissedStart(currentQuery?.start ?? null);
		setSlashQuery(null);
		setIconSearch("");
		setHighlighted(0);
		setIconPickerOpen(true);
	}, [pickerRequest, value]);

	const updatePickerPosition = useCallback(() => {
		const container = containerRef.current;
		const backdrop = backdropRef.current;
		const textarea = textareaRef.current;
		const anchor = backdrop?.querySelector<HTMLElement>("[data-slash-anchor]");
		if (
			!container ||
			!backdrop ||
			!textarea ||
			!anchor ||
			!slashQuery ||
			textarea.value !== value
		) {
			return;
		}

		const left = Math.max(
			0,
			Math.min(anchor.offsetLeft, container.clientWidth - 256),
		);
		setPickerStyle({
			bottom: `${container.clientHeight - (anchor.offsetTop - backdrop.scrollTop)}px`,
			left: `${left}px`,
		});
	}, [slashQuery, value]);

	useLayoutEffect(() => {
		if (caretRequest === null || caretRequest.value !== value) return;
		const textarea = textareaRef.current;
		if (!textarea) return;

		textarea.focus();
		textarea.setSelectionRange(caretRequest.caret, caretRequest.caret);
		lastCaret.current = caretRequest.caret;
		setCaretRequest(null);
		updateSlashQuery(textarea);
	}, [caretRequest, updateSlashQuery, value]);

	useLayoutEffect(() => {
		if (isPickerOpen) updatePickerPosition();
	}, [isPickerOpen, updatePickerPosition]);

	useLayoutEffect(() => {
		if (!isPickerOpen || !slashQuery) {
			previousSlashQuery.current = null;
			setHighlighted(0);
			return;
		}

		const previous = previousSlashQuery.current;
		if (
			previous === null ||
			previous.start !== slashQuery.start ||
			previous.query !== slashQuery.query
		) {
			setHighlighted(0);
		}
		previousSlashQuery.current = slashQuery;
	}, [isPickerOpen, slashQuery]);

	const selectSkill = (name: string) => {
		if (iconPickerOpen) {
			const caret = Math.max(0, Math.min(lastCaret.current, value.length));
			const replacement = insertSkillAtCaret(value, caret, name);
			setCaretRequest({
				value: replacement.text,
				caret: replacement.caret,
			});
			setIconPickerOpen(false);
			setIconSearch("");
			setSlashQuery(null);
			onChange(replacement.text);
			return;
		}
		if (!slashQuery) return;
		const replacement = replaceWithSkillToken(value, slashQuery, name);
		setCaretRequest({
			value: replacement.text,
			caret: replacement.caret,
		});
		setDismissedStart(null);
		setSlashQuery(null);
		onChange(replacement.text);
	};

	const closeIconPicker = useCallback(() => {
		setIconPickerOpen(false);
		setIconSearch("");
		textareaRef.current?.focus();
	}, []);

	useLayoutEffect(() => {
		if (!iconPickerOpen) return;
		const closeOnOutsideClick = (event: MouseEvent) => {
			const picker = containerRef.current?.querySelector<HTMLElement>(
				"[data-skill-picker]",
			);
			if (event.target instanceof Node && picker?.contains(event.target)) {
				return;
			}
			closeIconPicker();
		};
		document.addEventListener("mousedown", closeOnOutsideClick);
		return () => document.removeEventListener("mousedown", closeOnOutsideClick);
	}, [closeIconPicker, iconPickerOpen]);

	const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" && event.nativeEvent.isComposing) return;
		if (event.key === "ArrowDown" && items.length > 0) {
			event.preventDefault();
			setHighlighted((current) => (current + 1) % items.length);
			return;
		}
		if (event.key === "ArrowUp" && items.length > 0) {
			event.preventDefault();
			setHighlighted((current) => (current - 1 + items.length) % items.length);
			return;
		}
		if ((event.key === "Enter" || event.key === "Tab") && items.length > 0) {
			event.preventDefault();
			selectSkill(items[highlighted]?.name ?? items[0]?.name ?? "");
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			closeIconPicker();
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && event.nativeEvent.isComposing) {
			onKeyDown(event);
			return;
		}
		if (isSlashPickerOpen && slashQuery) {
			if (event.key === "ArrowDown" && items.length > 0) {
				event.preventDefault();
				setHighlighted((current) => (current + 1) % items.length);
				return;
			}
			if (event.key === "ArrowUp" && items.length > 0) {
				event.preventDefault();
				setHighlighted(
					(current) => (current - 1 + items.length) % items.length,
				);
				return;
			}
			if ((event.key === "Enter" || event.key === "Tab") && items.length > 0) {
				event.preventDefault();
				selectSkill(items[highlighted]?.name ?? items[0]?.name ?? "");
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				setDismissedStart(slashQuery.start);
				setSlashQuery(null);
				return;
			}
		}
		if (event.key === "Backspace" || event.key === "Delete") {
			const textarea = event.currentTarget;
			const deletion = atomicTokenDelete(
				value,
				textarea.selectionStart,
				textarea.selectionEnd,
				event.key,
				names,
			);
			if (deletion) {
				event.preventDefault();
				setCaretRequest({
					value: deletion.text,
					caret: deletion.caret,
				});
				onChange(deletion.text);
				return;
			}
		}

		onKeyDown(event);
	};

	const handleScroll = (textarea: HTMLTextAreaElement) => {
		if (backdropRef.current) {
			backdropRef.current.scrollTop = textarea.scrollTop;
		}
		if (isPickerOpen) updatePickerPosition();
	};

	const slashStart = slashQuery?.start ?? null;
	const backdropContent: ReactNode[] = [];
	let cursor = 0;
	for (const [index, token] of tokens.entries()) {
		backdropContent.push(
			renderTextRange(value, cursor, token.start, slashStart, `text-${index}`),
		);
		backdropContent.push(
			<mark
				key={`token-${index}`}
				data-skill-token
				className="rounded-sm bg-primary/25 text-transparent"
			>
				{slashStart === token.start ? (
					<>
						<span data-slash-anchor>/</span>
						{token.name}
					</>
				) : (
					value.slice(token.start, token.end)
				)}
			</mark>,
		);
		cursor = token.end;
	}
	backdropContent.push(
		renderTextRange(value, cursor, value.length, slashStart, "text-tail"),
	);

	return (
		<div ref={containerRef} className="relative rounded-2xl bg-input/50">
			<div
				ref={backdropRef}
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-3 text-base text-transparent md:text-sm"
			>
				{backdropContent}
				{"\u200b"}
			</div>
			<Textarea
				ref={textareaRef}
				aria-label={ariaLabel}
				aria-expanded={isPickerOpen}
				aria-controls={isPickerOpen ? id : undefined}
				aria-activedescendant={
					isPickerOpen && items.length > 0 ? `${id}-${highlighted}` : undefined
				}
				className={`relative bg-transparent ${className ?? ""}`}
				placeholder={placeholder}
				rows={rows}
				value={value}
				onChange={(event) => {
					lastCaret.current = event.currentTarget.selectionStart;
					onChange(event.currentTarget.value);
					updateSlashQuery(event.currentTarget);
				}}
				onClick={(event) => trackCaret(event.currentTarget)}
				onFocus={(event) => trackCaret(event.currentTarget)}
				onKeyDown={handleKeyDown}
				onKeyUp={(event) => trackCaret(event.currentTarget)}
				onScroll={(event) => handleScroll(event.currentTarget)}
				onSelect={(event) => trackCaret(event.currentTarget)}
				onBlur={(event) => {
					lastCaret.current = event.currentTarget.selectionStart;
					setSlashQuery(null);
				}}
			/>
			{isPickerOpen ? (
				<SkillPicker
					id={id}
					items={items}
					highlighted={highlighted}
					onHighlight={setHighlighted}
					onSelect={selectSkill}
					onOpenSkillsSettings={onOpenSkillsSettings}
					search={
						iconPickerOpen
							? {
									value: iconSearch,
									onChange: (search) => {
										setIconSearch(search);
										setHighlighted(0);
									},
									onKeyDown: handleSearchKeyDown,
									onBlur: closeIconPicker,
								}
							: undefined
					}
					style={iconPickerOpen ? { bottom: "100%", left: 0 } : pickerStyle}
				/>
			) : null}
		</div>
	);
}
