export interface Config {
	ollama: {
		commitModel: string;
		mrModel?: string;
		baseUrl: string;
	};
	commitSystemPrompt: string;
	mrSystemPrompt?: string;
	jira: {
		enabled: boolean;
		url?: string;
		apiKey?: string;
		branchPattern: string;
	};
	diff: {
		ignore: string[];
	};
	dynamicEnvRepos?: string[];
	autoReviewer?: {
		username: string;
	};
}
