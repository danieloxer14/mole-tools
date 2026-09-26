import { Window as HappyWindow } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { PROMPT_NAMES } from "../../../../adapters/prompts/defaults";
import {
	type PromptSnapshot,
	SettingsPanel,
	type SettingsSnapshot,
} from "./SettingsPanel";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const initialSettings: SettingsSnapshot = {
	slots: PROMPT_NAMES.map((slot) => ({
		slot,
		activePreset: slot === "commit-system" ? "terse" : "default",
		presets:
			slot === "commit-system"
				? [
						{ name: "default", latest: 1 },
						{ name: "terse", latest: 3 },
					]
				: [{ name: "default", latest: 1 }],
	})),
	review: {
		agent: "omp",
		model: "claude-sonnet-4",
		agents: ["omp", "claude"],
	},
};

const initialPrompt: PromptSnapshot = {
	text: "loaded prompt text",
	preset: "terse",
	version: 3,
	versions: [1, 2, 3],
	agent: "omp",
	model: "sonnet",
	effort: null,
};

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
	});
}

async function flushReact(): Promise<void> {
	await Bun.sleep(0);
	await Bun.sleep(0);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const viewport = new HappyWindow({ width: 375, height: 667 });
const browserGlobals: Record<string, unknown> = {
	window: viewport,
	document: viewport.document,
	Node: viewport.Node,
	NodeFilter: viewport.NodeFilter,
	Element: viewport.Element,
	HTMLElement: viewport.HTMLElement,
	HTMLTemplateElement: viewport.HTMLTemplateElement,
	MutationObserver: viewport.MutationObserver,
	getComputedStyle: viewport.getComputedStyle.bind(viewport),
	DOMParser: viewport.DOMParser,
	Event: viewport.Event,
	MouseEvent: viewport.MouseEvent,
	KeyboardEvent: viewport.KeyboardEvent,
	PointerEvent: viewport.PointerEvent,
	CustomEvent: viewport.CustomEvent,
};
const originalGlobalDescriptors: Record<
	string,
	PropertyDescriptor | undefined
> = Object.fromEntries(
	Object.keys(browserGlobals).map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
);
for (const [name, value] of Object.entries(browserGlobals)) {
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input) => {
	if (String(input).includes("/api/settings/models?")) {
		return jsonResponse({
			models: [
				{
					id: "layout-model",
					label: "Layout model",
					efforts: ["low", "high"],
				},
			],
			source: "omp",
		});
	}
	return jsonResponse({});
}) as typeof fetch;

const container = viewport.document.createElement("div");
container.style.width = "343px";
container.style.height = "635px";
container.style.overflow = "hidden";
viewport.document.body.append(container);
const root = createRoot(container);

function focusControl(
	control: HTMLSelectElement | HTMLButtonElement | null,
): void {
	assert(control, "Expected settings control to be present");
	assert(!control.disabled, "Expected settings control to be enabled");
	assert(control.tabIndex === 0, "Expected settings control to be tabbable");
	const scrollPanel = control.closest<HTMLElement>(".overflow-auto");
	assert(
		scrollPanel?.className.includes("overflow-auto"),
		"Expected settings control inside a scrollable panel",
	);
	assert(
		scrollPanel.contains(control),
		"Expected scroll panel to contain settings control",
	);
	if (control instanceof viewport.HTMLSelectElement)
		assert(control.labels?.length, "Expected select to have a visible label");
	act(() => control.focus());
	assert(
		viewport.document.activeElement === control,
		"Expected settings control to receive keyboard focus",
	);
}

function expectTabOrder(selectors: string[]): void {
	const tabbableControls = Array.from(
		container.querySelectorAll<HTMLElement>(
			'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
		),
	).filter(
		(control) => !control.hasAttribute("disabled") && control.tabIndex >= 0,
	);
	const positions = selectors.map((selector) => {
		const control = container.querySelector<HTMLElement>(selector);
		assert(control, `Missing settings control ${selector}`);
		return tabbableControls.indexOf(control);
	});
	assert(
		positions.every((position) => position >= 0),
		"Expected every settings control in the tab order",
	);
	assert(
		JSON.stringify(positions) ===
			JSON.stringify([...positions].sort((a, b) => a - b)),
		"Expected settings controls to follow visual tab order",
	);
}

try {
	act(() =>
		root.render(
			createElement(SettingsPanel, {
				token: "settings-test-token",
				onClose: () => {},
				initialSettings,
				initialPrompt: {
					...initialPrompt,
					agent: "omp",
					model: "layout-model",
					effort: null,
				},
				initialTab: "general",
			}),
		),
	);
	await act(async () => {
		await flushReact();
	});
	assert(viewport.innerWidth === 375, "Expected 375px Happy DOM viewport");
	assert(
		container
			.querySelector("section[aria-busy]")
			?.className.includes("min-w-0"),
		"Expected settings content to shrink at narrow width",
	);
	assert(
		container
			.querySelector('[role="tablist"]')
			?.className.includes("flex-wrap"),
		"Expected settings tabs to wrap at narrow width",
	);
	assert(
		container.querySelector("fieldset")?.className.includes("flex-wrap"),
		"Expected General controls to wrap at narrow width",
	);

	const generalControls = [
		"#settings-default-agent",
		"#settings-default-model",
		"#settings-default-effort",
	];
	expectTabOrder(generalControls);
	for (const selector of generalControls) {
		focusControl(
			container.querySelector<HTMLSelectElement | HTMLButtonElement>(selector),
		);
	}
	const generalSave = Array.from(
		container.querySelectorAll<HTMLButtonElement>("button"),
	).find((button) => button.textContent?.trim() === "Save");
	focusControl(generalSave ?? null);

	const promptsTab = Array.from(
		container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
	).find((button) => button.textContent?.trim() === "Prompts");
	assert(promptsTab, "Prompts tab missing");
	await act(async () => {
		promptsTab.click();
		await flushReact();
	});
	assert(
		container
			.querySelector("#settings-prompt-agent")
			?.closest("fieldset")
			?.className.includes("flex-wrap"),
		"Expected prompt controls to wrap at narrow width",
	);
	await act(async () => {
		const promptEffort = container.querySelector<HTMLSelectElement>(
			"#settings-prompt-effort",
		);
		assert(promptEffort, "Missing prompt effort select");
		promptEffort.value = "high";
		promptEffort.dispatchEvent(new viewport.Event("change", { bubbles: true }));
		await flushReact();
	});
	const promptControls = [
		"#settings-prompt-agent",
		"#settings-prompt-model",
		"#settings-prompt-effort",
	];
	expectTabOrder(promptControls);
	for (const selector of promptControls) {
		focusControl(
			container.querySelector<HTMLSelectElement | HTMLButtonElement>(selector),
		);
	}
	const savePrompt = Array.from(
		container.querySelectorAll<HTMLButtonElement>("button"),
	).find((button) => button.textContent?.trim() === "Save as new version");
	focusControl(savePrompt ?? null);
	console.log("Happy DOM 375px settings smoke passed");
} finally {
	act(() => root.unmount());
	container.remove();
	globalThis.fetch = originalFetch;
	for (const [name, descriptor] of Object.entries(originalGlobalDescriptors)) {
		if (descriptor) {
			Object.defineProperty(globalThis, name, descriptor);
		} else {
			Reflect.deleteProperty(globalThis, name);
		}
	}
	await viewport.happyDOM.abort();
}
