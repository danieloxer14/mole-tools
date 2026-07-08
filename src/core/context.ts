import type { Config } from "../adapters/config/schema";
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

export function buildContext(_input: { config: Config; ui: UiPort }): Context {
	throw new Error("not implemented");
}
