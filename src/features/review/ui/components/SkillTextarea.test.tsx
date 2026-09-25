import { afterEach, expect, test } from "bun:test";
import { act, type KeyboardEvent as ReactKeyboardEvent, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { SkillSummary } from "../../../../shared/skills";
import { SkillTextarea } from "./SkillTextarea";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const skills: SkillSummary[] = [
	{
		name: "review-newest",
		activeVersion: 3,
		versions: [1, 2, 3],
		lastUsedAt: "2026-09-23T12:00:00.000Z",
	},
	{
		name: "review-middle",
		activeVersion: 2,
		versions: [1, 2],
		lastUsedAt: "2026-09-21T12:00:00.000Z",
	},
	{
		name: "review-oldest",
		activeVersion: 1,
		versions: [1],
		lastUsedAt: "2026-09-20T12:00:00.000Z",
	},
	{
		name: "summarize",
		activeVersion: 1,
		versions: [1],
		lastUsedAt: "2026-09-22T12:00:00.000Z",
	},
];

const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
});

interface RenderedTextarea {
	container: HTMLDivElement;
	textarea: HTMLTextAreaElement;
	rerenderPickerRequest: (request: number) => void;
}

function renderSkillTextarea({
	initialValue = "",
	availableSkills = skills,
	onKeyDown = () => {},
	onOpenSkillsSettings = () => {},
	pickerRequest = 0,
}: {
	initialValue?: string;
	availableSkills?: readonly SkillSummary[];
	onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
	onOpenSkillsSettings?: () => void;
	pickerRequest?: number;
} = {}): RenderedTextarea {
	let currentPickerRequest = pickerRequest;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);

	function Harness() {
		const [value, setValue] = useState(initialValue);
		return (
			<SkillTextarea
				aria-label="Skill composer"
				value={value}
				onChange={setValue}
				onKeyDown={onKeyDown}
				skills={availableSkills}
				onOpenSkillsSettings={onOpenSkillsSettings}
				pickerRequest={currentPickerRequest}
			/>
		);
	}

	act(() => root.render(<Harness />));
	const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
	if (!textarea) throw new Error("SkillTextarea did not render a textarea");
	return {
		container,
		textarea,
		rerenderPickerRequest: (request) => {
			currentPickerRequest = request;
			act(() => root.render(<Harness />));
		},
	};
}

function inputText(
	textarea: HTMLTextAreaElement,
	value: string,
	caret = value.length,
): void {
	Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set?.call(textarea, value);
	textarea.setSelectionRange(caret, caret);
	textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function inputSearch(input: HTMLInputElement, value: string): void {
	Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set?.call(input, value);
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function pressKey(element: HTMLElement, key: string): KeyboardEvent {
	const event = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key,
	});
	element.dispatchEvent(event);
	return event;
}

function selectedOptions(container: HTMLElement): string[] {
	return [...container.querySelectorAll<HTMLElement>('[role="option"]')].map(
		(option) => option.getAttribute("aria-selected") ?? "false",
	);
}

test("typing slash opens the three most recently used skills first", () => {
	const rendered = renderSkillTextarea();
	act(() => inputText(rendered.textarea, "/"));

	const options = [
		...rendered.container.querySelectorAll<HTMLElement>('[role="option"]'),
	];
	expect(rendered.container.querySelector('[role="listbox"]')).not.toBeNull();
	expect(rendered.container.querySelector('[role="listbox"]')?.tagName).toBe(
		"UL",
	);
	expect(options.every((option) => option.tagName === "LI")).toBe(true);
	expect(options).toHaveLength(3);
	expect(options.map((option) => option.textContent)).toEqual([
		"review-newestv3",
		"summarizev1",
		"review-middlev2",
	]);
});

test("slash query filters all skills by name prefix before limiting results", () => {
	const rendered = renderSkillTextarea();
	act(() => inputText(rendered.textarea, "/re"));

	expect(
		[...rendered.container.querySelectorAll('[role="option"]')].map(
			(option) => option.textContent,
		),
	).toEqual(["review-newestv3", "review-middlev2", "review-oldestv1"]);
});

test("no matches offers a plus button that opens Skills settings", () => {
	let opened = false;
	const rendered = renderSkillTextarea({
		onOpenSkillsSettings: () => {
			opened = true;
		},
	});
	act(() => inputText(rendered.textarea, "/not-a-skill"));

	expect(rendered.container.querySelector('[role="status"]')?.textContent).toBe(
		"No matches",
	);
	const settingsButton = rendered.container.querySelector<HTMLButtonElement>(
		'button[aria-label="Open Skills settings"]',
	);
	expect(settingsButton).not.toBeNull();
	act(() => settingsButton?.click());
	expect(opened).toBe(true);
});

test("ArrowDown and ArrowUp wrap the highlighted list option", () => {
	const rendered = renderSkillTextarea();
	act(() => inputText(rendered.textarea, "/"));
	expect(selectedOptions(rendered.container)).toEqual([
		"true",
		"false",
		"false",
	]);

	act(() => pressKey(rendered.textarea, "ArrowDown"));
	expect(selectedOptions(rendered.container)).toEqual([
		"false",
		"true",
		"false",
	]);
	act(() => pressKey(rendered.textarea, "ArrowDown"));
	act(() => pressKey(rendered.textarea, "ArrowDown"));
	expect(selectedOptions(rendered.container)).toEqual([
		"true",
		"false",
		"false",
	]);
	act(() => pressKey(rendered.textarea, "ArrowUp"));
	expect(selectedOptions(rendered.container)).toEqual([
		"false",
		"false",
		"true",
	]);
});

test("Enter inserts highlighted skill token without composer passthrough", () => {
	let passthroughCalls = 0;
	const rendered = renderSkillTextarea({
		onKeyDown: () => {
			passthroughCalls += 1;
		},
	});
	act(() => inputText(rendered.textarea, "/"));
	act(() => pressKey(rendered.textarea, "ArrowDown"));

	const enter = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key: "Enter",
	});
	act(() => rendered.textarea.dispatchEvent(enter));

	expect(rendered.textarea.value).toBe("/summarize ");
	expect(passthroughCalls).toBe(0);
	expect(enter.defaultPrevented).toBe(true);
	expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();
});

test("composing Enter in slash picker reaches composer passthrough", () => {
	let passthroughCalls = 0;
	const rendered = renderSkillTextarea({
		onKeyDown: () => {
			passthroughCalls += 1;
		},
	});
	act(() => inputText(rendered.textarea, "/"));

	const enter = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		isComposing: true,
		key: "Enter",
	});
	act(() => rendered.textarea.dispatchEvent(enter));

	expect(passthroughCalls).toBe(1);
	expect(enter.defaultPrevented).toBe(false);
	expect(rendered.textarea.value).toBe("/");
	expect(rendered.container.querySelector('[role="listbox"]')).not.toBeNull();
});

test("Enter with no matching skills reaches composer passthrough", () => {
	let passthroughCalls = 0;
	const rendered = renderSkillTextarea({
		onKeyDown: () => {
			passthroughCalls += 1;
		},
	});
	act(() => inputText(rendered.textarea, "/unknown"));
	const enter = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key: "Enter",
	});
	act(() => rendered.textarea.dispatchEvent(enter));

	expect(passthroughCalls).toBe(1);
	expect(enter.defaultPrevented).toBe(false);
	expect(rendered.textarea.value).toBe("/unknown");
});

test("Escape closes picker without changing composer text", () => {
	let passthroughCalls = 0;
	const rendered = renderSkillTextarea({
		onKeyDown: () => {
			passthroughCalls += 1;
		},
	});
	act(() => inputText(rendered.textarea, "/"));
	const escapeEvent = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key: "Escape",
	});
	act(() => rendered.textarea.dispatchEvent(escapeEvent));

	expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();
	expect(rendered.textarea.value).toBe("/");
	expect(passthroughCalls).toBe(0);
	expect(escapeEvent.defaultPrevented).toBe(true);
});

test("icon picker opens a focused search input and filters by prefix", () => {
	const rendered = renderSkillTextarea();
	act(() => rendered.rerenderPickerRequest(1));

	const search = rendered.container.querySelector<HTMLInputElement>(
		'input[aria-label="Search skills"]',
	);
	if (!search) throw new Error("Skill search input did not render");
	expect(document.activeElement).toBe(search);
	act(() => inputSearch(search, "sum"));

	expect(
		[...rendered.container.querySelectorAll('[role="option"]')].map(
			(option) => option.textContent,
		),
	).toEqual(["summarizev1"]);
});

test("icon picker navigates results and inserts at the last caret", () => {
	const rendered = renderSkillTextarea({ initialValue: "hello world" });
	act(() => {
		rendered.textarea.focus();
		rendered.textarea.setSelectionRange(5, 5);
		rendered.textarea.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true }),
		);
	});
	act(() => rendered.rerenderPickerRequest(1));

	const search = rendered.container.querySelector<HTMLInputElement>(
		'input[aria-label="Search skills"]',
	);
	if (!search) throw new Error("Skill search input did not render");
	act(() => inputSearch(search, "review"));
	expect(selectedOptions(rendered.container)).toEqual([
		"true",
		"false",
		"false",
	]);

	act(() => pressKey(search, "ArrowDown"));
	expect(selectedOptions(rendered.container)).toEqual([
		"false",
		"true",
		"false",
	]);
	act(() => pressKey(search, "ArrowUp"));
	expect(selectedOptions(rendered.container)).toEqual([
		"true",
		"false",
		"false",
	]);
	act(() => pressKey(search, "ArrowUp"));
	expect(selectedOptions(rendered.container)).toEqual([
		"false",
		"false",
		"true",
	]);
	act(() => pressKey(search, "ArrowDown"));
	expect(selectedOptions(rendered.container)).toEqual([
		"true",
		"false",
		"false",
	]);
	act(() => pressKey(search, "Enter"));

	expect(rendered.textarea.value).toBe("hello /review-newest world");
	expect(document.activeElement).toBe(rendered.textarea);
	expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();
});

test("composing Enter in icon search does not select a skill", () => {
	const rendered = renderSkillTextarea();
	act(() => rendered.rerenderPickerRequest(1));
	const search = rendered.container.querySelector<HTMLInputElement>(
		'input[aria-label="Search skills"]',
	);
	if (!search) throw new Error("Skill search input did not render");
	act(() => inputSearch(search, "sum"));

	const enter = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		isComposing: true,
		key: "Enter",
	});
	act(() => search.dispatchEvent(enter));

	expect(enter.defaultPrevented).toBe(false);
	expect(rendered.textarea.value).toBe("");
	expect(document.activeElement).toBe(search);
	expect(rendered.container.querySelector('[role="listbox"]')).not.toBeNull();
});

test("Tab selects an icon picker result", () => {
	const rendered = renderSkillTextarea();
	act(() => rendered.rerenderPickerRequest(1));
	const search = rendered.container.querySelector<HTMLInputElement>(
		'input[aria-label="Search skills"]',
	);
	if (!search) throw new Error("Skill search input did not render");
	act(() => inputSearch(search, "sum"));
	act(() => pressKey(search, "Tab"));

	expect(rendered.textarea.value).toBe("/summarize ");
	expect(document.activeElement).toBe(rendered.textarea);
});

test("clicking icon picker result inserts skill and refocuses textarea", () => {
	const rendered = renderSkillTextarea({ initialValue: "say" });
	act(() => {
		rendered.textarea.setSelectionRange(3, 3);
		rendered.textarea.dispatchEvent(
			new window.Event("select", { bubbles: true }),
		);
	});
	act(() => rendered.rerenderPickerRequest(1));

	const option =
		rendered.container.querySelector<HTMLElement>('[role="option"]');
	if (!option) throw new Error("Skill option did not render");
	const mouseDown = new window.MouseEvent("mousedown", {
		bubbles: true,
		cancelable: true,
	});
	act(() => option.dispatchEvent(mouseDown));

	expect(mouseDown.defaultPrevented).toBe(true);
	expect(rendered.textarea.value).toBe("say /review-newest ");
	expect(document.activeElement).toBe(rendered.textarea);
});

test("Escape closes icon picker and refocuses textarea without changing text", () => {
	const rendered = renderSkillTextarea({ initialValue: "draft" });
	act(() => rendered.rerenderPickerRequest(1));
	const search = rendered.container.querySelector<HTMLInputElement>(
		'input[aria-label="Search skills"]',
	);
	if (!search) throw new Error("Skill search input did not render");

	let bubbled = false;
	const onOuterKeyDown = () => {
		bubbled = true;
	};
	document.body.addEventListener("keydown", onOuterKeyDown);
	const escapeEvent = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key: "Escape",
	});
	act(() => search.dispatchEvent(escapeEvent));
	document.body.removeEventListener("keydown", onOuterKeyDown);

	expect(escapeEvent.defaultPrevented).toBe(true);
	expect(bubbled).toBe(false);
	expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();
	expect(rendered.textarea.value).toBe("draft");
	expect(document.activeElement).toBe(rendered.textarea);
});

test("mousedown outside icon picker closes it and refocuses textarea", () => {
	const rendered = renderSkillTextarea({ initialValue: "draft" });
	act(() => rendered.rerenderPickerRequest(1));
	const search = rendered.container.querySelector<HTMLInputElement>(
		'input[aria-label="Search skills"]',
	);
	if (!search) throw new Error("Skill search input did not render");
	const outside = document.createElement("div");
	document.body.append(outside);

	const mouseDown = new window.MouseEvent("mousedown", {
		bubbles: true,
		cancelable: true,
	});
	act(() => outside.dispatchEvent(mouseDown));

	expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();
	expect(rendered.textarea.value).toBe("draft");
	expect(document.activeElement).toBe(rendered.textarea);
});

test("opening click that commits before document bubbling keeps icon picker open", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);

	function Harness() {
		const [pickerRequest, setPickerRequest] = useState(0);
		return (
			<>
				<button
					type="button"
					onClick={() => flushSync(() => setPickerRequest(1))}
				>
					Open picker
				</button>
				<SkillTextarea
					aria-label="Skill composer"
					value=""
					onChange={() => {}}
					onKeyDown={() => {}}
					skills={skills}
					pickerRequest={pickerRequest}
				/>
			</>
		);
	}

	act(() => root.render(<Harness />));
	const button = container.querySelector<HTMLButtonElement>("button");
	if (!button) throw new Error("Picker trigger did not render");

	let pickerMountedAtDocumentBubble = false;
	const observeDocumentClick = () => {
		pickerMountedAtDocumentBubble =
			container.querySelector('input[aria-label="Search skills"]') !== null;
	};
	document.addEventListener("click", observeDocumentClick);
	act(() => button.click());
	document.removeEventListener("click", observeDocumentClick);

	const search = container.querySelector<HTMLInputElement>(
		'input[aria-label="Search skills"]',
	);
	expect(pickerMountedAtDocumentBubble).toBe(true);
	expect(search).not.toBeNull();
	expect(document.activeElement).toBe(search);
});

test("Escape keeps the current query dismissed until it stops matching", () => {
	const rendered = renderSkillTextarea();
	act(() => inputText(rendered.textarea, "/"));
	act(() => pressKey(rendered.textarea, "Escape"));
	act(() => inputText(rendered.textarea, "/re"));
	expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();

	act(() => inputText(rendered.textarea, "draft"));
	act(() => inputText(rendered.textarea, "/"));
	expect(rendered.container.querySelector('[role="listbox"]')).not.toBeNull();
});

test("Backspace at inserted token end removes complete token", () => {
	const rendered = renderSkillTextarea();
	act(() => inputText(rendered.textarea, "/"));
	act(() => pressKey(rendered.textarea, "Enter"));
	expect(rendered.textarea.value).toBe("/review-newest ");

	const tokenEnd = "/review-newest".length;
	act(() => rendered.textarea.setSelectionRange(tokenEnd, tokenEnd));
	const backspace = new window.KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key: "Backspace",
	});
	act(() => rendered.textarea.dispatchEvent(backspace));

	expect(rendered.textarea.value).toBe(" ");
	expect(
		rendered.container.querySelectorAll("mark[data-skill-token]"),
	).toHaveLength(0);
	expect(backspace.defaultPrevented).toBe(true);
});

test("backdrop highlights one mark for each recognized token", () => {
	const rendered = renderSkillTextarea({
		initialValue: "/review-newest /summarize",
	});

	const marks = [
		...rendered.container.querySelectorAll("mark[data-skill-token]"),
	];
	expect(marks).toHaveLength(2);
	expect(marks.map((mark) => mark.textContent)).toEqual([
		"/review-newest",
		"/summarize",
	]);
});
