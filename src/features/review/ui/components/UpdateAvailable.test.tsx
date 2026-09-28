import { afterEach, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReleaseNotes } from "../../release-notes";
import { INSTALL_COMMAND, UpdateAvailable } from "./UpdateAvailable";

type UpdateAvailableProps = ComponentProps<typeof UpdateAvailable>;
interface RenderedUpdate {
	container: HTMLDivElement;
	root: Root;
	props: UpdateAvailableProps;
}

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const originalClipboard = Object.getOwnPropertyDescriptor(
	navigator,
	"clipboard",
);

function renderUpdateAvailable(
	overrides: Partial<UpdateAvailableProps> = {},
): RenderedUpdate {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const props: UpdateAvailableProps = {
		latest: "0.10.0",
		releases: [],
		autoOpen: false,
		onAutoOpened: () => {},
		...overrides,
	};
	act(() => {
		root.render(<UpdateAvailable {...props} />);
	});
	return { container, root, props };
}

function expectBefore(before: Element | null, after: Element | null): void {
	expect(before).not.toBeNull();
	expect(after).not.toBeNull();
	if (before !== null && after !== null) {
		expect(
			Boolean(
				before.compareDocumentPosition(after) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			),
		).toBe(true);
	}
}

function closeButton(dialog: Element): HTMLButtonElement | undefined {
	return [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
		(button) => button.textContent?.trim() === "Close",
	);
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

test("keeps the update button visible without auto-opening or acknowledging manual opens", async () => {
	const acknowledged: string[] = [];
	const { container } = renderUpdateAvailable({
		onAutoOpened: (version) => acknowledged.push(version),
	});
	const button = container.querySelector<HTMLButtonElement>(
		"[data-update-available]",
	);

	expect(button?.textContent).toBe("Update 0.10.0 available");
	expect(document.body.querySelector('[role="dialog"]')).toBeNull();
	await act(async () => {
		button?.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
	expect(acknowledged).toEqual([]);
});

test("auto-opens once per version and manual reopen does not acknowledge again", async () => {
	const acknowledged: string[] = [];
	const rendered = renderUpdateAvailable({
		onAutoOpened: (version) => acknowledged.push(version),
	});

	expect(document.body.querySelector('[role="dialog"]')).toBeNull();
	act(() => {
		rendered.root.render(
			<UpdateAvailable {...rendered.props} autoOpen={true} />,
		);
	});
	expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
	expect(acknowledged).toEqual(["0.10.0"]);

	act(() => {
		rendered.root.render(
			<UpdateAvailable {...rendered.props} autoOpen={true} />,
		);
	});
	act(() => {
		rendered.root.render(
			<UpdateAvailable {...rendered.props} autoOpen={true} latest="0.10.1" />,
		);
	});
	expect(acknowledged).toEqual(["0.10.0", "0.10.1"]);
	act(() => {
		rendered.root.render(
			<UpdateAvailable {...rendered.props} autoOpen={true} />,
		);
	});
	expect(acknowledged).toEqual(["0.10.0", "0.10.1"]);

	const dialog = document.body.querySelector('[role="dialog"]');
	const close = dialog ? closeButton(dialog) : undefined;
	expect(close).toBeDefined();
	await act(async () => {
		close?.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	expect(document.body.querySelector('[role="dialog"]')).toBeNull();

	await act(async () => {
		rendered.container
			.querySelector<HTMLButtonElement>("[data-update-available]")
			?.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
	expect(acknowledged).toEqual(["0.10.0", "0.10.1"]);
	expect(
		rendered.container.querySelector("[data-update-available]"),
	).not.toBeNull();
});

test("renders ordered plain-text release notes before the fixed command and instruction", () => {
	const unsafeText = "<img src=x onerror=alert(1)>";
	const releases: ReleaseNotes[] = [
		{
			version: "0.10.2",
			description: unsafeText,
			features: ["A new review workflow"],
			improvements: [],
			fixes: [],
		},
		{
			version: "0.10.1",
			description: "Improves update checks",
			features: [],
			improvements: ["Faster update status"],
			fixes: ["Avoids a stale review state"],
		},
	];
	renderUpdateAvailable({ autoOpen: true, releases });

	const dialog = document.body.querySelector('[role="dialog"]');
	expect(dialog).not.toBeNull();
	expect(dialog?.querySelector('[data-slot="dialog-title"]')?.textContent).toBe(
		"0.10.0 is available",
	);
	expect(dialog?.textContent).not.toContain("installed");

	const notes = dialog?.querySelector<HTMLElement>("[data-release-notes]");
	const entries = [...(notes?.querySelectorAll("article") ?? [])];
	expect(entries.map((entry) => entry.dataset.releaseEntry)).toEqual([
		"0.10.2",
		"0.10.1",
	]);
	expect(entries[0]?.querySelector("h3")?.textContent).toBe("0.10.2");
	expect(entries[0]?.querySelector("p")?.textContent).toBe(unsafeText);
	expect(entries[0]?.querySelector("img")).toBeNull();
	expect(
		[...(entries[0]?.querySelectorAll("h4") ?? [])].map(
			(heading) => heading.textContent,
		),
	).toEqual(["Features"]);
	expect(
		[...(entries[1]?.querySelectorAll("h4") ?? [])].map(
			(heading) => heading.textContent,
		),
	).toEqual(["Improvements", "Fixes"]);
	expect(entries[0]?.querySelector("li")?.textContent).toBe(
		"A new review workflow",
	);
	expect(
		entries[1]?.querySelector("section[aria-label='Features']"),
	).toBeNull();

	const command = dialog?.querySelector<HTMLElement>("[data-install-command]");
	const commandRow = command?.closest("pre")?.parentElement ?? null;
	const instruction = dialog?.querySelector('[data-slot="dialog-description"]');
	expect(command?.textContent).toBe(INSTALL_COMMAND);
	expect(commandRow?.contains(notes ?? null)).toBe(false);
	expect(notes?.contains(command ?? null)).toBe(false);
	expect(instruction?.textContent).toBe(
		"Run the above command in a terminal, then restart mole-tools review",
	);
	expectBefore(notes ?? null, commandRow);
	expectBefore(commandRow, instruction ?? null);
	expect(
		dialog?.querySelector('[aria-label="Copy install command"]'),
	).not.toBeNull();
});

test("copies the exact command and announces success until its timer expires", async () => {
	let copiedCommand: string | undefined;
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				copiedCommand = text;
			},
		},
	});
	const { container } = renderUpdateAvailable();
	await act(async () => {
		container
			.querySelector<HTMLButtonElement>("[data-update-available]")
			?.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});

	const dialog = document.body.querySelector('[role="dialog"]');
	const copyButton = dialog?.querySelector<HTMLButtonElement>(
		'[aria-label="Copy install command"]',
	);
	expect(copyButton).not.toBeNull();
	expect(copyButton?.querySelector("svg.lucide-copy")).not.toBeNull();
	await act(async () => {
		copyButton?.click();
		await Promise.resolve();
	});

	expect(copiedCommand).toBe(INSTALL_COMMAND);
	expect(copyButton?.querySelector("svg.lucide-check")).not.toBeNull();
	expect(copyButton?.getAttribute("aria-label")).toBe("Copy install command");
	const status = dialog?.querySelector('[role="status"]');
	expect(status?.getAttribute("aria-live")).toBe("polite");
	expect(status?.textContent).toBe("Install command copied to clipboard");
	await act(async () => {
		await new Promise<void>((resolve) => setTimeout(resolve, 1600));
	});
	expect(status?.textContent).toBe("");
	expect(copyButton?.querySelector("svg.lucide-copy")).not.toBeNull();
});

test("keeps the dialog usable when clipboard writes fail", async () => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: () => Promise.reject(new Error("clipboard unavailable")),
		},
	});
	const { container } = renderUpdateAvailable();
	await act(async () => {
		container
			.querySelector<HTMLButtonElement>("[data-update-available]")
			?.click();
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
	expect(copyButton?.querySelector("svg.lucide-copy")).not.toBeNull();
	expect(dialog?.querySelector('[role="status"]')?.textContent).toBe("");
});
