import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ImportanceSpan } from "../../importance";
import { importanceTitle } from "../importance";
import { ImportanceContestDialog } from "./ImportanceContestDialog";

type DialogProps = ComponentProps<typeof ImportanceContestDialog>;
type Control = HTMLInputElement | HTMLSelectElement;

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const target = {
	path: "src/app.ts",
	span: {
		side: "new",
		startLine: 10,
		endLine: 12,
		score: 3,
		reason: "Current reason",
	} satisfies ImportanceSpan,
};

function renderDialog(overrides: Partial<DialogProps> = {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const props: DialogProps = {
		target,
		onClose: () => {},
		onSubmit: async () => "## Importance contest\n\nReport text.",
		finalFocusTarget: () => null,
		...overrides,
	};
	act(() => root.render(<ImportanceContestDialog {...props} />));
	return container;
}

function currentDialog(): HTMLElement {
	const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
	if (dialog === null) throw new Error("Contest dialog is not open");
	return dialog;
}

function buttonNamed(dialog: HTMLElement, label: string): HTMLButtonElement {
	const button = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
		(candidate) => candidate.textContent?.trim() === label,
	);
	if (!button) throw new Error(`Button not found: ${label}`);
	return button;
}

function changeControl(control: Control, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(control),
		"value",
	)?.set;
	setter?.call(control, value);
	const event = control.ownerDocument.createEvent("Event");
	event.initEvent(control.tagName === "SELECT" ? "change" : "input", true);
	control.dispatchEvent(event);
}

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
});

test("shows span context and submits only a changed score with a reason", async () => {
	const submissions: Array<[number, string]> = [];
	renderDialog({
		onSubmit: async (score, reason) => {
			submissions.push([score, reason]);
			return "## Importance contest\n\nUpdated score report.";
		},
	});
	const dialog = currentDialog();
	expect(dialog.textContent).toContain("Contest importance");
	expect(dialog.textContent).toContain("src/app.ts · new lines 10–12");
	expect(dialog.textContent).toContain(importanceTitle(3));

	const level = dialog.querySelector<HTMLSelectElement>(
		"#importance-contest-level",
	);
	const reason = dialog.querySelector<HTMLInputElement>(
		"#importance-contest-reason",
	);
	if (!level || !reason) throw new Error("Contest form controls are missing");
	const submit = buttonNamed(dialog, "Submit");
	expect(submit.disabled).toBe(true);
	act(() => changeControl(reason, "  "));
	expect(submit.disabled).toBe(true);
	act(() => changeControl(level, "4"));
	act(() => changeControl(reason, "Updated reason"));
	expect(submit.disabled).toBe(false);
	await act(async () => {
		submit.click();
		await Promise.resolve();
	});
	expect(submissions).toEqual([[4, "Updated reason"]]);
	expect(currentDialog().textContent).toContain("Contest report");
	expect(currentDialog().textContent).toContain("Importance updated to");
	expect(
		currentDialog().querySelector<HTMLTextAreaElement>("textarea")?.value,
	).toContain("Updated score report.");
});

test("keeps failed contest input available for correction", async () => {
	renderDialog({
		onSubmit: async () => {
			throw new Error("Contest conflict");
		},
	});
	const dialog = currentDialog();
	const level = dialog.querySelector<HTMLSelectElement>(
		"#importance-contest-level",
	);
	const reason = dialog.querySelector<HTMLInputElement>(
		"#importance-contest-reason",
	);
	if (!level || !reason) throw new Error("Contest form controls are missing");
	act(() => changeControl(level, "4"));
	act(() => changeControl(reason, "Updated reason"));
	await act(async () => {
		buttonNamed(dialog, "Submit").click();
		await Promise.resolve();
	});
	expect(currentDialog().textContent).toContain("Contest conflict");
	expect(
		currentDialog().querySelector<HTMLSelectElement>(
			"#importance-contest-level",
		)?.value,
	).toBe("4");
	expect(
		currentDialog().querySelector<HTMLInputElement>(
			"#importance-contest-reason",
		)?.value,
	).toBe("Updated reason");
});
