import { dirname, join } from "node:path";
import { defaultConfigPath } from "../config/loader";
import { DEFAULT_PROMPTS, type PromptName } from "./defaults";

export type { PromptName } from "./defaults";

export function promptsDir(configPath: string = defaultConfigPath()): string {
	return join(dirname(configPath), "prompts");
}

export async function loadPrompt(
	name: PromptName,
	dir: string = promptsDir(),
): Promise<string> {
	const path = join(dir, `${name}.md`);
	if (!(await Bun.file(path).exists())) {
		await Bun.write(path, DEFAULT_PROMPTS[name]);
	}
	return (await Bun.file(path).text()).trim();
}

export async function loadPromptWithFallback(
	names: readonly PromptName[],
	dir: string = promptsDir(),
): Promise<string> {
	const primary = names[0];
	if (!primary) throw new Error("At least one prompt name is required");
	for (const name of names) {
		const path = join(dir, `${name}.md`);
		if (await Bun.file(path).exists())
			return (await Bun.file(path).text()).trim();
	}
	return loadPrompt(primary, dir);
}
