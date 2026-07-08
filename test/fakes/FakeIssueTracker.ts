import type { Issue, IssueTracker } from "../../src/ports/issue-tracker";

export class FakeIssueTracker implements IssueTracker {
	fetchedKeys: string[] = [];

	constructor(
		private readonly issues: Record<string, Issue> = {},
		private readonly error?: Error,
	) {}

	async fetchIssue(key: string): Promise<Issue> {
		this.fetchedKeys.push(key);
		if (this.error) throw this.error;
		const issue = this.issues[key];
		if (!issue)
			throw new Error(`FakeIssueTracker: no issue scripted for ${key}`);
		return issue;
	}
}
