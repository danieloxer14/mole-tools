import { PortError } from "../../core/errors";
import { logger } from "../../core/logger";
import type {
	CreateDiscussionInput,
	CreateMrInput,
	DiscussionPosition,
	GitHost,
	HostDiscussion,
	HostMember,
	HostNote,
	HostUser,
	MrApprovalState,
	MrDetail,
} from "../../ports/git-host";
import { selectDiffLines } from "../../shared/diff-selection";
import type { MrRef } from "../../shared/mr-url";
import {
	GhCompareSchema,
	GhIssueCommentPagesSchema,
	GhIssueCommentSchema,
	GhPullRequestSchema,
	GhPullRequestUrlListSchema,
	GhReviewCommentSchema,
	GhReviewPagesSchema,
	GhReviewThreadPagesSchema,
	GhTeamSchema,
	GhUserSchema,
	GhUserSearchSchema,
} from "./gh-schemas";

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved path line originalLine diffSide
          comments(first: 100) { nodes { databaseId author { login } body createdAt } }
        }
      }
    }
  }
}`;

function githubRepoPath(ref: MrRef): string {
	return ref.projectPath.split("/").map(encodeURIComponent).join("/");
}

function discussionPosition(
	path: string,
	side: "LEFT" | "RIGHT",
	line: number | null,
): DiscussionPosition | null {
	return line === null
		? null
		: {
				newPath: path,
				oldPath: path,
				newLine: side === "RIGHT" ? line : null,
				oldLine: side === "LEFT" ? line : null,
			};
}

export interface GhExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export type GhExec = (args: string[], input?: string) => Promise<GhExecResult>;

async function defaultGhExec(
	args: string[],
	input?: string,
): Promise<GhExecResult> {
	const proc = Bun.spawn(["gh", ...args], {
		stdin: input !== undefined ? "pipe" : undefined,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GH_PROMPT_DISABLED: "1" },
	});
	if (input !== undefined && proc.stdin && typeof proc.stdin !== "number") {
		proc.stdin.write(input);
		proc.stdin.end();
	}

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function invalidPayload(operation: string, detail: string): PortError {
	return new PortError(`Invalid GitHub ${operation} response: ${detail}`);
}

function parseJson(text: string, operation: string): unknown {
	const source = text.trim();
	if (!source) {
		throw invalidPayload(operation, "empty response");
	}

	try {
		return JSON.parse(source) as unknown;
	} catch {
		throw invalidPayload(operation, "invalid JSON");
	}
}

type GhSchema<T> = {
	safeParse(value: unknown):
		| { success: true; data: T }
		| {
				success: false;
				error: { issues: { message: string; path?: readonly unknown[] }[] };
		  };
};

function parsePayload<T>(
	schema: GhSchema<T>,
	value: unknown,
	operation: string,
): T {
	const parsed = schema.safeParse(value);
	if (parsed.success) {
		return parsed.data;
	}

	const issue = parsed.error.issues[0];
	const path = issue?.path?.map(String).join(".");
	throw invalidPayload(
		operation,
		`${path ? `${path}: ` : ""}${issue?.message ?? "schema validation failed"}`,
	);
}
function ghApiError(result: GhExecResult, operation: string): PortError {
	return new PortError(
		result.stderr.trim() || `${operation} failed`,
		result.stderr,
		result.exitCode,
	);
}

function compact(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type GhDecisiveReviewState = "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED";

interface GhReviewDecision {
	id: number;
	login: string;
	state: GhDecisiveReviewState;
}

function noteFromComment(comment: {
	id: number;
	user: { login: string } | null;
	body: string;
	created_at: string;
}): HostNote {
	return {
		id: String(comment.id),
		author: comment.user?.login ?? "ghost",
		body: comment.body,
		createdAt: comment.created_at,
		system: false,
	};
}

export class GhAdapter implements GitHost {
	readonly host: string;
	private readonly execFn: GhExec;

	constructor(options: { host?: string; exec?: GhExec } = {}) {
		this.host = options.host ?? "github.com";
		this.execFn = options.exec ?? defaultGhExec;
	}

	private async lookup<T>(
		args: string[],
		schema: GhSchema<T>,
		operation: string,
	): Promise<T | null> {
		let result: GhExecResult;
		try {
			result = await this.execFn(args);
		} catch (error) {
			logger.warn("gh.lookup.failed", {
				operation,
				exitCode: null,
				error: errorMessage(error),
			});
			return null;
		}

		if (result.exitCode !== 0 || !result.stdout.trim()) {
			logger.warn("gh.lookup.failed", {
				operation,
				exitCode: result.exitCode,
				error: result.stderr.trim() || "empty response",
			});
			return null;
		}

		try {
			return parsePayload(
				schema,
				parseJson(result.stdout, operation),
				operation,
			);
		} catch (error) {
			logger.warn("gh.lookup.failed", {
				operation,
				exitCode: result.exitCode,
				error: errorMessage(error),
			});
			return null;
		}
	}

	async preflight(): Promise<void> {
		let result: GhExecResult;
		try {
			result = await this.execFn(["--version"]);
		} catch (error) {
			const stderr = errorMessage(error);
			throw new PortError("gh is not installed", stderr, 1);
		}

		if (result.exitCode !== 0) {
			throw new PortError(
				result.stderr.trim() || "gh is not installed",
				result.stderr,
				result.exitCode,
			);
		}

		try {
			result = await this.execFn(["auth", "status", "--hostname", this.host]);
		} catch (error) {
			const stderr = errorMessage(error);
			throw new PortError(
				stderr.trim() || `gh is not authenticated for ${this.host}`,
				stderr,
				1,
			);
		}

		if (result.exitCode !== 0) {
			throw new PortError(
				result.stderr.trim() || `gh is not authenticated for ${this.host}`,
				result.stderr,
				result.exitCode,
			);
		}
	}

	async currentUser(): Promise<HostUser | null> {
		const user = await this.lookup(
			["api", "--hostname", this.host, "user"],
			GhUserSchema,
			"current user",
		);
		if (!user) {
			return null;
		}

		return {
			id: String(user.id),
			handle: user.login,
			displayName: user.name ?? user.login,
		};
	}

	async findOpenMr(sourceBranch: string): Promise<{ url: string } | null> {
		const pullRequests = await this.lookup(
			[
				"pr",
				"list",
				"--head",
				sourceBranch,
				"--state",
				"open",
				"--json",
				"url",
				"--limit",
				"1",
			],
			GhPullRequestUrlListSchema,
			"pull request lookup",
		);
		const url = pullRequests?.[0]?.url;
		return url ? { url } : null;
	}

	async resolveHandle(handle: string): Promise<HostMember | null> {
		try {
			return handle.includes("/")
				? await this.lookupTeam(handle)
				: await this.lookupUser(handle);
		} catch (error) {
			logger.warn("gh.resolve-handle.failed", {
				operation: "handle resolution",
				exitCode: null,
				error: errorMessage(error),
			});
			return null;
		}
	}

	private async lookupTeam(handle: string): Promise<HostMember | null> {
		const slash = handle.indexOf("/");
		const org = handle.slice(0, slash);
		const team = handle.slice(slash + 1);
		const group = await this.lookup(
			[
				"api",
				"--hostname",
				this.host,
				`orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}`,
			],
			GhTeamSchema,
			"team lookup",
		);
		if (!group) {
			return null;
		}

		return {
			id: String(group.id),
			handle,
			displayName: group.name,
			kind: "group",
		};
	}

	private async lookupUser(handle: string): Promise<HostMember | null> {
		const user = await this.lookup(
			["api", "--hostname", this.host, `users/${encodeURIComponent(handle)}`],
			GhUserSchema,
			"user lookup",
		);
		if (user) {
			return this.mapUser(user);
		}

		return this.searchUsers(handle);
	}

	private async searchUsers(handle: string): Promise<HostMember | null> {
		const search = await this.lookup(
			[
				"api",
				"--hostname",
				this.host,
				`search/users?q=${encodeURIComponent(`${handle} in:name type:user`)}&per_page=5`,
			],
			GhUserSearchSchema,
			"user search",
		);
		if (!search) {
			logger.warn("gh.resolve-user.no-match", { handle });
			return null;
		}

		for (const candidate of search.items.slice(0, 5)) {
			const user = await this.lookup(
				[
					"api",
					"--hostname",
					this.host,
					`users/${encodeURIComponent(candidate.login)}`,
				],
				GhUserSchema,
				"user lookup",
			);
			if (!user) {
				continue;
			}

			if (
				compact(user.login) === compact(handle) ||
				(user.name !== null &&
					user.name !== undefined &&
					compact(user.name) === compact(handle))
			) {
				return this.mapUser(user);
			}
		}

		logger.warn("gh.resolve-user.no-match", { handle });
		return null;
	}

	private mapUser(user: {
		id: number;
		login: string;
		name?: string | null;
	}): HostMember {
		return {
			id: String(user.id),
			handle: user.login,
			displayName: user.name ?? user.login,
			kind: "user",
		};
	}

	async listDiscussions(ref: MrRef): Promise<HostDiscussion[]> {
		const [owner, name] = ref.projectPath.split("/");
		const repo = githubRepoPath(ref);
		const graphqlArgs = [
			"api",
			"graphql",
			"--hostname",
			ref.host,
			"--paginate",
			"--slurp",
			"-f",
			`query=${REVIEW_THREADS_QUERY}`,
			"-f",
			`owner=${owner}`,
			"-f",
			`name=${name}`,
			"-F",
			`number=${ref.iid}`,
		];
		const commentsArgs = [
			"api",
			"--hostname",
			ref.host,
			"--paginate",
			"--slurp",
			`repos/${repo}/issues/${ref.iid}/comments?per_page=100`,
		];
		const reviewsArgs = [
			"api",
			"--hostname",
			ref.host,
			"--paginate",
			"--slurp",
			`repos/${repo}/pulls/${ref.iid}/reviews?per_page=100`,
		];
		const fetchApi = async (args: string[]): Promise<string> => {
			const result = await this.execFn(args);
			if (result.exitCode !== 0) {
				throw ghApiError(result, "discussion fetch");
			}
			return result.stdout;
		};

		const graphqlPages = parsePayload(
			GhReviewThreadPagesSchema,
			parseJson(await fetchApi(graphqlArgs), "discussion fetch"),
			"discussion fetch",
		);
		const commentPages = parsePayload(
			GhIssueCommentPagesSchema,
			parseJson(await fetchApi(commentsArgs), "discussion fetch"),
			"discussion fetch",
		);
		const reviewPages = parsePayload(
			GhReviewPagesSchema,
			parseJson(await fetchApi(reviewsArgs), "discussion fetch"),
			"discussion fetch",
		);

		const discussions: HostDiscussion[] = [];
		for (const page of graphqlPages) {
			for (const thread of page.data.repository.pullRequest.reviewThreads
				.nodes) {
				const comments = thread.comments.nodes;
				const firstComment = comments[0];
				if (!firstComment) {
					continue;
				}

				const notes: HostNote[] = comments.map((comment) => ({
					id: String(comment.databaseId),
					author: comment.author?.login ?? "ghost",
					body: comment.body,
					createdAt: comment.createdAt,
					system: false,
				}));
				const position = discussionPosition(
					thread.path,
					thread.diffSide,
					thread.line ?? thread.originalLine,
				);
				discussions.push({
					id: `review-thread-${firstComment.databaseId}`,
					resolved: thread.isResolved,
					individualNote: false,
					notes,
					position,
				});
			}
		}

		for (const comment of commentPages.flat()) {
			discussions.push({
				id: `issue-comment-${comment.id}`,
				resolved: false,
				individualNote: true,
				notes: [
					{
						id: String(comment.id),
						author: comment.user?.login ?? "ghost",
						body: comment.body,
						createdAt: comment.created_at,
						system: false,
					},
				],
				position: null,
			});
		}

		for (const review of reviewPages.flat()) {
			if (!review.body?.trim() || review.state === "PENDING") {
				continue;
			}
			discussions.push({
				id: `review-${review.id}`,
				resolved: false,
				individualNote: true,
				notes: [
					{
						id: String(review.id),
						author: review.user?.login ?? "ghost",
						body: review.body,
						createdAt: review.submitted_at ?? "",
						system: false,
					},
				],
				position: null,
			});
		}

		return discussions
			.map((discussion, index) => ({ discussion, index }))
			.sort((a, b) => {
				const aCreatedAt = a.discussion.notes[0]?.createdAt ?? "";
				const bCreatedAt = b.discussion.notes[0]?.createdAt ?? "";
				if (aCreatedAt < bCreatedAt) {
					return -1;
				}

				if (aCreatedAt > bCreatedAt) {
					return 1;
				}

				return a.index - b.index;
			})
			.map(({ discussion }) => discussion);
	}

	async createMr(input: CreateMrInput): Promise<{ url: string }> {
		const args = [
			"pr",
			"create",
			"--head",
			input.sourceBranch,
			"--title",
			input.title,
			"--body",
			input.description,
		];

		if (input.assignee !== undefined) {
			args.push("--assignee", input.assignee);
		}

		for (const reviewer of input.reviewers) {
			args.push("--reviewer", reviewer);
		}

		if (input.draft) {
			args.push("--draft");
		}

		const result = await this.execFn(args);

		if (result.exitCode !== 0) {
			throw ghApiError(result, "gh pr create");
		}

		const url = result.stdout.match(/https?:\/\/\S+/)?.[0];
		if (!url) {
			throw new PortError(
				"Pull request created but no URL found in output",
				result.stdout,
			);
		}

		return { url };
	}

	async fetchMr(ref: MrRef): Promise<MrDetail> {
		const repo = githubRepoPath(ref);
		const pullResult = await this.execFn([
			"api",
			"--hostname",
			ref.host,
			`repos/${repo}/pulls/${ref.iid}`,
		]);
		if (pullResult.exitCode !== 0) {
			throw ghApiError(pullResult, "pull request fetch");
		}
		const pull = parsePayload(
			GhPullRequestSchema,
			parseJson(pullResult.stdout, "pull request"),
			"pull request",
		);
		if (pull.number !== ref.iid) {
			throw new PortError(
				`GitHub pull request number mismatch: requested ${ref.iid}, received ${pull.number}`,
			);
		}

		const compareResult = await this.execFn([
			"api",
			"--hostname",
			ref.host,
			`repos/${repo}/compare/${pull.base.sha}...${pull.head.sha}`,
		]);
		if (compareResult.exitCode !== 0) {
			throw ghApiError(compareResult, "pull request compare");
		}
		const compare = parsePayload(
			GhCompareSchema,
			parseJson(compareResult.stdout, "compare"),
			"compare",
		);
		let state: string;
		if (pull.merged_at !== null) {
			state = "merged";
		} else if (pull.state === "open") {
			state = "opened";
		} else {
			state = "closed";
		}

		return {
			provider: "github",
			iid: pull.number,
			projectPath: ref.projectPath,
			title: pull.title,
			description: pull.body ?? "",
			webUrl: pull.html_url,
			author: pull.user.login,
			sourceBranch: pull.head.ref,
			targetBranch: pull.base.ref,
			headSha: pull.head.sha,
			diffRefs: {
				baseSha: compare.merge_base_commit.sha,
				startSha: pull.base.sha,
				headSha: pull.head.sha,
			},
			state,
		};
	}

	private async loadReviewDecisions(ref: MrRef): Promise<{
		latestByUser: Map<string, GhReviewDecision>;
		currentUser: string | null;
	}> {
		const repo = githubRepoPath(ref);
		const reviewsResult = await this.execFn([
			"api",
			"--hostname",
			ref.host,
			"--paginate",
			"--slurp",
			`repos/${repo}/pulls/${ref.iid}/reviews?per_page=100`,
		]);
		if (reviewsResult.exitCode !== 0) {
			throw ghApiError(reviewsResult, "approval fetch");
		}
		const pages = parsePayload(
			GhReviewPagesSchema,
			parseJson(reviewsResult.stdout, "approval fetch"),
			"approval fetch",
		);
		const latestByUser = new Map<string, GhReviewDecision>();
		for (const page of pages) {
			for (const review of page) {
				if (
					review.state !== "APPROVED" &&
					review.state !== "CHANGES_REQUESTED" &&
					review.state !== "DISMISSED"
				) {
					continue;
				}
				if (review.user === null) {
					continue;
				}
				const login = review.user.login;
				latestByUser.set(login.toLowerCase(), {
					id: review.id,
					login,
					state: review.state,
				});
			}
		}

		const user = await this.lookup(
			["api", "--hostname", ref.host, "user"],
			GhUserSchema,
			"current user",
		);
		return { latestByUser, currentUser: user?.login ?? null };
	}

	async fetchApprovalState(ref: MrRef): Promise<MrApprovalState> {
		const { latestByUser, currentUser } = await this.loadReviewDecisions(ref);
		const approvedBy: string[] = [];
		for (const review of latestByUser.values()) {
			if (review.state === "APPROVED") {
				approvedBy.push(review.login);
			}
		}
		return {
			approved:
				currentUser !== null &&
				approvedBy.some(
					(login) => login.toLowerCase() === currentUser.toLowerCase(),
				),
			currentUser,
			approvalsLeft: null,
			approvedBy,
			rules: [],
		};
	}

	async approveMr(ref: MrRef): Promise<MrApprovalState> {
		const mr = await this.fetchMr(ref);
		const result = await this.execFn([
			"api",
			"--hostname",
			ref.host,
			"--method",
			"POST",
			`repos/${githubRepoPath(ref)}/pulls/${ref.iid}/reviews`,
			"-f",
			"event=APPROVE",
			"-f",
			`commit_id=${mr.headSha}`,
		]);
		if (result.exitCode !== 0) {
			throw ghApiError(result, "approve");
		}

		return this.fetchApprovalState(ref);
	}

	async unapproveMr(ref: MrRef): Promise<MrApprovalState> {
		const { latestByUser, currentUser } = await this.loadReviewDecisions(ref);
		const currentReview =
			currentUser === null
				? undefined
				: latestByUser.get(currentUser.toLowerCase());

		if (currentReview?.state === "APPROVED") {
			const result = await this.execFn([
				"api",
				"--hostname",
				ref.host,
				"--method",
				"PUT",
				`repos/${githubRepoPath(ref)}/pulls/${ref.iid}/reviews/${currentReview.id}/dismissals`,
				"-f",
				"message=Approval withdrawn via mole-tools review",
				"-f",
				"event=DISMISS",
			]);
			if (result.exitCode !== 0) {
				throw ghApiError(result, "unapprove");
			}
		}

		return this.fetchApprovalState(ref);
	}

	async createDiscussion(
		input: CreateDiscussionInput,
	): Promise<HostDiscussion> {
		if (!input.body.trim()) {
			throw new PortError("Cannot create an empty GitHub comment");
		}

		const repo = githubRepoPath(input.ref);
		let endpoint: string;
		let payload:
			| { body: string }
			| {
					body: string;
					commit_id: string;
					path: string;
					side: "LEFT" | "RIGHT";
					line: number;
					start_line?: number;
					start_side?: "LEFT" | "RIGHT";
			  };

		if (input.selection === undefined) {
			if ("parsedDiff" in input || "diffRefs" in input) {
				throw new PortError(
					"Unpositioned GitHub comments cannot include parsedDiff or diffRefs",
				);
			}
			endpoint = `repos/${repo}/issues/${input.ref.iid}/comments`;
			payload = { body: input.body };
		} else {
			const selected = selectDiffLines(input.selection, input.parsedDiff);
			const path = input.parsedDiff.newPath ?? input.parsedDiff.oldPath;
			if (path === null) {
				throw new PortError("Invalid diff line selection: diff has no path");
			}
			const side = input.selection.side === "new" ? "RIGHT" : "LEFT";
			const lineField = side === "RIGHT" ? "newLine" : "oldLine";
			const first = selected[0];
			const last = selected.at(-1);
			if (!first || !last) {
				throw new PortError("Invalid diff line selection: no lines selected");
			}
			const firstLine = first[lineField];
			const line = last[lineField];
			if (firstLine === null || line === null) {
				throw new PortError(
					"Invalid diff line selection: selected line is missing",
				);
			}
			endpoint = `repos/${repo}/pulls/${input.ref.iid}/comments`;
			payload = {
				body: input.body,
				commit_id: input.diffRefs.headSha,
				path,
				side,
				line,
				...(input.selection.endLine > input.selection.startLine
					? { start_line: firstLine, start_side: side }
					: {}),
			};
		}
		const result = await this.execFn(
			[
				"api",
				"--hostname",
				input.ref.host,
				"--method",
				"POST",
				"--input",
				"-",
				endpoint,
			],
			JSON.stringify(payload),
		);
		if (result.exitCode !== 0) {
			throw ghApiError(result, "comment create");
		}

		const response = parseJson(result.stdout, "comment create");
		if (input.selection === undefined) {
			const comment = parsePayload(
				GhIssueCommentSchema,
				response,
				"comment create",
			);
			const note = noteFromComment(comment);
			return {
				id: `issue-comment-${comment.id}`,
				resolved: false,
				individualNote: true,
				notes: [note],
				position: null,
			};
		}

		const comment = parsePayload(
			GhReviewCommentSchema,
			response,
			"comment create",
		);
		const note = noteFromComment(comment);
		const position = discussionPosition(
			comment.path,
			comment.side ?? "RIGHT",
			comment.line ?? comment.original_line,
		);
		return {
			id: `review-thread-${comment.id}`,
			resolved: false,
			individualNote: false,
			notes: [note],
			position,
		};
	}
}
