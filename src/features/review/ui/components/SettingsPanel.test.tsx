import { expect, test } from "bun:test";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { PROMPT_NAMES } from "../../../../adapters/prompts/defaults";
import { applyColorTheme } from "../color-theme";
import {
	isSaveDisabled,
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

function changeSelect(
	container: ParentNode,
	selector: string,
	value: string,
): void {
	const select = container.querySelector<HTMLSelectElement>(selector);
	if (!select) throw new Error(`Missing select ${selector}`);
	select.value = value;
	select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

async function flushReact(): Promise<void> {
	await Bun.sleep(0);
	await Bun.sleep(0);
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
test("isSaveDisabled covers unchanged and changed text, agent, model, and effort", () => {
	const loaded: PromptEditorValue = {
		text: "same",
		agent: "default",
		model: "sonnet",
		effort: "",
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
	expect(isSaveDisabled(loaded, { ...loaded, effort: "high" }, false)).toBe(
		false,
	);
	expect(isSaveDisabled(loaded, { ...loaded, text: "changed" }, false)).toBe(
		false,
	);
	expect(isSaveDisabled(loaded, { ...loaded, text: "changed" }, true)).toBe(
		true,
	);
});
test("renders version agent, model, and effort dropdowns with inherited defaults", () => {
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
	expect(markup).toContain('<select id="settings-prompt-model"');
	expect(markup).toContain('<select id="settings-prompt-effort"');
	expect(markup).toContain('value="sonnet"');
	expect(markup).toContain(
		'<fieldset class="min-w-0 flex flex-wrap items-end gap-3">',
	);
	expect(markup).not.toContain('<input id="settings-prompt-model"');
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
		if (url.includes("/api/settings/models?")) {
			return jsonResponse({
				models: [{ id: "sonnet", label: "Sonnet", efforts: ["low", "high"] }],
				source: "omp",
			});
		}
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
			await flushReact();
		});
		await act(async () => {
			setValue(
				container.querySelector("#settings-prompt-agent"),
				"omp",
				"change",
			);
			setValue(
				container.querySelector("#settings-prompt-model"),
				"sonnet",
				"change",
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
			effort: null,
		});

		await act(async () => {
			await Bun.sleep(0);
			await Bun.sleep(0);
			setValue(
				container.querySelector("#settings-prompt-agent"),
				"default",
				"change",
			);
			setValue(container.querySelector("#settings-prompt-model"), "", "change");
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
			effort: null,
		});
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("default review controls live only in General", () => {
	const prompts = render();
	expect(prompts).toContain('id="settings-prompt-model"');
	expect(prompts).not.toContain("Default Agent");
	expect(prompts).not.toContain("Default model");
	expect(prompts).not.toContain("Default effort");
	expect(prompts).not.toContain('id="settings-default-agent"');
	expect(prompts).not.toContain('id="settings-default-model"');
	expect(prompts).not.toContain('id="settings-default-effort"');

	const general = renderToStaticMarkup(
		createElement(SettingsPanel, {
			token: "settings-test-token",
			onClose: () => {},
			initialSettings,
			initialPrompt,
			initialTab: "general",
		}),
	);
	expect(general).toContain('id="settings-default-agent"');
	expect(general).toContain('id="settings-default-model"');
	expect(general).toContain('id="settings-default-effort"');
	expect(general).toMatch(
		/<fieldset class="min-w-0 flex flex-wrap items-end gap-3"><legend class="sr-only">Review defaults<\/legend>[\s\S]*?id="settings-default-agent"[\s\S]*?id="settings-default-model"[\s\S]*?id="settings-default-effort"[\s\S]*?<\/fieldset>/,
	);
	expect(general).toContain("Default Agent");
	expect(general).toContain("Default model");
	expect(general).toContain("Default effort");
	expect(general).toContain(">Save</button>");
	expect(general).toContain("claude-sonnet-4 (current custom model)");
});
// Happy DOM exercises narrow-screen navigation but does not prove pixel geometry.
test("375px settings controls stay keyboard and scroll reachable", async () => {
	const scriptPath = new URL("./SettingsPanel.375px.smoke.tsx", import.meta.url)
		.pathname;
	const child = Bun.spawn(
		["bun", "run", "--preload=./test/setup-dom.ts", scriptPath],
		{
			cwd: process.cwd(),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0)
		throw new Error(`Happy DOM viewport smoke failed:\n${stdout}\n${stderr}`);
	expect(stdout).toContain("Happy DOM 375px settings smoke passed");
});

test("General loads selected-agent catalog, shows errors, and saves persisted defaults", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	let persistedSettings = initialSettings;
	let failNextSave = true;
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (url.includes("/api/settings/models?")) {
			const agent = new URL(url, "http://settings.test").searchParams.get(
				"agent",
			);
			return jsonResponse(
				agent === "claude"
					? {
							models: [
								{
									id: "claude-model-a",
									label: "Claude Model A",
									efforts: ["low", "high"],
								},
							],
							source: "anthropic-api",
							warning: "API-key entitlement controls model availability.",
						}
					: {
							models: [
								{
									id: "omp-model-a",
									label: "OMP Model A",
									efforts: ["minimal", "high"],
								},
							],
							source: "omp",
						},
			);
		}
		if (url.includes("/api/settings/review") && init?.method === "POST") {
			if (failNextSave) {
				failNextSave = false;
				return jsonResponse({ error: "Settings write failed" }, 500);
			}
			const body = JSON.parse(String(init.body)) as {
				agent: "omp" | "claude";
				model: string | null;
				effort: string | null;
			};
			persistedSettings = {
				...persistedSettings,
				review: {
					...persistedSettings.review,
					agent: body.agent,
					model: body.model ?? undefined,
					effort: (body.effort ??
						undefined) as SettingsSnapshot["review"]["effort"],
				},
			};
			return jsonResponse({ saved: true });
		}
		if (url.includes("/api/settings")) return jsonResponse(persistedSettings);
		if (url.includes("/api/skills")) return jsonResponse({ skills: [] });
		return jsonResponse({});
	}) as unknown as typeof fetch;

	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	const clickTab = async (label: string) => {
		const tab = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
		).find((candidate) => candidate.textContent === label);
		await act(async () => {
			tab?.click();
			await flushReact();
		});
	};
	const save = async () => {
		const button = Array.from(container.querySelectorAll("button")).find(
			(candidate) => candidate.textContent === "Save",
		);
		await act(async () => {
			button?.click();
			await flushReact();
		});
	};

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
		await clickTab("General");

		const ompRequest = calls.find((call) =>
			call.url.includes("/api/settings/models?agent=omp"),
		);
		expect(ompRequest).toBeDefined();
		expect(new Headers(ompRequest?.init?.headers).get("X-Mole-Token")).toBe(
			"settings-test-token",
		);
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-model")
				?.value,
		).toBe("claude-sonnet-4");

		await act(async () => {
			changeSelect(container, "#settings-default-agent", "claude");
			await flushReact();
		});
		const modelSelect = container.querySelector<HTMLSelectElement>(
			"#settings-default-model",
		);
		expect(
			Array.from(modelSelect?.options ?? []).map((option) => option.value),
		).toContain("claude-model-a");
		expect(container.textContent).toContain("Anthropic API");
		expect(container.textContent).toContain(
			"API-key entitlement controls model availability.",
		);
		await act(async () => {
			changeSelect(container, "#settings-default-model", "claude-model-a");
			await flushReact();
		});
		const effortSelect = container.querySelector<HTMLSelectElement>(
			"#settings-default-effort",
		);
		expect(
			Array.from(effortSelect?.options ?? []).map((option) => option.value),
		).toEqual(["", "low", "high"]);
		await act(async () => {
			changeSelect(container, "#settings-default-effort", "high");
			await flushReact();
		});

		await save();
		expect(container.textContent).toContain("Settings write failed");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-model")
				?.value,
		).toBe("claude-model-a");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-effort")
				?.value,
		).toBe("high");

		await save();
		expect(
			calls
				.filter(
					(call) =>
						call.url.includes("/api/settings/review") &&
						call.init?.method === "POST",
				)
				.map((call) => JSON.parse(String(call.init?.body))),
		).toEqual([
			{
				agent: "claude",
				model: "claude-model-a",
				effort: "high",
			},
			{
				agent: "claude",
				model: "claude-model-a",
				effort: "high",
			},
		]);
		expect(
			calls.some(
				(call) =>
					call.url.includes("/api/settings?") && call.init?.method !== "POST",
			),
		).toBe(true);
		expect(persistedSettings.review).toMatchObject({
			agent: "claude",
			model: "claude-model-a",
			effort: "high",
		});
		expect(container.textContent).toContain("Saved review defaults");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-agent")
				?.value,
		).toBe("claude");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-model")
				?.value,
		).toBe("claude-model-a");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-effort")
				?.value,
		).toBe("high");
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("General ignores stale catalog responses after agent switch", async () => {
	const originalFetch = globalThis.fetch;
	let resolveOmp: ((response: Response) => void) | undefined;
	let resolveClaude: ((response: Response) => void) | undefined;
	const ompResponse = new Promise<Response>((resolve) => {
		resolveOmp = resolve;
	});
	const claudeResponse = new Promise<Response>((resolve) => {
		resolveClaude = resolve;
	});
	globalThis.fetch = (async (input: string) => {
		const url = String(input);
		if (url.includes("/api/settings/models?agent=omp")) return ompResponse;
		if (url.includes("/api/settings/models?agent=claude"))
			return claudeResponse;
		if (url.includes("/api/settings")) return jsonResponse(initialSettings);
		return jsonResponse({});
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
					initialSettings,
					initialPrompt,
					initialTab: "general",
				}),
			),
		);
		await act(async () => {
			await flushReact();
		});
		expect(resolveOmp).toBeDefined();
		await act(async () => {
			changeSelect(container, "#settings-default-agent", "claude");
			await flushReact();
		});
		expect(resolveClaude).toBeDefined();

		await act(async () => {
			resolveClaude?.(
				jsonResponse({
					models: [{ id: "claude-current", label: "Claude", efforts: ["low"] }],
					source: "anthropic-api",
				}),
			);
			await flushReact();
		});
		await act(async () => {
			resolveOmp?.(
				jsonResponse({
					models: [
						{ id: "omp-stale", label: "Stale OMP", efforts: ["minimal"] },
					],
					source: "omp",
				}),
			);
			await flushReact();
		});

		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-agent")
				?.value,
		).toBe("claude");
		const models = Array.from(
			container.querySelector<HTMLSelectElement>("#settings-default-model")
				?.options ?? [],
		).map((option) => option.value);
		expect(models).toContain("claude-current");
		expect(models).not.toContain("omp-stale");
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("General preserves custom model and effort through catalog failure and retry", async () => {
	const originalFetch = globalThis.fetch;
	let catalogRequests = 0;
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: {
			...initialSettings.review,
			model: "custom-model",
			effort: "high",
		},
	};
	globalThis.fetch = (async (input: string) => {
		const url = String(input);
		if (url.includes("/api/settings/models?")) {
			catalogRequests += 1;
			return catalogRequests === 1
				? jsonResponse({ error: "Catalog offline" }, 503)
				: jsonResponse({
						models: [
							{
								id: "omp-new-model",
								label: "New OMP Model",
								efforts: ["minimal"],
							},
						],
						source: "omp",
					});
		}
		if (url.includes("/api/settings")) return jsonResponse(settings);
		return jsonResponse({});
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
					initialTab: "general",
				}),
			),
		);
		await act(async () => {
			await flushReact();
		});

		expect(container.textContent).toContain("Catalog offline");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-model")
				?.value,
		).toBe("custom-model");
		expect(
			Array.from(
				container.querySelector<HTMLSelectElement>("#settings-default-model")
					?.options ?? [],
			).map((option) => option.value),
		).toContain("custom-model");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-effort")
				?.value,
		).toBe("high");

		const retryButton = Array.from(
			container.querySelectorAll<HTMLButtonElement>("button"),
		).find((button) => button.textContent === "Retry");
		await act(async () => {
			retryButton?.click();
			await flushReact();
		});
		expect(container.textContent).not.toContain("Catalog offline");
		expect(container.textContent).toContain("configured OMP executable");
		expect(catalogRequests).toBe(2);
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-model")
				?.value,
		).toBe("custom-model");
		expect(
			Array.from(
				container.querySelector<HTMLSelectElement>("#settings-default-model")
					?.options ?? [],
			).map((option) => option.value),
		).toContain("custom-model");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-effort")
				?.value,
		).toBe("high");

		await act(async () => {
			changeSelect(container, "#settings-default-model", "omp-new-model");
			await flushReact();
		});
		expect(
			container.querySelector<HTMLSelectElement>("#settings-default-effort")
				?.value,
		).toBe("");
		expect(
			Array.from(
				container.querySelector<HTMLSelectElement>("#settings-default-effort")
					?.options ?? [],
			).map((option) => option.value),
		).toEqual(["", "minimal"]);
		expect(
			Array.from(
				container.querySelector<HTMLSelectElement>("#settings-default-model")
					?.options ?? [],
			).map((option) => option.value),
		).not.toContain("custom-model");
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("styles prompt heading with editor spacing", () => {
	const markup = render();

	expect(markup).toContain(
		'<label class="text-sm font-medium" for="settings-prompt">Prompt text</label>',
	);
	expect(markup).toMatch(
		/<div class="space-y-2"><label class="text-sm font-medium" for="settings-prompt">Prompt text<\/label><textarea/,
	);
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
			initialTab: "general",
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

test("keeps prompt settings controls reachable in responsive bounded layout", () => {
	const markup = render();

	expect(markup).toContain("flex h-full min-h-0 min-w-0 flex-col");
	expect(markup).toContain("grid-cols-1");
	expect(markup).toContain("md:grid-cols-[14rem_minmax(0,1fr)]");
	expect(markup).toContain("overflow-auto");
	expect(markup).toContain('<nav class="space-y-1" aria-label="Prompt slots">');
	expect(markup).not.toContain('<input id="settings-prompt-model"');
	expect(markup).toMatch(
		/<fieldset class="min-w-0 flex flex-wrap items-end gap-3"><legend class="sr-only">Prompt agent, model, and effort<\/legend>[\s\S]*?id="settings-prompt-agent"[\s\S]*?id="settings-prompt-model"[\s\S]*?id="settings-prompt-effort"[\s\S]*?<\/fieldset>/,
	);
	for (const id of [
		"settings-preset",
		"settings-version",
		"settings-prompt-agent",
		"settings-prompt-model",
		"settings-prompt-effort",
	]) {
		expect(markup).toContain(`<select id="${id}"`);
	}
	expect(markup).not.toContain('id="settings-default-agent"');

	const general = renderToStaticMarkup(
		createElement(SettingsPanel, {
			token: "settings-test-token",
			onClose: () => {},
			initialSettings,
			initialPrompt,
			initialTab: "general",
		}),
	);
	expect(general).toContain('class="min-w-0 flex flex-wrap items-end gap-3"');
	for (const id of [
		"settings-default-agent",
		"settings-default-model",
		"settings-default-effort",
	]) {
		expect(general).toContain(`<select id="${id}"`);
	}
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
test("renders General, Prompts, Skills and Appearance tabs with Prompts selected", () => {
	const markup = render();

	const tabs = Array.from(
		markup.matchAll(/<button[^>]*role="tab"[^>]*>([^<]+)<\/button>/g),
	);
	expect(tabs.map((tab) => tab[1])).toEqual([
		"General",
		"Prompts",
		"Skills",
		"Appearance",
	]);
	expect(tabs[1]?.[0]).toContain('aria-selected="true"');
	expect(
		tabs
			.filter((_, index) => index !== 1)
			.every((tab) => tab[0]?.includes('aria-selected="false"')),
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
		if (url.includes("/api/settings/models?")) {
			return jsonResponse({ models: [], source: "omp" });
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
		if (url.includes("/api/settings/models?")) {
			return jsonResponse({ models: [], source: "omp" });
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
test("saves effort-only prompt override while leaving inherited agent and model unset", async () => {
	const originalFetch = globalThis.fetch;
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: {
			...initialSettings.review,
			agent: "omp",
			model: "sonnet",
			effort: "low",
		},
	};
	let savedPrompt: PromptSnapshot = {
		...initialPrompt,
		text: "Loaded prompt",
		preset: "default",
		version: 1,
		versions: [1],
		agent: null,
		model: null,
		effort: null,
	};
	const writes: unknown[] = [];
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		const url = String(input);
		if (url.includes("/api/settings/models?")) {
			return jsonResponse({
				models: [
					{ id: "sonnet", label: "Sonnet", efforts: ["low", "high"] },
					{ id: "opus", label: "Opus", efforts: ["low"] },
				],
				source: "omp",
			});
		}
		if (url.includes("/api/prompts/") && init?.method === "POST") {
			const body = JSON.parse(String(init.body)) as {
				text: string;
				preset: string;
				agent: PromptSnapshot["agent"];
				model: string | null;
				effort: PromptSnapshot["effort"];
			};
			writes.push(body);
			savedPrompt = { ...body, version: 2, versions: [1, 2] };
			return jsonResponse({ version: 2, saved: true });
		}
		if (url.includes("/api/settings")) return jsonResponse(settings);
		if (url.includes("/api/skills")) return jsonResponse({ skills: [] });
		if (url.includes("/api/prompts/")) return jsonResponse(savedPrompt);
		return jsonResponse({});
	}) as unknown as typeof fetch;

	const initial: PromptSnapshot = {
		text: "Loaded prompt",
		preset: "default",
		version: 1,
		versions: [1],
		agent: null,
		model: null,
		effort: null,
	};
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	const saveButton = () =>
		Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
			(button) => button.textContent?.includes("Save as new version"),
		);

	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialSettings: settings,
					initialPrompt: initial,
				}),
			),
		);
		await act(async () => {
			await flushReact();
		});

		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-agent")
				?.value,
		).toBe("default");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-model")
				?.value,
		).toBe("");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-effort")
				?.value,
		).toBe("");
		expect(container.textContent).toContain("Default (sonnet)");
		expect(container.textContent).toContain("Default (low)");
		expect(saveButton()?.disabled).toBe(true);

		await act(async () => {
			changeSelect(container, "#settings-prompt-effort", "high");
			await flushReact();
		});
		expect(saveButton()?.disabled).toBe(false);

		await act(async () => {
			saveButton()?.click();
			await flushReact();
		});

		expect(writes).toEqual([
			{
				preset: "default",
				text: "Loaded prompt",
				agent: null,
				model: null,
				effort: "high",
			},
		]);
		expect(savedPrompt.version).toBe(2);
		expect(
			container.querySelector<HTMLSelectElement>("#settings-version")?.value,
		).toBe("2");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-agent")
				?.value,
		).toBe("default");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-model")
				?.value,
		).toBe("");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-effort")
				?.value,
		).toBe("high");
		expect(saveButton()?.disabled).toBe(true);
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("explicit prompt agent uses CLI defaults and ignores stale catalog responses", async () => {
	const originalFetch = globalThis.fetch;
	let resolveOmp: ((response: Response) => void) | undefined;
	let resolveClaude: ((response: Response) => void) | undefined;
	const ompResponse = new Promise<Response>((resolve) => {
		resolveOmp = resolve;
	});
	const claudeResponse = new Promise<Response>((resolve) => {
		resolveClaude = resolve;
	});
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: {
			...initialSettings.review,
			agent: "omp",
			model: "inherited-sonnet",
			effort: "high",
		},
	};
	globalThis.fetch = (async (input: string) => {
		const url = String(input);
		if (url.includes("/api/settings/models?agent=omp")) return ompResponse;
		if (url.includes("/api/settings/models?agent=claude"))
			return claudeResponse;
		if (url.includes("/api/skills")) return jsonResponse({ skills: [] });
		return jsonResponse({});
	}) as unknown as typeof fetch;

	const initial: PromptSnapshot = {
		text: "Unchanged prompt",
		preset: "default",
		version: 1,
		versions: [1],
		agent: null,
		model: null,
		effort: null,
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
					initialPrompt: initial,
				}),
			),
		);
		await act(async () => {
			await flushReact();
		});
		expect(resolveOmp).toBeDefined();

		await act(async () => {
			changeSelect(container, "#settings-prompt-agent", "claude");
			await flushReact();
		});
		expect(resolveClaude).toBeDefined();

		await act(async () => {
			resolveClaude?.(
				jsonResponse({
					models: [
						{ id: "claude-only", label: "Claude model", efforts: ["low"] },
					],
					source: "claude-aliases",
				}),
			);
			await flushReact();
		});
		await act(async () => {
			resolveOmp?.(
				jsonResponse({
					models: [
						{ id: "omp-stale", label: "Stale OMP model", efforts: ["high"] },
					],
					source: "omp",
				}),
			);
			await flushReact();
		});

		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-agent")
				?.value,
		).toBe("claude");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-model")
				?.value,
		).toBe("");
		expect(
			Array.from(
				container.querySelector<HTMLSelectElement>("#settings-prompt-model")
					?.options ?? [],
			).map((option) => option.value),
		).toEqual(["", "claude-only"]);
		expect(
			Array.from(
				container.querySelector<HTMLSelectElement>("#settings-prompt-effort")
					?.options ?? [],
			).map((option) => option.value),
		).toEqual(["", "low"]);
		expect(container.textContent).toContain("Default (agent default)");
		expect(container.textContent).not.toContain("inherited-sonnet");
		expect(container.textContent).not.toContain("omp-stale");
		expect(
			container.querySelector<HTMLTextAreaElement>("#settings-prompt")?.value,
		).toBe("Unchanged prompt");
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("prompt effort choices follow selected model compatibility", async () => {
	const originalFetch = globalThis.fetch;
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: { ...initialSettings.review, agent: "omp", model: "sonnet" },
	};
	const initial: PromptSnapshot = {
		text: "Prompt",
		preset: "default",
		version: 1,
		versions: [1],
		agent: "omp",
		model: "sonnet",
		effort: "high",
	};
	globalThis.fetch = (async (input: string) => {
		const url = String(input);
		if (url.includes("/api/settings/models?")) {
			return jsonResponse({
				models: [
					{ id: "sonnet", label: "Sonnet", efforts: ["low", "high"] },
					{ id: "opus", label: "Opus", efforts: ["low"] },
				],
				source: "omp",
			});
		}
		if (url.includes("/api/skills")) return jsonResponse({ skills: [] });
		return jsonResponse({});
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
					initialPrompt: initial,
				}),
			),
		);
		await act(async () => {
			await flushReact();
		});
		expect(
			Array.from(
				container.querySelector<HTMLSelectElement>("#settings-prompt-effort")
					?.options ?? [],
			).map((option) => option.value),
		).toEqual(["", "low", "high"]);

		await act(async () => {
			changeSelect(container, "#settings-prompt-model", "opus");
			await flushReact();
		});
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-effort")
				?.value,
		).toBe("");
		expect(
			Array.from(
				container.querySelector<HTMLSelectElement>("#settings-prompt-effort")
					?.options ?? [],
			).map((option) => option.value),
		).toEqual(["", "low"]);
		expect(container.textContent).toContain(
			"The saved effort is not listed as compatible with this model",
		);
		expect(
			Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
				(button) => button.textContent?.includes("Save as new version"),
			)?.disabled,
		).toBe(true);
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});
test("omits incompatible inherited effort from prompt choices and saves", async () => {
	const originalFetch = globalThis.fetch;
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: {
			...initialSettings.review,
			agent: "omp",
			model: "global-model",
			effort: "high",
		},
	};
	let savedPrompt: PromptSnapshot = {
		text: "Prompt",
		preset: "default",
		version: 1,
		versions: [1],
		agent: null,
		model: "prompt-model",
		effort: null,
	};
	const writes: unknown[] = [];
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		const url = String(input);
		if (url.includes("/api/settings/models?")) {
			return jsonResponse({
				models: [
					{ id: "global-model", label: "Global", efforts: ["high"] },
					{ id: "prompt-model", label: "Prompt", efforts: ["low"] },
				],
				source: "omp",
			});
		}
		if (url.includes("/api/prompts/") && init?.method === "POST") {
			const body = JSON.parse(String(init.body)) as Omit<
				PromptSnapshot,
				"version" | "versions"
			>;
			writes.push(body);
			savedPrompt = {
				...body,
				version: 2,
				versions: [1, 2],
			};
			return jsonResponse({ version: 2, saved: true });
		}
		if (url.includes("/api/settings")) return jsonResponse(settings);
		if (url.includes("/api/skills")) return jsonResponse({ skills: [] });
		if (url.includes("/api/prompts/")) return jsonResponse(savedPrompt);
		return jsonResponse({});
	}) as unknown as typeof fetch;

	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	const saveButton = () =>
		Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
			(button) => button.textContent?.includes("Save as new version"),
		);

	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialSettings: settings,
					initialPrompt: savedPrompt,
				}),
			),
		);
		await act(async () => {
			await flushReact();
		});

		const effortSelect = container.querySelector<HTMLSelectElement>(
			"#settings-prompt-effort",
		);
		expect(
			Array.from(effortSelect?.options ?? []).map((option) => option.value),
		).toEqual(["", "low"]);
		expect(effortSelect?.value).toBe("");
		expect(container.textContent).toContain("Default (agent default)");
		expect(container.textContent).toContain(
			"The selected model does not list the inherited effort as compatible",
		);
		expect(saveButton()?.disabled).toBe(true);

		const promptEditor =
			container.querySelector<HTMLTextAreaElement>("#settings-prompt");
		if (!promptEditor) throw new Error("Missing prompt editor");
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				window.HTMLTextAreaElement.prototype,
				"value",
			)?.set?.call(promptEditor, "Edited prompt");
			promptEditor.dispatchEvent(new window.Event("input", { bubbles: true }));
			await flushReact();
		});
		expect(saveButton()?.disabled).toBe(false);

		await act(async () => {
			saveButton()?.click();
			await flushReact();
		});

		expect(writes).toEqual([
			{
				preset: "default",
				text: "Edited prompt",
				agent: null,
				model: "prompt-model",
				effort: null,
			},
		]);
		expect(savedPrompt).toMatchObject({
			agent: null,
			model: "prompt-model",
			effort: null,
		});
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

test("slot, preset, and version changes restore each prompt metadata triple", async () => {
	const originalFetch = globalThis.fetch;
	const settings: SettingsSnapshot = {
		...initialSettings,
		slots: initialSettings.slots.map((slot) =>
			slot.slot === "review-layers-code"
				? {
						...slot,
						activePreset: "default",
						presets: [
							{ name: "default", latest: 2 },
							{ name: "alternate", latest: 1 },
						],
					}
				: slot,
		),
		review: {
			...initialSettings.review,
			agent: "omp",
			model: "sonnet",
			effort: "high",
		},
	};
	const snapshots: Record<string, PromptSnapshot> = {
		"review-layers-code|default|1": {
			text: "Code version one",
			preset: "default",
			version: 1,
			versions: [1, 2],
			agent: null,
			model: null,
			effort: null,
		},
		"review-layers-code|alternate|1": {
			text: "Alternate prompt",
			preset: "alternate",
			version: 1,
			versions: [1],
			agent: "claude",
			model: "claude-sonnet",
			effort: "medium",
		},
		"review-layers-plan|default|1": {
			text: "Plan prompt",
			preset: "default",
			version: 1,
			versions: [1],
			agent: null,
			model: null,
			effort: "low",
		},
	};
	globalThis.fetch = (async (input: string) => {
		const url = String(input);
		if (url.includes("/api/settings/models?")) {
			const agent = new URL(url, "http://settings.test").searchParams.get(
				"agent",
			);
			return jsonResponse({
				models:
					agent === "claude"
						? [
								{
									id: "claude-sonnet",
									label: "Claude Sonnet",
									efforts: ["medium"],
								},
							]
						: [{ id: "sonnet", label: "Sonnet", efforts: ["low", "high"] }],
				source: agent === "claude" ? "claude-aliases" : "omp",
			});
		}
		if (url.includes("/api/skills")) return jsonResponse({ skills: [] });
		if (url.includes("/api/prompts/")) {
			const parsed = new URL(url, "http://settings.test");
			const slot = parsed.pathname.split("/").at(-1);
			const preset = parsed.searchParams.get("preset") ?? "default";
			const version =
				Number(parsed.searchParams.get("rev")) ||
				(slot === "review-layers-code" && preset === "default" ? 2 : 1);
			const snapshot = snapshots[`${slot}|${preset}|${version}`];
			if (!snapshot) throw new Error(`Unexpected prompt request: ${url}`);
			return jsonResponse(snapshot);
		}
		return jsonResponse({});
	}) as unknown as typeof fetch;

	const initial: PromptSnapshot = {
		text: "Code version two",
		preset: "default",
		version: 2,
		versions: [1, 2],
		agent: "omp",
		model: "sonnet",
		effort: "high",
	};
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	const saveButton = () =>
		Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
			(button) => button.textContent?.includes("Save as new version"),
		);

	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialSettings: settings,
					initialPrompt: initial,
				}),
			),
		);
		await act(async () => {
			await flushReact();
		});

		await act(async () => {
			changeSelect(container, "#settings-prompt-effort", "low");
			await flushReact();
		});
		expect(saveButton()?.disabled).toBe(false);
		await act(async () => {
			changeSelect(container, "#settings-version", "1");
			await flushReact();
		});
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-agent")
				?.value,
		).toBe("default");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-model")
				?.value,
		).toBe("");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-effort")
				?.value,
		).toBe("");
		expect(saveButton()?.disabled).toBe(true);

		await act(async () => {
			changeSelect(container, "#settings-preset", "alternate");
			await flushReact();
			await flushReact();
		});
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-agent")
				?.value,
		).toBe("claude");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-model")
				?.value,
		).toBe("claude-sonnet");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-effort")
				?.value,
		).toBe("medium");
		expect(saveButton()?.disabled).toBe(true);

		const planSlot = Array.from(
			container.querySelectorAll<HTMLButtonElement>(
				'nav[aria-label="Prompt slots"] button',
			),
		).find((button) => button.textContent?.includes("Review layers (plan)"));
		await act(async () => {
			planSlot?.click();
			await flushReact();
			await flushReact();
		});
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-agent")
				?.value,
		).toBe("default");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-model")
				?.value,
		).toBe("");
		expect(
			container.querySelector<HTMLSelectElement>("#settings-prompt-effort")
				?.value,
		).toBe("low");
		expect(saveButton()?.disabled).toBe(true);
		expect(
			container.querySelector<HTMLTextAreaElement>("#settings-prompt")?.value,
		).toBe("Plan prompt");
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
	}
});

// JSDOM lacks layout; this checks focus and responsive scroll/wrap structure,
// not pixel geometry.
test("General and prompt controls stay keyboard and scroll reachable at 375px", async () => {
	const originalFetch = globalThis.fetch;
	const widthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: 375,
	});
	globalThis.fetch = (async (input: string) => {
		const url = String(input);
		if (url.includes("/api/settings/models?")) {
			return jsonResponse({
				models: [{ id: "omp-model", label: "OMP model", efforts: ["high"] }],
				source: "omp",
			});
		}
		return jsonResponse({});
	}) as unknown as typeof fetch;
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	const focusControls = (selectors: string[]) => {
		for (const selector of selectors) {
			const control = container.querySelector<HTMLSelectElement>(selector);
			if (!control) throw new Error(`Missing keyboard control ${selector}`);
			expect(control.tabIndex).toBe(0);
			expect(
				container.querySelector(`label[for="${control.id}"]`),
			).not.toBeNull();
			control.focus();
			expect(document.activeElement).toBe(control);
		}
	};

	try {
		act(() =>
			root.render(
				createElement(SettingsPanel, {
					token: "settings-test-token",
					onClose: () => {},
					initialSettings,
					initialPrompt,
					initialTab: "general",
				}),
			),
		);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(window.innerWidth).toBe(375);
		const generalRow = container
			.querySelector("#settings-default-agent")
			?.closest("fieldset");
		expect(generalRow?.className).toContain("flex-wrap");
		expect(generalRow?.className).toContain("min-w-0");
		const generalScrollPanel = container
			.querySelector("#settings-default-agent")
			?.closest<HTMLElement>('[data-slot="tabs-content"]');
		expect(generalScrollPanel?.className).toContain("overflow-auto");
		focusControls([
			"#settings-default-agent",
			"#settings-default-model",
			"#settings-default-effort",
		]);

		const generalTab = Array.from(
			container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
		).find((tab) => tab.textContent === "General");
		const promptsTab = Array.from(
			container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
		).find((tab) => tab.textContent === "Prompts");
		if (!generalTab || !promptsTab)
			throw new Error("Settings navigation tabs are missing");
		generalTab.focus();
		await act(async () => {
			generalTab.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "ArrowRight",
					cancelable: true,
					bubbles: true,
				}),
			);
			await Promise.resolve();
		});
		expect(document.activeElement).toBe(promptsTab);
		expect(promptsTab.getAttribute("aria-selected")).toBe("false");
		await act(async () => {
			promptsTab.click();
			await Promise.resolve();
		});
		expect(promptsTab.getAttribute("aria-selected")).toBe("true");

		const promptEffort = container.querySelector("#settings-prompt-effort");
		const promptRow = promptEffort?.closest("fieldset");
		expect(promptRow?.className).toContain("flex-wrap");
		expect(promptRow?.className).toContain("min-w-0");
		const promptScrollPanel =
			promptEffort?.closest<HTMLElement>(".overflow-auto");
		expect(promptScrollPanel?.className).toContain("grid-cols-1");
		focusControls([
			"#settings-prompt-agent",
			"#settings-prompt-model",
			"#settings-prompt-effort",
		]);
	} finally {
		act(() => root.unmount());
		container.remove();
		globalThis.fetch = originalFetch;
		if (widthDescriptor) {
			Object.defineProperty(window, "innerWidth", widthDescriptor);
		}
	}
});
