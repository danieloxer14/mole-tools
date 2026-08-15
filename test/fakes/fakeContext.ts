import { CONFIG_TEMPLATE } from "../../src/adapters/config/loader";
import type { Config, RoutingPurpose } from "../../src/adapters/config/schema";
import type { Context } from "../../src/core/context";
import type { GitHost } from "../../src/ports/git-host";
import type { IssueTracker } from "../../src/ports/issue-tracker";
import type { Llm } from "../../src/ports/llm";
import type { UiPort } from "../../src/ports/ui";
import type { Vcs } from "../../src/ports/vcs";
import { FakeGitHost } from "./FakeGitHost";
import { FakeLlm } from "./FakeLlm";
import { FakeUiPort } from "./FakeUiPort";
import { FakeVcs } from "./FakeVcs";

export function fakeContext(
	overrides: {
		config?: Config;
		ui?: UiPort;
		vcs?: Vcs;
		llm?: Llm;
		issues?: IssueTracker | null;
		gitHost?: GitHost | null;
	} = {},
): Context {
	const llm = overrides.llm ?? new FakeLlm();

	return {
		config: overrides.config ?? CONFIG_TEMPLATE,
		ui: overrides.ui ?? new FakeUiPort(),
		vcs: overrides.vcs ?? new FakeVcs(),
		llm,
		getLlmFor: (_purpose: RoutingPurpose): Llm => llm,
		issues: overrides.issues !== undefined ? overrides.issues : null,
		gitHost:
			overrides.gitHost !== undefined ? overrides.gitHost : new FakeGitHost(),
	};
}
