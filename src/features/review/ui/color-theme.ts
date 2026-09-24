import { useSyncExternalStore } from "react";
import type { ColorTheme } from "../../../adapters/config/schema";

export type { ColorTheme };

export const COLOR_THEME_OPTIONS: readonly {
	value: ColorTheme;
	label: string;
}[] = [
	{ value: "default", label: "Default" },
	{ value: "light", label: "Light" },
];

const listeners = new Set<() => void>();

export interface ColorThemeSaveState {
	readonly colorTheme: ColorTheme;
	readonly pending: boolean;
	readonly error: string | null;
}

interface ColorThemeSaveStatus {
	pending: boolean;
	error: string | null;
}

const serverColorThemeState: ColorThemeSaveState = {
	colorTheme: "default",
	pending: false,
	error: null,
};

let colorThemeSaveStatus: ColorThemeSaveStatus = {
	pending: false,
	error: null,
};
let colorThemeSaveSnapshot: ColorThemeSaveState | null = null;

function getColorThemeSaveState(): ColorThemeSaveState {
	const colorTheme = currentColorTheme();
	if (
		colorThemeSaveSnapshot?.colorTheme === colorTheme &&
		colorThemeSaveSnapshot.pending === colorThemeSaveStatus.pending &&
		colorThemeSaveSnapshot.error === colorThemeSaveStatus.error
	)
		return colorThemeSaveSnapshot;
	colorThemeSaveSnapshot = {
		colorTheme,
		pending: colorThemeSaveStatus.pending,
		error: colorThemeSaveStatus.error,
	};
	return colorThemeSaveSnapshot;
}

function notifyColorThemeListeners(): void {
	colorThemeSaveSnapshot = null;
	for (const listener of listeners) listener();
}

function setThemeClass(theme: ColorTheme): void {
	document.documentElement.classList.toggle("dark", theme === "default");
}

function publishColorThemeSaveState(
	state: ColorThemeSaveStatus,
	theme?: ColorTheme,
): void {
	if (theme !== undefined) setThemeClass(theme);
	colorThemeSaveStatus = state;
	notifyColorThemeListeners();
}

export function isColorTheme(value: unknown): value is ColorTheme {
	return value === "default" || value === "light";
}

export function currentColorTheme(): ColorTheme {
	return document.documentElement.classList.contains("dark")
		? "default"
		: "light";
}

export function applyColorTheme(theme: ColorTheme): void {
	setThemeClass(theme);
	notifyColorThemeListeners();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useColorTheme(): ColorTheme {
	return useSyncExternalStore(subscribe, currentColorTheme, () => "default");
}

export function useColorThemeSaveState(): ColorThemeSaveState {
	return useSyncExternalStore(
		subscribe,
		getColorThemeSaveState,
		() => serverColorThemeState,
	);
}

function appearanceUrl(token: string): string {
	return `/api/settings/appearance?t=${encodeURIComponent(token)}`;
}

export async function fetchColorTheme(token: string): Promise<ColorTheme> {
	const response = await fetch(appearanceUrl(token), {
		headers: { "X-Mole-Token": token },
	});
	if (!response.ok) throw new Error(`Request failed (${response.status})`);
	const value: unknown = await response.json();
	const theme =
		typeof value === "object" && value !== null && "colorTheme" in value
			? value.colorTheme
			: undefined;
	return isColorTheme(theme) ? theme : "default";
}

export async function saveColorTheme(
	token: string,
	theme: ColorTheme,
): Promise<void> {
	const response = await fetch(appearanceUrl(token), {
		method: "POST",
		headers: { "content-type": "application/json", "X-Mole-Token": token },
		body: JSON.stringify({ colorTheme: theme }),
	});
	if (response.ok) return;
	let message = `Request failed (${response.status})`;
	try {
		const value: unknown = await response.json();
		if (
			typeof value === "object" &&
			value !== null &&
			"error" in value &&
			typeof value.error === "string" &&
			value.error.length > 0
		)
			message = value.error;
	} catch {
		// keep status message
	}
	throw new Error(message);
}

export async function changeColorTheme(
	token: string,
	theme: ColorTheme,
): Promise<void> {
	const previousTheme = currentColorTheme();
	if (colorThemeSaveStatus.pending || previousTheme === theme) return;

	publishColorThemeSaveState({ pending: true, error: null }, theme);
	try {
		await saveColorTheme(token, theme);
		publishColorThemeSaveState({ pending: false, error: null });
	} catch (reason: unknown) {
		publishColorThemeSaveState(
			{
				pending: false,
				error: `Color theme not saved: ${reason instanceof Error ? reason.message : String(reason)}`,
			},
			previousTheme,
		);
	}
}

export function bootColorTheme(
	token: string,
	render: () => void,
): Promise<void> {
	return fetchColorTheme(token)
		.then(applyColorTheme, () => undefined)
		.finally(render);
}
