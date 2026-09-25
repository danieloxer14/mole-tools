import { expect, test } from "bun:test";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SkillDetail, SkillSummary } from "../../../../shared/skills";
import { SkillsSettings } from "./SkillsSettings";
import { Dialog, DialogContent } from "./ui/dialog";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const token = "skills-settings-test-token";

function summary(
	name = "review-it",
	activeVersion = 2,
	versions = [1, 2],
): SkillSummary {
	return { name, activeVersion, versions, lastUsedAt: null };
}

function detail(
	name = "review-it",
	version = 2,
	activeVersion = 2,
	text = "loaded skill text",
	versions = [1, 2],
): SkillDetail {
	return { name, version, activeVersion, text, versions };
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function mount(node: ReactNode) {
	const container = document.createElement("div");
	const root = createRoot(container);
	document.body.append(container);
	act(() => root.render(node));
	return {
		container,
		cleanup: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

async function settle(): Promise<void> {
	await Bun.sleep(0);
	await Bun.sleep(0);
}

async function interact(action: () => void): Promise<void> {
	await act(async () => {
		action();
		await settle();
	});
}

function button(root: ParentNode, text: string): HTMLButtonElement {
	const found = Array.from(
		root.querySelectorAll<HTMLButtonElement>("button"),
	).find((candidate) => candidate.textContent?.trim() === text);
	if (!found) throw new Error(`Button not found: ${text}`);
	return found;
}

function setTextValue(
	element: HTMLInputElement | HTMLTextAreaElement,
	value: string,
): void {
	Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(element),
		"value",
	)?.set?.call(element, value);
	element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function setVersion(select: HTMLSelectElement, value: string): void {
	select.value = value;
	select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("lists skill names and active versions with sticky creation control", () => {
	const skills = [summary(), summary("write-note", 4, [1, 2, 3, 4])];
	const mounted = mount(
		createElement(SkillsSettings, {
			token,
			initialSkills: skills,
			initialSkill: detail(),
		}),
	);

	try {
		const nav = mounted.container.querySelector<HTMLElement>(
			'nav[aria-label="Skills"]',
		);
		expect(nav?.className).toContain("overflow-auto");
		const createButton = nav?.querySelector<HTMLButtonElement>("button");
		expect(createButton?.textContent).toContain("New skill");
		expect(createButton?.className).toContain("sticky");
		expect(createButton?.className).toContain("top-0");
		expect(nav?.firstElementChild).toBe(createButton);
		expect(nav?.textContent).toContain("review-it");
		expect(nav?.textContent).toContain("v2");
		expect(nav?.textContent).toContain("write-note");
		expect(nav?.textContent).toContain("v4");
	} finally {
		mounted.cleanup();
	}
});

test("shows D4 name errors while typing and disables Create for every invalid name", async () => {
	const mounted = mount(
		createElement(SkillsSettings, {
			token,
			initialSkills: [summary()],
			initialSkill: detail(),
		}),
	);

	try {
		await interact(() => button(mounted.container, "New skill").click());
		const input =
			document.body.querySelector<HTMLInputElement>("#new-skill-name");
		expect(input).not.toBeNull();
		const nameInput = input as HTMLInputElement;
		await interact(() => setTextValue(nameInput, "x"));

		for (const [name, expected] of [
			["", "Name is required"],
			["a!", "Use only letters, numbers, _ and -"],
			["abc", "Name must be more than 3 characters"],
			["x".repeat(65), "Name must be 64 characters or fewer"],
			["Review-IT", "A skill with this name already exists"],
		]) {
			await interact(() => setTextValue(nameInput, name));
			expect(
				document.body.querySelector("#new-skill-name-error")?.textContent,
			).toBe(expected);
			expect(button(document.body, "Create").disabled).toBe(true);
			expect(nameInput.getAttribute("aria-describedby")).toBe(
				"new-skill-name-error",
			);
		}
	} finally {
		mounted.cleanup();
	}
});

test("Cancel closes New skill without creating a skill", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return jsonResponse({ skills: [] });
	}) as unknown as typeof fetch;
	const mounted = mount(
		createElement(SkillsSettings, { token, initialSkills: [] }),
	);

	try {
		await interact(() => button(mounted.container, "New skill").click());
		const input =
			document.body.querySelector<HTMLInputElement>("#new-skill-name");
		expect(input).not.toBeNull();
		await interact(() => setTextValue(input as HTMLInputElement, "review-it"));
		await interact(() => button(document.body, "Cancel").click());
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(calls.some((call) => call.init?.method === "POST")).toBe(false);
	} finally {
		mounted.cleanup();
		globalThis.fetch = originalFetch;
	}
});

test("creates valid skill by POST and selects returned skill", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const createdSkill = summary("review-it", 1, [1]);
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return jsonResponse({ skill: createdSkill }, 201);
	}) as unknown as typeof fetch;
	const mounted = mount(
		createElement(SkillsSettings, { token, initialSkills: [] }),
	);

	try {
		await settle();
		await interact(() => button(mounted.container, "New skill").click());
		const input =
			document.body.querySelector<HTMLInputElement>("#new-skill-name");
		expect(input).not.toBeNull();
		await interact(() => setTextValue(input as HTMLInputElement, "review-it"));
		expect(button(document.body, "Create").disabled).toBe(false);
		await interact(() => button(document.body, "Create").click());

		const request = calls.find((call) => call.init?.method === "POST");
		expect(request?.url).toContain("/api/skills?");
		expect(JSON.parse(String(request?.init?.body))).toEqual({
			name: "review-it",
		});
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(mounted.container.querySelector("h3")?.textContent).toBe(
			"review-it",
		);
		expect(
			mounted.container.querySelector('nav button[aria-current="true"]')
				?.textContent,
		).toContain("v1");
	} finally {
		mounted.cleanup();
		globalThis.fetch = originalFetch;
	}
});

test("shows server conflict inline and leaves New skill open", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () =>
		jsonResponse(
			{ error: "A skill with this name already exists" },
			409,
		)) as unknown as typeof fetch;
	const mounted = mount(
		createElement(SkillsSettings, { token, initialSkills: [] }),
	);

	try {
		await settle();
		await interact(() => button(mounted.container, "New skill").click());
		const input =
			document.body.querySelector<HTMLInputElement>("#new-skill-name");
		expect(input).not.toBeNull();
		await interact(() => setTextValue(input as HTMLInputElement, "review-it"));
		await interact(() => button(document.body, "Create").click());
		expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
		expect(
			document.body.querySelector("#new-skill-name-error")?.textContent,
		).toBe("A skill with this name already exists");
	} finally {
		mounted.cleanup();
		globalThis.fetch = originalFetch;
	}
});

test("Escape in New skill dialog closes only nested dialog", async () => {
	function Harness() {
		const [open, setOpen] = useState(true);
		return createElement(
			Dialog,
			{ open, onOpenChange: setOpen },
			createElement(
				DialogContent,
				{ className: "max-w-none" },
				createElement(SkillsSettings, {
					token,
					initialSkills: [summary()],
					initialSkill: detail(),
				}),
			),
		);
	}

	const mounted = mount(createElement(Harness));
	try {
		await interact(() => button(document.body, "New skill").click());
		const dialogs = document.body.querySelectorAll('[role="dialog"]');
		expect(dialogs).toHaveLength(2);
		const input =
			document.body.querySelector<HTMLInputElement>("#new-skill-name");
		expect(input).not.toBeNull();
		await interact(() =>
			(input as HTMLInputElement).dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
		expect(document.body.querySelector("h3")?.textContent).toBe("review-it");
	} finally {
		mounted.cleanup();
	}
});

test("loads inactive version read-only and activates it with version number", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (init?.method === "POST") return jsonResponse({ activeVersion: 1 });
		if (url.includes("?version=1"))
			return jsonResponse(detail("review-it", 1, 2, "old text"));
		return jsonResponse(detail());
	}) as unknown as typeof fetch;
	const mounted = mount(
		createElement(SkillsSettings, {
			token,
			initialSkills: [summary()],
			initialSkill: detail(),
		}),
	);

	try {
		const existingActivate = Array.from(
			mounted.container.querySelectorAll<HTMLButtonElement>("button"),
		).find((candidate) => candidate.textContent?.trim() === "Activate");
		expect(existingActivate).toBeUndefined();
		const version =
			mounted.container.querySelector<HTMLSelectElement>("#skill-version");
		expect(version).not.toBeNull();
		await interact(() => setVersion(version as HTMLSelectElement, "1"));
		const textarea =
			mounted.container.querySelector<HTMLTextAreaElement>("#skill-text");
		expect(textarea?.readOnly).toBe(true);
		expect(textarea?.value).toBe("old text");
		expect(button(mounted.container, "Save").disabled).toBe(true);
		expect(mounted.container.textContent).toContain(
			"Activate this version to edit it.",
		);
		await interact(() => button(mounted.container, "Activate").click());
		const activation = calls.find(
			(call) => call.init?.method === "POST" && call.url.includes("/active"),
		);
		expect(activation?.url).toContain("/api/skills/review-it/active?");
		expect(JSON.parse(String(activation?.init?.body))).toEqual({ version: 1 });
		expect(
			mounted.container.querySelector<HTMLSelectElement>(
				"#skill-version option[value='1']",
			)?.textContent,
		).toBe("v1 (active)");
		const activationButton = Array.from(
			mounted.container.querySelectorAll<HTMLButtonElement>("button"),
		).find((candidate) => candidate.textContent?.trim() === "Activate");
		expect(activationButton).toBeUndefined();
	} finally {
		mounted.cleanup();
		globalThis.fetch = originalFetch;
	}
});

test("creates new version from editor text and makes it active", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return jsonResponse({ version: 3 });
	}) as unknown as typeof fetch;
	const mounted = mount(
		createElement(SkillsSettings, {
			token,
			initialSkills: [summary()],
			initialSkill: detail(),
		}),
	);

	try {
		const textarea =
			mounted.container.querySelector<HTMLTextAreaElement>("#skill-text");
		expect(textarea).not.toBeNull();
		await interact(() =>
			setTextValue(textarea as HTMLTextAreaElement, "forked text"),
		);
		await interact(() => button(mounted.container, "New version").click());
		const request = calls.find((call) => call.init?.method === "POST");
		expect(request?.url).toContain("/api/skills/review-it/versions?");
		expect(JSON.parse(String(request?.init?.body))).toEqual({
			text: "forked text",
		});
		expect(
			mounted.container.querySelector<HTMLSelectElement>("#skill-version")
				?.value,
		).toBe("3");
		expect(
			mounted.container.querySelector<HTMLTextAreaElement>("#skill-text")
				?.value,
		).toBe("forked text");
		expect(button(mounted.container, "Save").disabled).toBe(true);
	} finally {
		mounted.cleanup();
		globalThis.fetch = originalFetch;
	}
});

test("saves changed active text and disables Save when text is unchanged", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return jsonResponse({ version: 2 });
	}) as unknown as typeof fetch;
	const mounted = mount(
		createElement(SkillsSettings, {
			token,
			initialSkills: [summary()],
			initialSkill: detail(),
		}),
	);

	try {
		const textarea =
			mounted.container.querySelector<HTMLTextAreaElement>("#skill-text");
		expect(textarea).not.toBeNull();
		expect(button(mounted.container, "Save").disabled).toBe(true);
		await interact(() =>
			setTextValue(textarea as HTMLTextAreaElement, "saved text"),
		);
		expect(button(mounted.container, "Save").disabled).toBe(false);
		await interact(() => button(mounted.container, "Save").click());
		const request = calls.find((call) => call.init?.method === "POST");
		expect(request?.url).toContain("/api/skills/review-it?");
		expect(JSON.parse(String(request?.init?.body))).toEqual({
			text: "saved text",
		});
		expect(button(mounted.container, "Save").disabled).toBe(true);
		expect(
			mounted.container.querySelector<HTMLTextAreaElement>("#skill-text")
				?.value,
		).toBe("saved text");
		expect(
			mounted.container.querySelectorAll("#skill-version option"),
		).toHaveLength(2);
	} finally {
		mounted.cleanup();
		globalThis.fetch = originalFetch;
	}
});

test("Delete requires confirmation and selects next skill after deletion", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = (async (input: string, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (init?.method === "DELETE") return jsonResponse({ deleted: true });
		if (url.includes("/api/skills/write-note")) {
			return jsonResponse(detail("write-note", 1, 1, "next skill", [1]));
		}
		return jsonResponse({ deleted: true });
	}) as unknown as typeof fetch;
	const mounted = mount(
		createElement(SkillsSettings, {
			token,
			initialSkills: [summary(), summary("write-note", 1, [1])],
			initialSkill: detail(),
		}),
	);

	try {
		await interact(() => button(mounted.container, "Delete skill").click());
		expect(
			document.body.querySelector('[role="dialog"]')?.textContent,
		).toContain("This removes the skill and all of its versions.");
		await interact(() => button(document.body, "Cancel").click());
		expect(calls.some((call) => call.init?.method === "DELETE")).toBe(false);

		await interact(() => button(mounted.container, "Delete skill").click());
		await interact(() => button(document.body, "Delete").click());
		const request = calls.find((call) => call.init?.method === "DELETE");
		expect(request?.url).toContain("/api/skills/review-it?");
		expect(mounted.container.querySelector("h3")?.textContent).toBe(
			"write-note",
		);
		expect(
			mounted.container.querySelector('nav button[aria-current="true"]')
				?.textContent,
		).toContain("write-note");
	} finally {
		mounted.cleanup();
		globalThis.fetch = originalFetch;
	}
});
