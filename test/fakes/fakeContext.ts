import { CONFIG_TEMPLATE } from "../../src/adapters/config/loader";
import type { Config } from "../../src/adapters/config/schema";
import type { Context, Logger } from "../../src/core/context";
import { CostTracker } from "../../src/core/cost-tracker";
import type { GitHost } from "../../src/ports/git-host";
import type { IssueTracker } from "../../src/ports/issue-tracker";
import type { Llm } from "../../src/ports/llm";
import type { UiPort } from "../../src/ports/ui";
import type { Vcs } from "../../src/ports/vcs";
import { FakeGitHost } from "./FakeGitHost";
import { FakeLlm } from "./FakeLlm";
import { FakeUiPort } from "./FakeUiPort";
import { FakeVcs } from "./FakeVcs";

const noopLogger: Logger = {
	info() {},
	warn() {},
	error() {},
};

export function fakeContext(
	overrides: {
		config?: Config;
		ui?: UiPort;
		vcs?: Vcs;
		llm?: Llm;
		issues?: IssueTracker | null;
		gitHost?: GitHost | null;
		log?: Logger;
		costTracker?: CostTracker;
	} = {},
): Context {
	const llm = overrides.llm ?? new FakeLlm();

	return {
		config: overrides.config ?? CONFIG_TEMPLATE,
		ui: overrides.ui ?? new FakeUiPort(),
		vcs: overrides.vcs ?? new FakeVcs(),
		llm,
		getLlmFor: (_purpose: "commit" | "mergeRequest" | "ralph"): Llm => llm,
		issues: overrides.issues !== undefined ? overrides.issues : null,
		gitHost:
			overrides.gitHost !== undefined ? overrides.gitHost : new FakeGitHost(),
		log: overrides.log ?? noopLogger,
		costTracker: overrides.costTracker ?? new CostTracker(),
	};
}
