import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	errorToastMessage,
	refreshResultToast,
	type Toast,
	Toasts,
} from "./Toasts";

const dismiss = () => {};

test("renders nothing for an empty toast queue", () => {
	expect(renderToStaticMarkup(<Toasts toasts={[]} onDismiss={dismiss} />)).toBe(
		"",
	);
});

test("renders dismissible alert and status toasts", () => {
	const errorToast: Toast = { id: "error-1", kind: "error", message: "boom" };
	const infoToast: Toast = {
		id: "info-1",
		kind: "info",
		message: "Up to date",
	};
	const html = renderToStaticMarkup(
		<Toasts toasts={[errorToast, infoToast]} onDismiss={dismiss} />,
	);

	expect(html).toContain('role="alert"');
	expect(html).toContain("boom");
	expect(html).toContain('aria-label="Dismiss"');
	expect(html).toContain('role="status"');
	expect(html).toContain("Up to date");
});

test("creates refresh feedback only for an up-to-date result", () => {
	expect(refreshResultToast(false)).toEqual({
		kind: "info",
		message: "Up to date",
	});
	expect(refreshResultToast(true)).toBeNull();
});

test("normalizes unknown errors for toast messages", () => {
	expect(errorToastMessage(new Error("boom"))).toBe("boom");
	expect(errorToastMessage("raw")).toBe("raw");
});
