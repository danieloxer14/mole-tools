import { expect, test } from "bun:test";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { PROMPT_NAMES } from "../../../../adapters/prompts/defaults";
import { applyColorTheme } from "../color-theme";
import {
	isSaveDisabled,
	MODEL_QUICK_PICKS,
	type PromptEditorValue,
	type PromptSnapshot,
	SettingsPanel,
	type SettingsSnapshot,
	SLOT_DESCRIPTIONS,
	SLOT_LABELS,
	VISIBLE_SLOTS,
} from "./SettingsPanel";

import { Dialog, DialogContent } from "./ui/dialog";

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
		agents: ["omp", "claude", "codex"],
	},
};

const initialPrompt: PromptSnapshot = {
	text: "loaded prompt text",
	preset: "terse",
	version: 3,
	versions: [1, 2, 3],
	agent: "omp",
	model: "sonnet",
};
function render(prompt: PromptSnapshot = initialPrompt): string {
	return renderToStaticMarkup(
		createElement(SettingsPanel, {
			token: "settings-test-token",
			onClose: () => {},
			initialSettings,
			initialPrompt: prompt,
		}),
	);
}

function escapedText(text: string): string {
	return text.replace(/'/g, "&#x27;");
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function setControlValue(
	element: HTMLInputElement | HTMLSelectElement | null,
	value: string,
	eventName: "change" | "input",
): void {
	if (!element) return;
	if (element instanceof window.HTMLInputElement) {
		Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype,
			"value",
		)?.set?.call(element, value);
	} else {
		element.value = value;
	}
	element.dispatchEvent(new window.Event(eventName, { bubbles: true }));
}

test("keeps visible slot labels in order and shows active preset and latest version", () => {
	expect(Object.keys(SLOT_LABELS)).toEqual([...PROMPT_NAMES]);
	expect(VISIBLE_SLOTS).toEqual([
		"review-layers-code",
		"review-layers-plan",
		"review-chat",
		"review-explain-comment",
		"review-comment-from-chat",
	]);
	const markup = render();
	expect(markup).toContain('class="text-2xl font-semibold">Settings</h2>');
	expect(markup).not.toContain("Review settings");

	const visibleLabels = VISIBLE_SLOTS.map((slot) => SLOT_LABELS[slot]);
	const indexes = visibleLabels.map((label) => markup.indexOf(label));
	expect(indexes).toEqual([...indexes].sort((a, b) => a - b));

	for (const slot of PROMPT_NAMES) {
		if (VISIBLE_SLOTS.includes(slot)) {
			expect(markup).toContain(SLOT_LABELS[slot]);
		} else {
			expect(markup).not.toContain(SLOT_LABELS[slot]);
		}
	}
	expect(markup).toMatch(
		/<button[^>]*data-active="true"[^>]*aria-current="true"[^>]*>[\s\S]*?<span class="block text-sm font-medium">Review layers \(code\)<\/span>/,
	);
	expect((markup.match(/aria-current="true"/g) ?? []).length).toBe(1);
	expect(markup).toContain("default (active)");
	expect(markup).toContain("v3");
});

test("renders a description for the selected slot", () => {
	const markup = render();

	expect(markup).toContain(SLOT_DESCRIPTIONS["review-layers-code"]);
	expect(markup).toMatch(
		/<p class="text-sm text-muted-foreground">[\s\S]*?<\/p>/,
	);
	for (const slot of PROMPT_NAMES) {
		if (!VISIBLE_SLOTS.includes(slot)) {
			expect(markup).not.toContain(escapedText(SLOT_DESCRIPTIONS[slot]));
		}
	}
});

test("SLOT_DESCRIPTIONS has exactly one entry per prompt slot", () => {
	expect(Object.keys(SLOT_DESCRIPTIONS).sort()).toEqual(
		[...PROMPT_NAMES].sort(),
	);
});

test("description follows the selected slot, not the first visible one", () => {
	const settings: SettingsSnapshot = {
		slots: [
			{
				slot: "review-chat",
				activePreset: "default",
				presets: [{ name: "default", latest: 1 }],
			},
			...initialSettings.slots.filter((slot) => slot.slot !== "review-chat"),
		],
		review: initialSettings.review,
	};
	const markup = renderToStaticMarkup(
		createElement(SettingsPanel, {
			token: "settings-test-token",
			onClose: () => {},
			initialSettings: settings,
			initialPrompt: {
				...initialPrompt,
				preset: "default",
				version: 1,
				versions: [1],
			},
		}),
	);
	expect(markup).toContain(escapedText(SLOT_DESCRIPTIONS["review-chat"]));
	expect(markup).not.toContain(
		escapedText(SLOT_DESCRIPTIONS["review-layers-code"]),
	);
	expect(markup).not.toContain(
		escapedText(SLOT_DESCRIPTIONS["review-layers-plan"]),
	);
});
test("isSaveDisabled covers unchanged, changed, and pending values", () => {
	const loaded: PromptEditorValue = {
		text: "same",
		agent: "default",
		model: "sonnet",
	};
	expect(isSaveDisabled(loaded, { ...loaded }, false)).toBe(true);
	expect(isSaveDisabled(loaded, { ...loaded, agent: "omp" }, false)).toBe(
		false,
	);
	expect(isSaveDisabled(loaded, { ...loaded, model: " opus " }, false)).toBe(
		false,
	);
	expect(isSaveDisabled(loaded, { ...loaded, model: " sonnet " }, false)).toBe(
		true,
	);
	expect(isSaveDisabled(loaded, { ...loaded, text: "changed" }, false)).toBe(
		false,
	);
	expect(isSaveDisabled(loaded, { ...loaded, text: "changed" }, true)).toBe(
		true,
	);
});
test("renders version agent and model with default label", () => {
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: { ...initialSettings.review, agent: "claude" },
	};
	const markup = renderToStaticMarkup(
		createElement(SettingsPanel, {
			token: "settings-test-token",
			onClose: () => {},
			initialSettings: settings,
			initialPrompt: { ...initialPrompt, agent: "omp", model: "sonnet" },
		}),
	);

	expect(markup).toContain('<option value="default">Default (claude)</option>');
	expect(markup).toContain('<option value="omp" selected="">omp</option>');
	expect(markup).toContain('id="settings-prompt-model"');
	expect(markup).toContain('value="sonnet"');
});
test("save posts agent and model", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const prompt = { ...initialPrompt, agent: null, model: null };
	const jsonResponse = (value: unknown) =>
		new Response(JSON.stringify(value), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (url.includes("/api/skills")) return jsonResponse({ skills: [] });
		if (init?.method === "POST") {
			return jsonResponse({ version: 4, saved: true });
		}
		if (url.includes("/api/settings")) {
			return jsonResponse(initialSettings);
		}
		return jsonResponse({
			...prompt,
			agent: "omp",
			model: "sonnet",
			version: 4,
			versions: [1, 2, 3, 4],
		});
	}) as unknown as typeof fetch;

	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	const setValue = (
		element: HTMLInputElement | HTMLSelectElement | null,
		value: string,
		eventName: "change" | "input",
	) => {
		if (!element) return;
		if (element instanceof window.HTMLInputElement) {
			Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			)?.set?.call(element, value);
		} else {
			element.value = value;
		}
		element.dispatchEvent(new window.Event(eventName, { bubbles: true }));
	};
	const saveButton = () =>
		Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Save as new version"),
		);

	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialSettings,
					initialPrompt: prompt,
				}),
			),
		);
		await act(async () => {
			setValue(
				container.querySelector("#settings-prompt-agent"),
				"omp",
				"change",
			);
			setValue(
				container.querySelector("#settings-prompt-model"),
				"sonnet",
				"input",
			);
			await Bun.sleep(0);
		});
		await act(async () => {
			saveButton()?.click();
			await Bun.sleep(0);
		});
		const postRequests = () =>
			calls.filter((call) => call.init?.method === "POST");
		expect(JSON.parse(String(postRequests()[0]?.init?.body))).toEqual({
			preset: "terse",
			text: "loaded prompt text",
			agent: "omp",
			model: "sonnet",
		});

		await act(async () => {
			await Bun.sleep(0);
			await Bun.sleep(0);
			setValue(
				container.querySelector("#settings-prompt-agent"),
				"default",
				"change",
			);
			setValue(container.querySelector("#settings-prompt-model"), "", "input");
			await Bun.sleep(0);
		});
		await act(async () => {
			saveButton()?.click();
			await Bun.sleep(0);
		});
		expect(JSON.parse(String(postRequests()[1]?.init?.body))).toEqual({
			preset: "terse",
			text: "loaded prompt text",
			agent: null,
			model: null,
		});
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("disables unchanged saves and renders review agent options and model", () => {
	const markup = render();
	expect(markup).toContain('rows="15"');

	expect(markup).toMatch(
		/<button[^>]*disabled(?:="")?[^>]*>Save as new version<\/button>/,
	);
	expect(markup).toContain('<option value="omp" selected="">omp</option>');
	expect(markup).toContain('<option value="claude">claude</option>');
	expect(markup).toContain('value="claude-sonnet-4"');
	expect(markup).toContain('<select id="settings-model-quickpick"');
	expect(markup).toMatch(
		/<select[^>]*id="settings-model-quickpick"[^>]*>\s*<option value="" selected="">Custom…<\/option>\s*<\/select>/,
	);
	for (const model of MODEL_QUICK_PICKS) {
		expect(markup).not.toContain(`<option value="${model}">`);
	}
});

test("renders codex options for review and prompt agents", () => {
	const markup = render();
	expect(markup.split('<option value="codex">codex</option>').length - 1).toBe(
		2,
	);
});

test("keeps codex selected for review and prompt agents", () => {
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);

	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialSettings,
					initialPrompt,
				}),
			),
		);
		for (const id of ["#settings-agent", "#settings-prompt-agent"]) {
			const select = container.querySelector<HTMLSelectElement>(id);
			if (!select) throw new Error(`Missing select ${id}`);
			act(() => {
				select.value = "codex";
				select.dispatchEvent(new window.Event("change", { bubbles: true }));
			});
			expect(container.querySelector<HTMLSelectElement>(id)?.value).toBe(
				"codex",
			);
		}
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("styles prompt text like Skills with editor spacing", () => {
	const markup = render();

	expect(markup).toContain(
		'<label class="block text-sm font-medium" for="settings-prompt">Prompt text</label>',
	);
	expect(markup).toMatch(
		/<div class="space-y-2"><label class="block text-sm font-medium" for="settings-prompt">Prompt text<\/label><textarea(?=[^>]*class="[^"]*min-h-64 font-mono text-sm")(?=[^>]*id="settings-prompt")[^>]*>/,
	);
});

test("quickpick and text input both reflect a listed Claude model", () => {
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: { ...initialSettings.review, agent: "claude", model: "sonnet" },
	};
	const markup = renderToStaticMarkup(
		createElement(SettingsPanel, {
			token: "settings-test-token",
			onClose: () => {},
			initialSettings: settings,
			initialPrompt,
		}),
	);

	expect(markup).toContain('value="sonnet"');
	expect(markup).toMatch(
		/<select[^>]*id="settings-model-quickpick"[^>]*>\s*<option value="">Custom…<\/option>\s*<option value="sonnet" selected="">sonnet<\/option>/,
	);
	for (const model of MODEL_QUICK_PICKS) {
		expect(markup).toContain(`<option value="${model}"`);
		expect(markup).toContain(`>${model}</option>`);
	}
});

test("shows configured Codex model without Claude quick picks", () => {
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: {
			...initialSettings.review,
			agent: "codex",
			model: "configured-codex-model",
		},
	};
	const markup = renderToStaticMarkup(
		createElement(SettingsPanel, {
			token: "settings-test-token",
			onClose: () => {},
			initialSettings: settings,
			initialPrompt,
		}),
	);

	expect(markup).toContain('<option value="codex" selected="">codex</option>');
	expect(markup).toContain('value="configured-codex-model"');
	expect(markup).toContain('placeholder="Codex CLI default"');
	expect(markup).toMatch(
		/<select[^>]*id="settings-model-quickpick"[^>]*>\s*<option value="">Codex CLI default<\/option>\s*<option value="configured-codex-model" selected="">Custom…<\/option>/,
	);
	for (const model of MODEL_QUICK_PICKS) {
		expect(markup).not.toContain(`<option value="${model}">`);
	}
});

test("shows discovered Codex labels and saves the selected slug", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: {
			...initialSettings.review,
			agent: "codex",
			model: "configured-codex-model",
		},
	};
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (url.includes("/api/settings/codex-models")) {
			return jsonResponse({
				models: [
					{ id: "gpt-6-astra", label: "GPT-6-Astra" },
					{ id: "gpt-6-sol", label: "GPT-6-Sol" },
					{ id: "gpt-6-luna", label: "GPT-6-Luna" },
				],
			});
		}
		if (init?.method === "POST")
			return jsonResponse({ agent: "codex", model: "gpt-6-astra" });
		return jsonResponse(settings);
	}) as unknown as typeof fetch;

	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialSettings: settings,
					initialPrompt,
				}),
			),
		);
		await act(async () => {
			await Bun.sleep(0);
			await Bun.sleep(0);
		});
		const quickpick = container.querySelector<HTMLSelectElement>(
			"#settings-model-quickpick",
		);
		const model = container.querySelector<HTMLInputElement>("#settings-model");
		const saveButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Save review agent"),
		);
		if (!quickpick || !model || !saveButton) {
			throw new Error("Missing review model controls");
		}
		expect(
			Array.from(quickpick.options, (option) => option.textContent),
		).toEqual([
			"Codex CLI default",
			"GPT-6-Astra",
			"GPT-6-Sol",
			"GPT-6-Luna",
			"Custom…",
		]);
		expect(quickpick.value).toBe("configured-codex-model");
		expect(model.value).toBe("configured-codex-model");

		await act(async () => {
			setControlValue(model, "typed-codex-custom", "input");
			await Bun.sleep(0);
		});
		expect(quickpick.value).toBe("typed-codex-custom");
		expect(model.value).toBe("typed-codex-custom");

		await act(async () => {
			setControlValue(quickpick, "gpt-6-astra", "change");
			await Bun.sleep(0);
		});
		expect(quickpick.value).toBe("gpt-6-astra");
		expect(model.value).toBe("gpt-6-astra");
		await act(async () => {
			saveButton.click();
			await Bun.sleep(0);
			await Bun.sleep(0);
		});
		const saveRequest = calls.find(
			(call) =>
				call.init?.method === "POST" &&
				call.url.includes("/api/settings/review"),
		);
		expect(JSON.parse(String(saveRequest?.init?.body))).toEqual({
			agent: "codex",
			model: "gpt-6-astra",
		});
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("keeps unsaved models isolated when switching review agents", async () => {
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: { ...initialSettings.review, agent: "claude", model: "sonnet" },
	};
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);

	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialSettings: settings,
					initialPrompt,
				}),
			),
		);
		const agent = container.querySelector<HTMLSelectElement>("#settings-agent");
		const model = container.querySelector<HTMLInputElement>("#settings-model");
		const quickpick = container.querySelector<HTMLSelectElement>(
			"#settings-model-quickpick",
		);
		if (!agent || !model || !quickpick) {
			throw new Error("Missing review model controls");
		}
		const changeValue = async (
			element: HTMLInputElement | HTMLSelectElement,
			value: string,
			eventName: "change" | "input",
		) => {
			await act(async () => {
				setControlValue(element, value, eventName);
				await Bun.sleep(0);
			});
		};

		expect(model.value).toBe("sonnet");
		expect(quickpick.value).toBe("sonnet");
		await changeValue(agent, "codex", "change");
		expect(model.value).toBe("");
		expect(model.placeholder).toBe("Codex CLI default");
		expect(quickpick.value).toBe("");
		expect(
			Array.from(quickpick.options, (option) => option.textContent),
		).toEqual(["Codex CLI default"]);

		await changeValue(model, "configured-codex-model", "input");
		expect(quickpick.value).toBe("configured-codex-model");
		await changeValue(agent, "claude", "change");
		expect(model.value).toBe("sonnet");
		expect(model.placeholder).toBe("");
		expect(quickpick.value).toBe("sonnet");

		await changeValue(agent, "codex", "change");
		expect(model.value).toBe("configured-codex-model");
		expect(quickpick.value).toBe("configured-codex-model");
		await changeValue(quickpick, "", "change");
		expect(model.value).toBe("");
		expect(model.placeholder).toBe("Codex CLI default");
		expect(
			Array.from(quickpick.options, (option) => option.textContent),
		).toEqual(["Codex CLI default"]);
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});

test("saving Codex CLI default omits model from review settings request", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: {
			...initialSettings.review,
			agent: "codex",
			model: "configured-codex-model",
		},
	};
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		if (init?.method === "POST") return jsonResponse({ agent: "codex" });
		return jsonResponse(settings);
	}) as unknown as typeof fetch;

	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);

	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialSettings: settings,
					initialPrompt,
				}),
			),
		);
		const quickpick = container.querySelector<HTMLSelectElement>(
			"#settings-model-quickpick",
		);
		const model = container.querySelector<HTMLInputElement>("#settings-model");
		const saveButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Save review agent"),
		);
		if (!quickpick || !model || !saveButton) {
			throw new Error("Missing review model save controls");
		}

		await act(async () => {
			setControlValue(quickpick, "", "change");
			await Bun.sleep(0);
		});
		expect(model.value).toBe("");
		await act(async () => {
			saveButton.click();
			await Bun.sleep(0);
			await Bun.sleep(0);
		});

		const saveRequest = calls.find(
			(call) =>
				call.init?.method === "POST" &&
				call.url.includes("/api/settings/review"),
		);
		expect(JSON.parse(String(saveRequest?.init?.body))).toEqual({
			agent: "codex",
		});
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("falls back to Claude when the settings snapshot omits the review agent", () => {
	// The API can omit the agent field; drop it to verify the panel's own
	// fallback without changing the typed snapshot contract.
	const settings = {
		...initialSettings,
		review: {
			model: initialSettings.review.model,
			agents: initialSettings.review.agents,
		},
	} as SettingsSnapshot;
	const markup = renderToStaticMarkup(
		createElement(SettingsPanel, {
			token: "settings-test-token",
			onClose: () => {},
			initialSettings: settings,
			initialPrompt,
		}),
	);
	expect(markup).toContain(
		'<option value="claude" selected="">claude</option>',
	);
	expect(markup).toContain('<option value="omp">omp</option>');
});

test("only renders rollback for a non-latest version", () => {
	expect(render()).not.toContain("Roll back to this version");
	expect(render({ ...initialPrompt, version: 2 })).toContain(
		"Roll back to this version",
	);
});

test("keeps settings controls reachable in responsive bounded layout", () => {
	const markup = render();

	expect(markup).toContain("flex h-full min-h-0 flex-col");
	expect(markup).toContain("grid-cols-1");
	expect(markup).toContain("md:grid-cols-[14rem_minmax(0,1fr)]");
	expect(markup).toMatch(
		/class="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-auto p-6 md:grid-cols-\[14rem_minmax\(0,1fr\)\] md:gap-6"/,
	);
	expect(markup).toContain("overflow-auto");
	expect(markup).toContain('<nav class="space-y-1" aria-label="Prompt slots">');
	expect(markup).toMatch(
		/<nav class="space-y-1" aria-label="Prompt slots">[\s\S]*<\/nav><section class="min-w-0 space-y-4 md:border-l md:pl-6"/,
	);

	expect(markup).toContain('<input id="settings-prompt-model"');
	for (const id of [
		"settings-preset",
		"settings-version",
		"settings-prompt-agent",
		"settings-agent",
		"settings-model-quickpick",
	]) {
		expect(markup).toContain(`<select id="${id}"`);
	}
	expect(markup).toContain('<option value="default">default (active)</option>');
	expect(markup).toContain('<option value="omp" selected="">omp</option>');
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

test("settings dialog closes through icon, Escape, and backdrop with focus return", async () => {
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);

	function Harness() {
		const [open, setOpen] = useState(false);
		return createElement(
			"div",
			null,
			createElement(
				"button",
				{ type: "button", onClick: () => setOpen(true) },
				"Open settings",
			),
			createElement(
				Dialog,
				{
					open,
					onOpenChange: (nextOpen) => setOpen(nextOpen),
				},
				createElement(
					DialogContent,
					{
						className:
							"h-[min(calc(100dvh-2rem),56rem)] w-[min(calc(100vw-2rem),64rem)] max-w-none grid-rows-[minmax(0,1fr)] overflow-hidden p-0 sm:max-w-none",
					},
					createElement(SettingsPanel, {
						token: "settings-test-token",
						onClose: () => setOpen(false),
						initialSettings,
						initialPrompt,
					}),
				),
			),
		);
	}

	try {
		act(() => root.render(createElement(Harness)));
		const trigger = container.querySelector<HTMLButtonElement>("button");
		expect(trigger).not.toBeNull();

		await act(async () => {
			trigger?.focus();
			trigger?.click();
			await Bun.sleep(0);
		});
		expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

		const close = document.body.querySelector<HTMLButtonElement>(
			'[data-slot="dialog-close"]',
		);
		expect(close).not.toBeNull();
		expect(close?.querySelector(".sr-only")?.textContent).toBe("Close");
		expect(
			Array.from(close?.childNodes ?? [])
				.filter((node) => node.nodeType === Node.TEXT_NODE)
				.map((node) => node.textContent)
				.join(""),
		).toBe("");
		expect(
			document.body.querySelector('button[aria-label="Close settings"]'),
		).toBeNull();
		await act(async () => {
			close?.click();
			await Bun.sleep(0);
		});
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(trigger);

		await act(async () => {
			trigger?.click();
			await Bun.sleep(0);
		});
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
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(trigger);

		await act(async () => {
			trigger?.click();
			await Bun.sleep(0);
		});
		const backdrop = document.body.querySelector<HTMLElement>(
			'[data-slot="dialog-overlay"]',
		);
		expect(backdrop).not.toBeNull();
		await act(async () => {
			backdrop?.click();
			await Bun.sleep(0);
		});
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(trigger);
	} finally {
		act(() => root.unmount());
		container.remove();
	}
});
test("renders Prompts, Skills and Appearance tabs with Prompts selected", () => {
	const markup = render();

	const tabs = Array.from(
		markup.matchAll(/<button[^>]*role="tab"[^>]*>([^<]+)<\/button>/g),
	);
	expect(tabs.map((tab) => tab[1])).toEqual([
		"Prompts",
		"Skills",
		"Appearance",
	]);
	expect(tabs[0]?.[0]).toContain('aria-selected="true"');
	expect(
		tabs.slice(1).every((tab) => tab[0]?.includes('aria-selected="false"')),
	).toBe(true);
});

test("applies and saves a selected color theme", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (url.includes("/api/skills")) return jsonResponse({ skills: [] });
		if (init?.method === "POST" && url.includes("/api/settings/appearance")) {
			return jsonResponse({ colorTheme: "light" });
		}
		return jsonResponse(initialSettings);
	}) as unknown as typeof fetch;
	applyColorTheme("default");

	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialPrompt,
				}),
			),
		);
		await act(async () => {
			await Bun.sleep(0);
			await Bun.sleep(0);
		});

		const appearanceTab = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
		).find((tab) => tab.textContent === "Appearance");
		expect(appearanceTab).toBeDefined();
		await act(async () => {
			appearanceTab?.click();
			await Bun.sleep(0);
		});

		const label = container.querySelector<HTMLLabelElement>(
			'label[for="settings-color-theme"]',
		);
		const select = container.querySelector<HTMLSelectElement>(
			"#settings-color-theme",
		);
		expect(label?.textContent).toBe("Color theme");
		expect(
			Array.from(select?.options ?? []).map((option) => [
				option.value,
				option.text,
			]),
		).toEqual([
			["default", "Default"],
			["light", "Light"],
		]);
		expect(select?.value).toBe("default");

		await act(async () => {
			if (select) {
				select.value = "light";
				select.dispatchEvent(new window.Event("change", { bubbles: true }));
			}
			await Bun.sleep(0);
			await Bun.sleep(0);
		});

		expect(document.documentElement.classList.contains("dark")).toBe(false);
		const appearancePost = calls.find(
			(call) =>
				call.init?.method === "POST" &&
				call.url.includes("/api/settings/appearance"),
		);
		expect(appearancePost?.url).toContain("/api/settings/appearance");
		expect(JSON.parse(String(appearancePost?.init?.body))).toEqual({
			colorTheme: "light",
		});
		expect(
			container.querySelector<HTMLSelectElement>("#settings-color-theme")
				?.value,
		).toBe("light");
	} finally {
		act(() => root.unmount());
		container.remove();
		document.documentElement.className = "";
		globalThis.fetch = originalFetch;
	}
});

test("restores the color theme after a failed save and permits re-entry", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	let appearancePostCount = 0;
	let releaseFirstPost: ((response: Response) => void) | undefined;
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (url.includes("/api/skills")) return jsonResponse({ skills: [] });
		if (init?.method === "POST" && url.includes("/api/settings/appearance")) {
			appearancePostCount += 1;
			if (appearancePostCount === 1) {
				return await new Promise<Response>((resolve) => {
					releaseFirstPost = resolve;
				});
			}
			return jsonResponse({ colorTheme: "light" });
		}
		return jsonResponse(initialSettings);
	}) as unknown as typeof fetch;
	applyColorTheme("default");

	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	const mountPanel = async () => {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialPrompt,
				}),
			),
		);
		await act(async () => {
			await Bun.sleep(0);
			await Bun.sleep(0);
		});
	};
	const unmountPanel = () => act(() => root.render(null));
	const switchTab = async (label: string) => {
		const tab = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
		).find((candidate) => candidate.textContent === label);
		await act(async () => {
			tab?.click();
			await Bun.sleep(0);
		});
	};
	const changeTheme = async () => {
		const select = container.querySelector<HTMLSelectElement>(
			"#settings-color-theme",
		);
		expect(select).not.toBeNull();
		await act(async () => {
			if (select) {
				select.value = "light";
				select.dispatchEvent(new window.Event("change", { bubbles: true }));
			}
			await Bun.sleep(0);
			await Bun.sleep(0);
		});
	};

	try {
		await mountPanel();
		await switchTab("Appearance");
		await changeTheme();
		expect(
			container.querySelector<HTMLSelectElement>("#settings-color-theme")
				?.disabled,
		).toBe(true);
		expect(releaseFirstPost).toBeDefined();

		await switchTab("Prompts");
		await switchTab("Appearance");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-color-theme")
				?.disabled,
		).toBe(true);

		unmountPanel();
		await mountPanel();
		await switchTab("Appearance");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-color-theme")
				?.disabled,
		).toBe(true);

		unmountPanel();
		await act(async () => {
			releaseFirstPost?.(jsonResponse({ error: "persist failed" }, 500));
			await Bun.sleep(0);
			await Bun.sleep(0);
		});
		await mountPanel();
		await switchTab("Appearance");

		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(
			container.querySelector<HTMLSelectElement>("#settings-color-theme")
				?.value,
		).toBe("default");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-color-theme")
				?.disabled,
		).toBe(false);
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Color theme not saved: persist failed",
		);
		await switchTab("Prompts");
		await switchTab("Appearance");
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Color theme not saved: persist failed",
		);

		await changeTheme();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(
			container.querySelector<HTMLSelectElement>("#settings-color-theme")
				?.value,
		).toBe("light");
		expect(
			calls.filter(
				(call) =>
					call.init?.method === "POST" &&
					call.url.includes("/api/settings/appearance"),
			),
		).toHaveLength(2);
	} finally {
		await act(async () => {
			releaseFirstPost?.(jsonResponse({ error: "persist failed" }, 500));
			await Bun.sleep(0);
			await Bun.sleep(0);
		});
		unmountPanel();
		container.remove();
		document.documentElement.className = "";
		globalThis.fetch = originalFetch;
	}
});
