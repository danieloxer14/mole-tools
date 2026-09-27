import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { INSTALL_COMMAND, UpdateAvailable } from "./UpdateAvailable";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const originalClipboard = Object.getOwnPropertyDescriptor(
	navigator,
	"clipboard",
);

function renderUpdateAvailable(): HTMLDivElement {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => {
		root.render(<UpdateAvailable current="0.9.0" latest="0.10.0" />);
	});
	return container;
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.replaceChildren();
	if (originalClipboard) {
		Object.defineProperty(navigator, "clipboard", originalClipboard);
	} else {
		Reflect.deleteProperty(navigator, "clipboard");
	}
});

test("renders latest version as an available update button", () => {
	const container = renderUpdateAvailable();
	const button = container.querySelector<HTMLButtonElement>(
		"[data-update-available]",
	);

	expect(button?.textContent).toBe("Update 0.10.0 available");
});

test("opens update dialog and copies exact install command", async () => {
	let copiedCommand: string | undefined;
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				copiedCommand = text;
			},
		},
	});
	const container = renderUpdateAvailable();
	const updateButton = container.querySelector<HTMLButtonElement>(
		"[data-update-available]",
	);
	expect(updateButton).not.toBeNull();
	await act(async () => {
		updateButton?.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});

	const dialog = document.body.querySelector('[role="dialog"]');
	expect(dialog?.textContent).toContain("Update mole-tools");
	expect(dialog?.textContent).toContain("installed 0.9.0");
	const command = dialog?.querySelector("[data-install-command]");
	expect(command?.textContent).toBe(INSTALL_COMMAND);
	expect(command?.textContent).toBe(
		"curl -fsSL https://raw.githubusercontent.com/danieloxer14/mole-tools/main/install.sh | bash",
	);

	const copyButton = dialog?.querySelector<HTMLButtonElement>(
		'[aria-label="Copy install command"]',
	);
	expect(copyButton).not.toBeNull();
	await act(async () => {
		copyButton?.click();
		await Promise.resolve();
	});
	expect(copiedCommand).toBe(INSTALL_COMMAND);
	const status = dialog?.querySelector('[role="status"]');
	expect(status?.getAttribute("aria-live")).toBe("polite");
	expect(status?.textContent).toBe("Install command copied to clipboard");
	await act(async () => {
		await new Promise<void>((resolve) => setTimeout(resolve, 1600));
	});
	expect(status?.textContent).toBe("");
});

test("ignores clipboard write rejection", async () => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: () => Promise.reject(new Error("clipboard unavailable")),
		},
	});
	const container = renderUpdateAvailable();
	const updateButton = container.querySelector<HTMLButtonElement>(
		"[data-update-available]",
	);
	await act(async () => {
		updateButton?.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	const dialog = document.body.querySelector('[role="dialog"]');
	const copyButton = dialog?.querySelector<HTMLButtonElement>(
		'[aria-label="Copy install command"]',
	);

	await act(async () => {
		copyButton?.click();
		await Promise.resolve();
	});
	expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
	expect(dialog?.querySelector("[data-install-command]")?.textContent).toBe(
		INSTALL_COMMAND,
	);
});
