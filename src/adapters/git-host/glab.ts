import { PortError } from "../../core/errors";
import { logger } from "../../core/logger";
import type {
	CreateDiscussionInput,
	CreateMrInput,
	DiffRefs,
	DiscussionPosition,
	GitHost,
	HostDiscussion,
	HostMember,
	HostNote,
	HostUser,
	MrApprovalState,
	MrDetail,
} from "../../ports/git-host";
import { validatePosition } from "../../shared/gitlab-position";
import { encodeProjectPath, type MrRef } from "../../shared/mr-url";
import {
	GitLabApprovalStateSchema,
	GitLabDiscussionPageSchema,
	GitLabDiscussionSchema,
	GitLabMergeRequestSchema,
	GitLabPositionPayloadSchema,
} from "./glab-schemas";

export interface GlabExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export type GlabExec = (
	args: string[],
	input?: string,
) => Promise<GlabExecResult>;

async function defaultGlabExec(
	args: string[],
	input?: string,
): Promise<GlabExecResult> {
	const proc = Bun.spawn(["glab", ...args], {
		stdin: input !== undefined ? "pipe" : undefined,
		stdout: "pipe",
		stderr: "pipe",
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

function apiPath(ref: MrRef, resource: string): string {
	return `projects/${encodeProjectPath(ref.projectPath)}/merge_requests/${ref.iid}${resource}`;
}

function glabApiError(
	result: GlabExecResult,
	operation: string,
): PortError | null {
	if (result.exitCode === 0) return null;
	return new PortError(
		result.stderr?.trim() || `${operation} failed`,
		result.stderr,
		result.exitCode,
	);
}

function invalidPayload(operation: string, detail: string): PortError {
	return new PortError(`Invalid GitLab ${operation} response: ${detail}`);
}

function parseJsonDocuments(text: string, operation: string): unknown[] {
	const source = text.trim();
	if (!source) throw invalidPayload(operation, "empty response");

	try {
		return [JSON.parse(source) as unknown];
	} catch {
		// --paginate can emit one JSON value per page. Scan complete JSON
		// values so both newline-delimited and concatenated pages work.
		const documents: unknown[] = [];
		let start = -1;
		let depth = 0;
		let inString = false;
		let escaped = false;

		for (let index = 0; index < source.length; index++) {
			const character = source[index];
			if (start < 0) {
				if (character === "{" || character === "[") {
					start = index;
					depth = 1;
				} else if (!/\s/.test(character)) {
					throw invalidPayload(operation, "invalid JSON");
				}
				continue;
			}
			if (inString) {
				if (escaped) {
					escaped = false;
				} else if (character === "\\") {
					escaped = true;
				} else if (character === '"') {
					inString = false;
				}
				continue;
			}
			if (character === '"') {
				inString = true;
				continue;
			}
			if (character === "{" || character === "[") depth++;
			if (character === "}" || character === "]") depth--;
			if (depth === 0) {
				const document = source.slice(start, index + 1);
				try {
					documents.push(JSON.parse(document) as unknown);
				} catch {
					throw invalidPayload(operation, "invalid JSON");
				}
				start = -1;
			}
		}

		if (start >= 0 || inString || documents.length === 0) {
			throw invalidPayload(operation, "invalid JSON");
		}
		return documents;
	}
}

function parsePayload<T>(
	schema: {
		safeParse(
			value: unknown,
		):
			| { success: true; data: T }
			| { success: false; error: { issues: { message: string }[] } };
	},
	value: unknown,
	operation: string,
): T {
	const parsed = schema.safeParse(value);
	if (parsed.success) return parsed.data;
	const issue = parsed.error.issues[0]?.message ?? "schema validation failed";
	throw invalidPayload(operation, issue);
}

function mapApprovalIdentity(value: unknown, operation: string): string {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") {
		throw invalidPayload(operation, "approval identity is invalid");
	}
	const record = value as Record<string, unknown>;
	const candidate =
		record.user && typeof record.user === "object"
			? (record.user as Record<string, unknown>)
			: record;
	const identity = candidate.username ?? candidate.name;
	if (typeof identity !== "string" || identity.trim().length === 0) {
		throw invalidPayload(
			operation,
			"approval identity has no username or name",
		);
	}
	return identity;
}

export class GlabAdapter implements GitHost {
	constructor(private readonly execFn: GlabExec = defaultGlabExec) {}

	async preflight(): Promise<void> {
		let result = await this._exec(["--version"]);
		if (result.exitCode !== 0) {
			throw new PortError(
				result.stderr?.trim() || "glab is not installed",
				result.stderr,
				result.exitCode,
			);
		}

		result = await this._exec(["auth", "status"]);
		if (result.exitCode !== 0) {
			throw new PortError(
				result.stderr?.trim() || "glab is not authenticated",
				result.stderr,
				result.exitCode,
			);
		}
	}

	async currentUser(): Promise<HostUser | null> {
		const result = await this._exec(["api", "/user"]);
		if (result.exitCode !== 0 || !result.stdout.trim()) {
			return null;
		}
		try {
			const user = JSON.parse(result.stdout) as Record<string, unknown>;
			return {
				id: String(user.id ?? ""),
				handle: String(user.username ?? user.name ?? ""),
				displayName: String(user.name ?? user.username ?? ""),
			};
		} catch {
			return null;
		}
	}

	async findOpenMr(sourceBranch: string): Promise<{ url: string } | null> {
		const result = await this._exec([
			"mr",
			"list",
			"--source-branch",
			sourceBranch,
		]);
		if (result.exitCode !== 0 || !result.stdout.trim()) {
			return null;
		}

		const lines = result.stdout.trim().split("\n").filter(Boolean);
		for (const line of lines) {
			const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
			const url = urlMatch?.[1];
			if (url) {
				return { url };
			}
		}

		return null;
	}

	async fetchMr(ref: MrRef): Promise<MrDetail> {
		const result = await this._exec([
			"api",
			"--hostname",
			ref.host,
			apiPath(ref, ""),
		]);
		const executionError = glabApiError(result, "merge request fetch");
		if (executionError) throw executionError;

		const documents = parseJsonDocuments(result.stdout, "merge request");
		if (documents.length !== 1) {
			throw invalidPayload("merge request", "expected one JSON object");
		}
		const payload = parsePayload(
			GitLabMergeRequestSchema,
			documents[0],
			"merge request",
		);
		if (payload.iid !== ref.iid) {
			throw new PortError(
				`GitLab merge request IID mismatch: requested ${ref.iid}, received ${payload.iid}`,
			);
		}

		const author = payload.author.username ?? payload.author.name;
		if (!author) {
			throw invalidPayload("merge request", "author has no username or name");
		}

		const diffRefs: DiffRefs = {
			baseSha: payload.diff_refs.base_sha,
			startSha: payload.diff_refs.start_sha,
			headSha: payload.diff_refs.head_sha,
		};
		return {
			iid: payload.iid,
			projectPath: ref.projectPath,
			title: payload.title,
			description: payload.description ?? "",
			webUrl: payload.web_url,
			author,
			sourceBranch: payload.source_branch,
			targetBranch: payload.target_branch,
			headSha: payload.sha ?? diffRefs.headSha,
			diffRefs,
			state: payload.state,
		};
	}

	async fetchApprovalState(ref: MrRef): Promise<MrApprovalState> {
		const result = await this._exec([
			"api",
			"--hostname",
			ref.host,
			apiPath(ref, "/approvals"),
		]);
		const executionError = glabApiError(result, "approval fetch");
		if (executionError) throw executionError;

		const documents = parseJsonDocuments(result.stdout, "approval");
		if (documents.length !== 1) {
			throw invalidPayload("approval", "expected one JSON object");
		}
		const payload = parsePayload(
			GitLabApprovalStateSchema,
			documents[0],
			"approval",
		);
		const approvedBy = payload.approved_by.map((entry) =>
			mapApprovalIdentity(entry, "approval"),
		);
		const currentUser = await this.currentUser();
		const currentIdentities = currentUser
			? new Set(
					[currentUser.handle, currentUser.displayName]
						.filter((identity): identity is string => Boolean(identity))
						.map((identity) => identity.toLowerCase()),
				)
			: null;
		const approved =
			currentIdentities !== null &&
			approvedBy.some((identity) =>
				currentIdentities.has(identity.toLowerCase()),
			);
		const rules = (payload.rules ?? []).map((rule) => {
			const ruleApprovedBy = rule.approved_by.map((entry) =>
				mapApprovalIdentity(entry, "approval"),
			);
			return {
				name: rule.name,
				approvalsRequired: rule.approvals_required,
				approvalsLeft:
					rule.approvals_left ??
					Math.max(0, rule.approvals_required - ruleApprovedBy.length),
				approvedBy: ruleApprovedBy,
			};
		});
		return {
			approved,
			currentUser: currentUser?.handle || null,
			approvalsLeft: payload.approvals_left ?? null,
			approvedBy,
			rules,
		};
	}

	async approveMr(ref: MrRef): Promise<MrApprovalState> {
		const mr = await this.fetchMr(ref);
		const result = await this._exec([
			"api",
			"--hostname",
			ref.host,
			"--method",
			"POST",
			"--field",
			`sha=${mr.headSha}`,
			apiPath(ref, "/approve"),
		]);
		const executionError = glabApiError(result, "approval");
		if (executionError) throw executionError;
		return this.fetchApprovalState(ref);
	}

	async unapproveMr(ref: MrRef): Promise<MrApprovalState> {
		const result = await this._exec([
			"api",
			"--hostname",
			ref.host,
			"--method",
			"POST",
			apiPath(ref, "/unapprove"),
		]);
		const executionError = glabApiError(result, "unapproval");
		if (executionError) throw executionError;
		return this.fetchApprovalState(ref);
	}

	async listDiscussions(ref: MrRef): Promise<HostDiscussion[]> {
		const result = await this._exec([
			"api",
			"--hostname",
			ref.host,
			"--paginate",
			apiPath(ref, "/discussions"),
		]);
		const executionError = glabApiError(result, "discussion fetch");
		if (executionError) throw executionError;

		const documents = parseJsonDocuments(result.stdout, "discussion");
		const discussions = documents.flatMap((document) =>
			parsePayload(GitLabDiscussionPageSchema, document, "discussion"),
		);
		return discussions.map((discussion) => this.mapDiscussion(discussion));
	}

	async createDiscussion(
		input: CreateDiscussionInput,
	): Promise<HostDiscussion> {
		if (!input.body.trim()) {
			throw new PortError("Cannot create an empty GitLab discussion");
		}
		let position: CreateDiscussionInput["position"];
		if (input.position !== undefined) {
			if (!input.parsedDiff || !input.diffRefs) {
				throw new PortError(
					"Positioned GitLab discussions require parsedDiff and diffRefs",
				);
			}
			const parsedPosition = parsePayload(
				GitLabPositionPayloadSchema,
				input.position,
				"discussion position",
			);
			position = validatePosition(
				parsedPosition,
				input.parsedDiff,
				input.diffRefs,
			);
		} else if ("parsedDiff" in input || "diffRefs" in input) {
			throw new PortError(
				"Unpositioned GitLab discussions cannot include parsedDiff or diffRefs",
			);
		}

		const requestBody: { body: string; position?: typeof position } = {
			body: input.body,
		};
		if (position) requestBody.position = position;
		const result = await this._exec(
			[
				"api",
				"--hostname",
				input.ref.host,
				"--method",
				"POST",
				"--header",
				"Content-Type: application/json",
				"--input",
				"-",
				apiPath(input.ref, "/discussions"),
			],
			JSON.stringify(requestBody),
		);
		const executionError = glabApiError(result, "discussion create");
		if (executionError) throw executionError;

		const documents = parseJsonDocuments(result.stdout, "discussion");
		if (documents.length !== 1) {
			throw invalidPayload("discussion", "expected one JSON object");
		}
		return this.mapDiscussion(
			parsePayload(GitLabDiscussionSchema, documents[0], "discussion"),
		);
	}

	private mapDiscussion(discussion: GitLabDiscussion): HostDiscussion {
		const positionedNote = discussion.notes.find(
			(note) => note.position !== null,
		);
		const position: DiscussionPosition | null = positionedNote?.position
			? {
					newPath: positionedNote.position.new_path,
					oldPath: positionedNote.position.old_path,
					newLine: positionedNote.position.new_line,
					oldLine: positionedNote.position.old_line,
				}
			: null;
		return {
			id: String(discussion.id),
			resolved:
				discussion.resolved ?? discussion.notes.some((note) => note.resolved),
			notes: discussion.notes.map((note): HostNote => {
				const author = note.author.username ?? note.author.name;
				if (!author) {
					throw invalidPayload("discussion", "note author is missing");
				}
				return {
					id: String(note.id),
					author,
					body: note.body,
					createdAt: note.created_at,
					system: note.system,
				};
			}),
			position,
		};
	}

	async resolveHandle(handle: string): Promise<HostMember | null> {
		const kind = handle.includes("/") ? "group" : "user";

		const member =
			kind === "group"
				? await this.resolveGroup(handle)
				: await this.resolveUser(handle);

		return member;
	}

	createMr(input: CreateMrInput): Promise<{ url: string }> {
		const args: string[] = ["mr", "create"];

		args.push("--source-branch", input.sourceBranch);
		if (input.title) {
			args.push("--title", input.title);
		}
		if (input.description) {
			args.push("--description", input.description);
		}
		if (input.assignee) {
			args.push("--assignee", input.assignee);
		}
		for (const reviewer of input.reviewers) {
			args.push("--reviewer", reviewer);
		}
		if (input.draft) {
			args.push("--draft");
		}

		return this.createMrWithArgs(args);
	}

	async createMrWithArgs(args: string[]): Promise<{ url: string }> {
		const result = await this._exec(args);
		if (result.exitCode !== 0) {
			throw new PortError(
				result.stderr?.trim() || "glab mr create failed",
				result.stderr,
				result.exitCode,
			);
		}

		const url = result.stdout.match(/(https?:\/\/[^\s]+)/)?.[1];
		if (!url) {
			throw new PortError(
				"MR created but no URL found in output",
				result.stdout,
			);
		}
		return { url };
	}

	async resolveGroup(handle: string): Promise<HostMember | null> {
		const encoded = encodeURIComponent(handle);
		let page = 1;

		const members: HostMember[] = [];
		const MAX_PAGES = 5;

		while (page <= MAX_PAGES) {
			const result = await this._exec([
				"api",
				`/groups/${encoded}/members`,
				"--per-page",
				"100",
				"--page",
				String(page),
			]);
			if (result.exitCode !== 0) {
				logger.warn("glab.resolve-group.failed", {
					handle,
					page,
					exitCode: result.exitCode,
				});
				return members.at(0) ?? null;
			}

			let body: unknown;
			try {
				body = JSON.parse(result.stdout);
			} catch (error) {
				logger.warn("glab.resolve-group.invalid-json", { handle, page, error });
				return members.at(0) ?? null;
			}
			if (!Array.isArray(body)) {
				logger.warn("glab.resolve-group.unexpected-response", {
					handle,
					page,
					responseType: typeof body,
				});
				return members.at(0) ?? null;
			}
			for (const member of body) {
				members.push({
					id: String(member.id ?? ""),
					handle: String(member.username ?? member.name ?? ""),
					displayName: String(member.name ?? member.username ?? ""),
					kind: "user",
				});
			}

			if (body.length < 100) {
				break;
			}
			page++;
		}

		if (members.length === 0) {
			return null;
		}

		const firstMember = members.at(0);
		if (!firstMember) return null;
		return {
			id: firstMember.id,
			handle: handle,
			kind: "group",
		};
	}

	async resolveUser(handle: string): Promise<HostMember | null> {
		// CODEOWNERS gives us usernames, so prefer the exact username lookup. Git
		// history, however, gives us author names (e.g. "Cara Fisher"), which
		// need GitLab's broader search to find the actual username ("caraf").
		const compact = (value: string) =>
			value.toLowerCase().replace(/[^a-z0-9]/g, "");
		const queries = ["username", "search"] as const;
		for (const query of queries) {
			const encoded = encodeURIComponent(handle);
			const result = await this._exec(["api", `/users?${query}=${encoded}`]);

			if (result.exitCode !== 0 || !result.stdout.trim()) continue;

			let body: unknown;
			try {
				body = JSON.parse(result.stdout);
			} catch (error) {
				logger.warn("glab.resolve-user.invalid-json", { handle, query, error });
				continue;
			}
			if (!Array.isArray(body) || body.length === 0) continue;

			const user = body.find((candidate) => {
				if (!candidate || typeof candidate !== "object") return false;
				const record = candidate as Record<string, unknown>;
				return [record.username, record.name].some(
					(value) =>
						typeof value === "string" && compact(value) === compact(handle),
				);
			}) as Record<string, unknown> | undefined;
			if (!user) continue;
			return {
				id: String(user.id ?? ""),
				handle: String(user.username ?? handle),
				displayName: String(user.name ?? user.username ?? handle),
				kind: "user",
			};
		}

		logger.warn("glab.resolve-user.no-match", { handle });
		return null;
	}

	async _exec(args: string[], input?: string): Promise<GlabExecResult> {
		return this.execFn(args, input);
	}
}
