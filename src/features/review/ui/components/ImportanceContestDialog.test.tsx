import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ImportanceSpan } from "../../importance";
import { importanceTitle } from "../importance";
import {
	IMPORTANCE_CONTEST_ISSUE_URL,
	ImportanceContestDialog,
} from "./ImportanceContestDialog";

type DialogProps = ComponentProps<typeof ImportanceContestDialog>;
type Control = HTMLInputElement | HTMLSelectElement;

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const originalClipboard = Object.getOwnPropertyDescriptor(
	navigator,
	"clipboard",
);
const report = "## Importance contest\n\nReport text exactly.";
const firstTarget = {
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
	let props: DialogProps = {
		target: firstTarget,
		onClose: () => {},
		onSubmit: async () => report,
		finalFocusTarget: () => null,
		...overrides,
	};
	act(() => root.render(<ImportanceContestDialog {...props} />));
	return {
		rerender(next: Partial<DialogProps>) {
			props = { ...props, ...next };
			act(() => root.render(<ImportanceContestDialog {...props} />));
		},
	};
}

function currentDialog(): HTMLElement {
	const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
	if (dialog === null) throw new Error("Contest dialog is not open");
	return dialog;
}

function buttonNamed(dialog: HTMLElement, name: string): HTMLButtonElement {
	const button = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
		(candidate) => candidate.textContent?.trim() === name,
	);
	if (button === undefined) throw new Error(`Button not found: ${name}`);
	return button;
}

function buttonLabels(dialog: HTMLElement): string[] {
	return [...dialog.querySelectorAll<HTMLButtonElement>("button")].map(
		(button) => button.textContent?.trim() ?? "",
	);
}

function changeControl(control: Control, value: string): void {
	const valueSetter = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(control),
		"value",
	)?.set;
	valueSetter?.call(control, value);
	const event = control.ownerDocument.createEvent("Event");
	event.initEvent(control.tagName === "SELECT" ? "change" : "input", true);
	control.dispatchEvent(event);
}
async function expectFocusRestored(close: () => Promise<void>) {
	const strip = document.createElement("button");
	const opener = document.createElement("button");
	opener.textContent = "Contest";
	document.body.append(strip, opener);
	opener.focus();
	let closeDialog = () => {};
	const rendered = renderDialog({
		finalFocusTarget: () => strip,
		onClose: () => closeDialog(),
	});
	opener.remove();
	closeDialog = () => rendered.rerender({ target: null });

	await close();
	expect(document.activeElement).toBe(strip);
}

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
	if (originalClipboard) {
		Object.defineProperty(navigator, "clipboard", originalClipboard);
	} else {
		Reflect.deleteProperty(navigator, "clipboard");
	}
});

test("renders current span and enables submit only for a meaningful change", () => {
	const { rerender } = renderDialog();
	const dialog = currentDialog();
	expect(dialog.querySelector('[data-slot="dialog-title"]')?.textContent).toBe(
		"Contest importance",
	);
	expect(
		dialog.querySelector('[data-slot="dialog-description"]')?.textContent,
	).toBe("src/app.ts · new lines 10–12");
	expect(dialog.textContent).toContain("Current score");
	expect(dialog.textContent).toContain(importanceTitle(3));
	expect(dialog.textContent).toContain("Current reason");

	const level = dialog.querySelector<HTMLSelectElement>(
		"#importance-contest-level",
	);
	const reason = dialog.querySelector<HTMLInputElement>(
		"#importance-contest-reason",
	);
	const submit = buttonNamed(dialog, "Submit");
	expect(level?.value).toBe("3");
	const scores = [1, 2, 3, 4, 5] as const;
	expect(
		[...(level?.options ?? [])].map((option) => option.textContent),
	).toEqual(scores.map((score) => importanceTitle(score)));
	expect(reason?.value).toBe("");
	expect(reason?.maxLength).toBe(144);
	expect(reason?.placeholder).toBe("One sentence, up to 144 characters");
	expect(submit.disabled).toBe(true);

	if (reason === null || level === null)
		throw new Error("Form inputs not found");
	act(() => changeControl(reason, "Current reason"));
	expect(submit.disabled).toBe(true);
	act(() => changeControl(level, "4"));
	expect(submit.disabled).toBe(false);
	act(() => changeControl(reason, "  "));
	expect(submit.disabled).toBe(true);
	act(() => changeControl(reason, "New reason"));
	expect(submit.disabled).toBe(false);
	rerender({ target: null });
});

test("reports submitted score even when level changes while submission is pending", async () => {
	let resolveSubmit: ((value: string) => void) | undefined;
	const pendingReport = new Promise<string>((resolve) => {
		resolveSubmit = resolve;
	});
	let appliedScore: number | undefined;
	const { rerender } = renderDialog({
		onSubmit: (score) => {
			appliedScore = score;
			return pendingReport;
		},
	});
	const dialog = currentDialog();
	const level = dialog.querySelector<HTMLSelectElement>(
		"#importance-contest-level",
	);
	const reason = dialog.querySelector<HTMLInputElement>(
		"#importance-contest-reason",
	);
	if (level === null || reason === null)
		throw new Error("Form inputs not found");
	act(() => {
		changeControl(level, "5");
		changeControl(reason, "New reason");
	});
	await act(async () => {
		buttonNamed(dialog, "Submit").click();
		await Promise.resolve();
	});
	expect(buttonNamed(dialog, "Submitting…").disabled).toBe(true);
	expect(buttonLabels(dialog)).toContain("Submitting…");
	act(() => changeControl(level, "1"));

	const completeSubmission = resolveSubmit;
	if (completeSubmission === undefined)
		throw new Error("Submission did not start");
	await act(async () => {
		completeSubmission(report);
		await pendingReport;
	});
	const reportDialog = currentDialog();
	expect(appliedScore).toBe(5);
	expect(reportDialog.textContent).toContain(
		`Importance updated to ${importanceTitle(5)}.`,
	);
	expect(reportDialog.textContent).not.toContain(
		`Importance updated to ${importanceTitle(1)}.`,
	);
	act(() => buttonNamed(reportDialog, "Close").click());
	rerender({ target: null });
});

test("keeps rejected form values, trims resubmission, then renders report and copies it", async () => {
	const submissions: Array<[number, string]> = [];
	let rejectSubmission: ((error: Error) => void) | undefined;
	const failedSubmission = new Promise<string>((_, reject) => {
		rejectSubmission = reject;
	});
	let attempt = 0;
	let closeCount = 0;
	const { rerender } = renderDialog({
		onClose: () => closeCount++,
		onSubmit: (score, reason) => {
			submissions.push([score, reason]);
			attempt++;
			return attempt === 1 ? failedSubmission : Promise.resolve(report);
		},
	});
	let dialog = currentDialog();
	const level = dialog.querySelector<HTMLSelectElement>(
		"#importance-contest-level",
	);
	const reason = dialog.querySelector<HTMLInputElement>(
		"#importance-contest-reason",
	);
	if (level === null || reason === null)
		throw new Error("Form inputs not found");
	act(() => {
		changeControl(level, "4");
		changeControl(reason, "  trimmed reason  ");
	});
	const submit = buttonNamed(dialog, "Submit");
	expect(submit.disabled).toBe(false);
	const reject = rejectSubmission;
	if (reject === undefined) throw new Error("Submission did not start");
	await act(async () => {
		submit.click();
		reject(new Error("Importance results changed"));
		await failedSubmission.catch(() => undefined);
	});
	expect(submissions).toEqual([[4, "trimmed reason"]]);
	expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
		"Importance results changed",
	);
	expect(
		dialog.querySelector<HTMLInputElement>("#importance-contest-level")?.value,
	).toBe("4");
	expect(
		dialog.querySelector<HTMLInputElement>("#importance-contest-reason")?.value,
	).toBe("  trimmed reason  ");
	expect(dialog.querySelector('[data-slot="dialog-title"]')?.textContent).toBe(
		"Contest importance",
	);

	await act(async () => {
		buttonNamed(dialog, "Submit").click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	dialog = currentDialog();
	expect(submissions).toEqual([
		[4, "trimmed reason"],
		[4, "trimmed reason"],
	]);
	expect(dialog.querySelector('[data-slot="dialog-title"]')?.textContent).toBe(
		"Contest report",
	);
	expect(dialog.textContent).toContain(
		`Importance updated to ${importanceTitle(4)}.`,
	);
	const textarea = dialog.querySelector<HTMLTextAreaElement>(
		'[aria-label="Contest report"]',
	);
	expect(textarea?.value).toBe(report);
	expect(textarea?.readOnly).toBe(true);
	const issueLink = dialog.querySelector<HTMLAnchorElement>("a");
	expect(issueLink?.getAttribute("href")).toBe(IMPORTANCE_CONTEST_ISSUE_URL);
	expect(issueLink?.getAttribute("target")).toBe("_blank");
	expect(issueLink?.getAttribute("rel")).toBe("noreferrer");
	expect(dialog.textContent).toContain(
		"GitHub issues are public — remove confidential code, file paths, and names before posting.",
	);

	let copied: string | undefined;
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				copied = text;
			},
		},
	});
	await act(async () => {
		buttonNamed(dialog, "Copy report").click();
		await Promise.resolve();
	});
	expect(copied).toBe(report);
	expect(buttonLabels(dialog)).toContain("Copied");
	await act(async () => {
		await new Promise<void>((resolve) => setTimeout(resolve, 1550));
	});
	expect(buttonLabels(dialog)).toContain("Copy report");
	await act(async () => {
		buttonNamed(dialog, "Close").click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	expect(closeCount).toBe(1);
	rerender({ target: null });
});

test("shows copy failure when clipboard rejects", async () => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: () => Promise.reject(new Error("clipboard unavailable")),
		},
	});
	const { rerender } = renderDialog();
	const dialog = currentDialog();
	const reason = dialog.querySelector<HTMLInputElement>(
		"#importance-contest-reason",
	);
	if (reason === null) throw new Error("Reason input not found");
	act(() => changeControl(reason, "Contest reason"));
	await act(async () => {
		buttonNamed(dialog, "Submit").click();
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	});
	await act(async () => {
		buttonNamed(currentDialog(), "Copy report").click();
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	});
	expect(buttonLabels(currentDialog())).toContain("Copy failed");
	act(() => buttonNamed(currentDialog(), "Close").click());
	rerender({ target: null });
});

test("resets form, score, and error when reopened for a different target", async () => {
	const { rerender } = renderDialog({
		onSubmit: async () => {
			throw new Error("Previous target failed");
		},
	});
	let dialog = currentDialog();
	const reason = dialog.querySelector<HTMLInputElement>(
		"#importance-contest-reason",
	);
	if (reason === null) throw new Error("Reason input not found");
	act(() => changeControl(reason, "Retry this contest"));
	await act(async () => {
		buttonNamed(dialog, "Submit").click();
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	});
	expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
		"Previous target failed",
	);

	rerender({ target: null });
	const nextTarget = {
		path: "src/other.ts",
		span: {
			side: "old",
			startLine: 20,
			endLine: 20,
			score: 5,
			reason: "Other current reason",
		} satisfies ImportanceSpan,
	};
	rerender({ target: nextTarget });
	dialog = currentDialog();
	expect(dialog.querySelector('[data-slot="dialog-title"]')?.textContent).toBe(
		"Contest importance",
	);
	expect(
		dialog.querySelector('[data-slot="dialog-description"]')?.textContent,
	).toBe("src/other.ts · old line 20");
	expect(
		dialog.querySelector<HTMLSelectElement>("#importance-contest-level")?.value,
	).toBe("5");
	expect(
		dialog.querySelector<HTMLInputElement>("#importance-contest-reason")?.value,
	).toBe("");
	expect(dialog.querySelector('[role="alert"]')).toBeNull();
	expect(buttonNamed(dialog, "Submit").disabled).toBe(true);
	rerender({ target: null });
});
test("ignores a submission result after the target changes while pending", async () => {
	let resolveSubmission: ((value: string) => void) | undefined;
	const submission = new Promise<string>((resolve) => {
		resolveSubmission = resolve;
	});
	const { rerender } = renderDialog({ onSubmit: () => submission });
	const reason = currentDialog().querySelector<HTMLInputElement>(
		"#importance-contest-reason",
	);
	if (reason === null) throw new Error("Reason input not found");
	act(() => changeControl(reason, "Contest A reason"));
	await act(async () => {
		buttonNamed(currentDialog(), "Submit").click();
		await Promise.resolve();
	});
	expect(buttonNamed(currentDialog(), "Submitting…").disabled).toBe(true);

	expect(buttonNamed(currentDialog(), "Cancel").disabled).toBe(true);
	rerender({ target: null });
	const nextTarget = {
		path: "src/other.ts",
		span: {
			side: "old",
			startLine: 20,
			endLine: 20,
			score: 5,
			reason: "Other current reason",
		} satisfies ImportanceSpan,
	};
	rerender({ target: nextTarget });
	const resolve = resolveSubmission;
	if (resolve === undefined) throw new Error("Submission did not start");
	await act(async () => {
		resolve(report);
		await submission;
	});

	const dialog = currentDialog();
	expect(dialog.querySelector('[data-slot="dialog-title"]')?.textContent).toBe(
		"Contest importance",
	);
	expect(
		dialog.querySelector('[data-slot="dialog-description"]')?.textContent,
	).toBe("src/other.ts · old line 20");
	expect(
		dialog.querySelector<HTMLTextAreaElement>('[aria-label="Contest report"]'),
	).toBeNull();
	expect(
		dialog.querySelector<HTMLInputElement>("#importance-contest-reason")?.value,
	).toBe("");
	rerender({ target: null });
});
test("blocks every dialog dismissal path until submission settles", async () => {
	let resolveSubmission: ((value: string) => void) | undefined;
	const submission = new Promise<string>((resolve) => {
		resolveSubmission = resolve;
	});
	let closeCount = 0;
	renderDialog({
		onClose: () => closeCount++,
		onSubmit: () => submission,
	});
	const dialog = currentDialog();
	const reason = dialog.querySelector<HTMLInputElement>(
		"#importance-contest-reason",
	);
	if (reason === null) throw new Error("Reason input not found");
	act(() => changeControl(reason, "Contest reason"));
	await act(async () => {
		buttonNamed(dialog, "Submit").click();
		await Promise.resolve();
	});

	expect(buttonNamed(dialog, "Cancel").disabled).toBe(true);
	expect(dialog.querySelector('[data-slot="dialog-close"]')).toBeNull();
	await act(async () => {
		document.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
		await Bun.sleep(0);
	});
	expect(currentDialog()).toBe(dialog);
	const backdrop = document.body.querySelector<HTMLElement>(
		'[data-slot="dialog-overlay"]',
	);
	expect(backdrop).not.toBeNull();
	await act(async () => {
		backdrop?.click();
		await Bun.sleep(0);
	});
	expect(currentDialog()).toBe(dialog);
	expect(closeCount).toBe(0);

	const resolve = resolveSubmission;
	if (resolve === undefined) throw new Error("Submission did not start");
	await act(async () => {
		resolve(report);
		await submission;
	});
	await act(async () => {
		buttonNamed(currentDialog(), "Close").click();
		await Bun.sleep(0);
	});
	expect(closeCount).toBe(1);
});

test("restores focus to the importance strip after Escape", async () => {
	await expectFocusRestored(async () => {
		await act(async () => {
			document.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
			await Bun.sleep(0);
		});
	});
});

test("restores focus to the importance strip after Cancel", async () => {
	await expectFocusRestored(async () => {
		await act(async () => {
			buttonNamed(currentDialog(), "Cancel").click();
			await Bun.sleep(0);
		});
	});
});

test("restores focus to the importance strip after successful Close", async () => {
	await expectFocusRestored(async () => {
		const reason = currentDialog().querySelector<HTMLInputElement>(
			"#importance-contest-reason",
		);
		if (reason === null) throw new Error("Reason input not found");
		act(() => changeControl(reason, "Contest reason"));
		await act(async () => {
			buttonNamed(currentDialog(), "Submit").click();
			await Bun.sleep(25);
		});
		expect(
			currentDialog().querySelector('[aria-label="Contest report"]'),
		).not.toBeNull();
		await act(async () => {
			buttonNamed(currentDialog(), "Close").click();
			await Bun.sleep(0);
		});
	});
});
