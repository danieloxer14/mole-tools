import { dirname, join } from "node:path";
import { defaultConfigPath } from "../config/loader";
import { DEFAULT_PROMPTS, type PromptName } from "./defaults";

export type { PromptName } from "./defaults";

function promptFileName(name: PromptName): string {
	return `${name}.md`;
}

export function promptsDir(configPath: string = defaultConfigPath()): string {
	return join(dirname(configPath), "prompts");
}

export async function loadPrompt(
	name: PromptName,
	dir: string = promptsDir(),
): Promise<string> {
	const path = join(dir, promptFileName(name));
	if (!(await Bun.file(path).exists())) {
		await Bun.write(path, DEFAULT_PROMPTS[name]);
	}
	return (await Bun.file(path).text()).trim();
}
