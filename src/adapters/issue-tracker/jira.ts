import { PortError } from "../../core/errors";
import type { Issue, IssueTracker } from "../../ports/issue-tracker";
import { truncateWords } from "../../shared/text";

const MAX_DESCRIPTION_WORDS = 500;

export interface JiraConfig {
	url: string;
	apiKey: string;
	email?: string;
}

interface JiraIssueResponse {
	key: string;
	fields: {
		summary: string;
		description?: string;
	};
}

export class JiraAdapter implements IssueTracker {
	constructor(private readonly cfg: JiraConfig) {}

	private authHeader(): string {
		// Jira Cloud API tokens require Basic auth with the account email;
		// Bearer is only valid for Server/Data Center personal access tokens.
		return this.cfg.email
			? `Basic ${btoa(`${this.cfg.email}:${this.cfg.apiKey}`)}`
			: `Bearer ${this.cfg.apiKey}`;
	}

	async fetchIssue(key: string): Promise<Issue> {
		let res: Response;
		try {
			res = await fetch(`${this.cfg.url}/rest/api/2/issue/${key}`, {
				headers: {
					Authorization: this.authHeader(),
					Accept: "application/json",
				},
			});
		} catch (e) {
			throw new PortError(`Cannot reach Jira at ${this.cfg.url}: ${String(e)}`);
		}

		if (res.status === 404) {
			throw new PortError(
				`Jira issue ${key} not found`,
				await res.text(),
				res.status,
			);
		}
		if (res.status === 401 || res.status === 403) {
			throw new PortError(
				`Jira authentication failed (${res.status})`,
				await res.text(),
				res.status,
			);
		}
		if (!res.ok) {
			throw new PortError(
				`Jira request failed (${res.status})`,
				await res.text(),
				res.status,
			);
		}

		const data = (await res.json()) as JiraIssueResponse;
		return {
			key: data.key,
			summary: data.fields.summary,
			description: truncateWords(
				data.fields.description ?? "",
				MAX_DESCRIPTION_WORDS,
			),
		};
	}
}
