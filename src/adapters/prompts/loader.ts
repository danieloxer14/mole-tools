import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PortError } from "../../core/errors";
import { defaultConfigPath } from "../config/loader";
import {
	DEFAULT_PRESET,
	DEFAULT_PROMPTS,
	PresetNameSchema,
	type PromptName,
} from "./defaults";

export type { PromptName } from "./defaults";

export function promptsDir(configPath: string = defaultConfigPath()): string {
	return join(dirname(configPath), "prompts");
}

export function activePreset(
	config: { prompts?: Partial<Record<PromptName, string>> } | undefined,
	name: PromptName,
): string {
	return config?.prompts?.[name] ?? DEFAULT_PRESET;
}

async function ensureSlotDir(name: PromptName, dir: string): Promise<string> {
	const slotDir = join(dir, name);
	await mkdir(slotDir, { recursive: true });

	const defaultVersionPath = join(slotDir, DEFAULT_PRESET, "001.md");
	if (!(await Bun.file(defaultVersionPath).exists())) {
		const flatPath = join(dir, `${name}.md`);
		if (await Bun.file(flatPath).exists()) {
			await mkdir(dirname(defaultVersionPath), { recursive: true });
			await Bun.write(defaultVersionPath, await Bun.file(flatPath).text());
		} else if (
			name === "mr-code" &&
			!(await Bun.file(join(dir, "mr-code.md")).exists())
		) {
			const legacyPath = join(dir, "mr-system.md");
			if (await Bun.file(legacyPath).exists()) {
				await mkdir(dirname(defaultVersionPath), { recursive: true });
				await Bun.write(defaultVersionPath, await Bun.file(legacyPath).text());
			}
		}
	}

	return slotDir;
}

async function versionsInPreset(
	slotDir: string,
	preset: string,
): Promise<number[]> {
	try {
		const entries = await readdir(join(slotDir, preset), {
			withFileTypes: true,
		});
		return entries
			.filter((entry) => entry.isFile())
			.map((entry) => /^(\d+)\.md$/.exec(entry.name)?.[1])
			.filter((version): version is string => version !== undefined)
			.map(Number)
			.sort((a, b) => a - b);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function versionPath(slotDir: string, preset: string, version: number): string {
	return join(slotDir, preset, `${String(version).padStart(3, "0")}.md`);
}

export async function listPresets(
	name: PromptName,
	dir = promptsDir(),
): Promise<string[]> {
	const slotDir = await ensureSlotDir(name, dir);
	const entries = await readdir(slotDir, { withFileTypes: true });
	const presets = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
	if (!presets.includes(DEFAULT_PRESET)) presets.push(DEFAULT_PRESET);
	return presets.sort();
}

export async function listVersions(
	name: PromptName,
	preset: string,
	dir = promptsDir(),
): Promise<number[]> {
	const slotDir = await ensureSlotDir(name, dir);
	PresetNameSchema.parse(preset);
	return versionsInPreset(slotDir, preset);
}

export async function readPrompt(
	name: PromptName,
	options: { preset?: string; version?: number; dir?: string } = {},
): Promise<{ text: string; preset: string; version: number }> {
	const dir = options.dir ?? promptsDir();
	const slotDir = await ensureSlotDir(name, dir);
	const preset = options.preset ?? DEFAULT_PRESET;
	PresetNameSchema.parse(preset);
	let versions = await versionsInPreset(slotDir, preset);

	if (preset === DEFAULT_PRESET && versions.length === 0) {
		await mkdir(join(slotDir, DEFAULT_PRESET), { recursive: true });
		await Bun.write(
			versionPath(slotDir, DEFAULT_PRESET, 1),
			DEFAULT_PROMPTS[name],
		);
		versions = [1];
	} else if (versions.length === 0) {
		throw new PortError(`Prompt preset '${preset}' not found for ${name}`);
	}

	const version = options.version ?? versions.at(-1);
	if (version === undefined || !versions.includes(version)) {
		throw new PortError(
			`Prompt version ${version} not found for ${name}/${preset}`,
		);
	}
	return {
		text: await Bun.file(versionPath(slotDir, preset, version)).text(),
		preset,
		version,
	};
}

export async function loadPrompt(
	name: PromptName,
	options: { preset?: string; dir?: string } = {},
): Promise<string> {
	return (await readPrompt(name, options)).text.trim();
}

export async function savePrompt(
	name: PromptName,
	options: { preset: string; text: string; dir?: string },
): Promise<number> {
	const preset = PresetNameSchema.parse(options.preset);
	const dir = options.dir ?? promptsDir();
	const slotDir = await ensureSlotDir(name, dir);
	const presetDir = join(slotDir, preset);
	await mkdir(presetDir, { recursive: true });
	let versions = await versionsInPreset(slotDir, preset);
	if (preset === DEFAULT_PRESET && versions.length === 0) {
		await Bun.write(
			versionPath(slotDir, DEFAULT_PRESET, 1),
			DEFAULT_PROMPTS[name],
		);
		versions = [1];
	}
	const version = (versions[versions.length - 1] ?? 0) + 1;
	await Bun.write(versionPath(slotDir, preset, version), options.text);
	return version;
}
