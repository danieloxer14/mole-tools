import type { Config } from "../adapters/config/schema";
import { JiraAdapter } from "../adapters/issue-tracker/jira";
import { OllamaAdapter } from "../adapters/llm/ollama";
import { GitAdapter } from "../adapters/vcs/git";
import type { GitHost } from "../ports/git-host";
import type { IssueTracker } from "../ports/issue-tracker";
import type { Llm } from "../ports/llm";
import type { UiPort } from "../ports/ui";
import type { Vcs } from "../ports/vcs";

export interface Logger {
	info(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
}

export interface Context {
	config: Config;
	ui: UiPort;
	vcs: Vcs;
	llm: Llm;
	issues: IssueTracker | null;
	gitHost: GitHost | null;
	log: Logger;
}

function makeLogger(): Logger {
	return {
		info: (msg) => console.log(msg),
		warn: (msg) => console.warn(msg),
		error: (msg) => console.error(msg),
	};
}

export function buildContext(input: { config: Config; ui: UiPort }): Context {
	const { config, ui } = input;
	return {
		config,
		ui,
		vcs: new GitAdapter(),
		llm: new OllamaAdapter(config.ollama),
		issues:
			config.jira.enabled && config.jira.url && config.jira.apiKey
				? new JiraAdapter({ url: config.jira.url, apiKey: config.jira.apiKey })
				: null,
		gitHost: null,
		log: makeLogger(),
	};
}
