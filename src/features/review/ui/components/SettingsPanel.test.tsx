import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PROMPT_NAMES } from "../../../../adapters/prompts/defaults";
import {
	isSaveDisabled,
	MODEL_QUICK_PICKS,
	type PromptSnapshot,
	SettingsPanel,
	type SettingsSnapshot,
	SLOT_DESCRIPTIONS,
	SLOT_LABELS,
	VISIBLE_SLOTS,
} from "./SettingsPanel";

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

test("keeps visible slot labels in order and shows active preset and latest version", () => {
	expect(Object.keys(SLOT_LABELS)).toEqual([...PROMPT_NAMES]);
	expect(VISIBLE_SLOTS).toEqual([
		"review-layers-code",
		"review-layers-plan",
		"review-chat",
		"review-explain-comment",
	]);
	const markup = render();

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
		/<button[^>]*class="active"[^>]*aria-current="true"[^>]*>[\s\S]*?<span>Review layers \(code\)<\/span>/,
	);
	expect((markup.match(/aria-current="true"/g) ?? []).length).toBe(1);
	expect(markup).toContain("default (active)");
	expect(markup).toContain("v3");
});

test("renders a description for the selected slot", () => {
	const markup = render();

	expect(markup).toContain(SLOT_DESCRIPTIONS["review-layers-code"]);
	expect(markup).toMatch(/<p class="settings-slot-description">[\s\S]*?<\/p>/);
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
				text: "loaded prompt text",
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
	expect(markup).toContain('<option value="" selected="">Custom…</option>');
	for (const model of MODEL_QUICK_PICKS) {
		expect(markup).toContain(`<option value="${model}">${model}</option>`);
	}
	// The fixture's out-of-list model stays in the free-form input, and the
	// derived quickpick value renders as the empty "Custom…" placeholder.
	expect(markup).toMatch(
		/<select[^>]*id="settings-model-quickpick"[^>]*>\s*<option value="" selected="">Custom…<\/option>/,
	);
});

test("quickpick and text input both reflect a listed model value", () => {
	const settings: SettingsSnapshot = {
		...initialSettings,
		review: { ...initialSettings.review, model: "sonnet" },
	};
	const markup = renderToStaticMarkup(
		createElement(SettingsPanel, {
			token: "settings-test-token",
			onClose: () => {},
			initialSettings: settings,
			initialPrompt,
		}),
	);

	// Both controls read the same reviewModel state: the input keeps the
	// listed value and the quickpick selects it instead of "Custom…".
	expect(markup).toContain('value="sonnet"');
	expect(markup).toMatch(
		/<select[^>]*id="settings-model-quickpick"[^>]*>\s*<option value="">Custom…<\/option>\s*<option value="sonnet" selected="">sonnet<\/option>/,
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

test("isSaveDisabled covers unchanged, changed, and pending text", () => {
	expect(isSaveDisabled("same", "same", false)).toBe(true);
	expect(isSaveDisabled("loaded", "changed", false)).toBe(false);
	expect(isSaveDisabled("loaded", "changed", true)).toBe(true);
});
