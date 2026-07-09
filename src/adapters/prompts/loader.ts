import { dirname, join } from "node:path";
import { defaultConfigPath } from "../config/loader";

export type PromptName = "commit-system" | "mr-system";

const DEFAULT_PROMPTS: Record<PromptName, string> = {
	"commit-system":
		"Write a concise Conventional Commits message for the following staged diff. Reply with only the message.\n",
	"mr-system": "Write a concise merge request description for the following changes.\n",
};

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
