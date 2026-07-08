export interface Issue {
	key: string;
	summary: string;
	description: string;
}

export interface IssueTracker {
	fetchIssue(key: string): Promise<Issue>;
}
