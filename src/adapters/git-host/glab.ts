import { PortError } from "../../core/errors";
import { logger } from "../../core/logger";
import type {
	CreateMrInput,
	GitHost,
	HostMember,
	HostUser,
} from "../../ports/git-host";

export interface GlabExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export type GlabExec = (args: string[]) => Promise<GlabExecResult>;

async function defaultGlabExec(args: string[]): Promise<GlabExecResult> {
	const proc = Bun.spawn(["glab", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		stdout: await new Response(proc.stdout).text(),
		stderr: await new Response(proc.stderr).text(),
		exitCode: await proc.exited,
	};
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
			if (urlMatch) {
				return { url: urlMatch[1]! };
			}
		}

		return null;
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

		const urlMatch = result.stdout.match(/(https?:\/\/[^\s]+)/);
		if (!urlMatch) {
			throw new PortError(
				"MR created but no URL found in output",
				result.stdout,
			);
		}

		return { url: urlMatch[1]! };
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
				return members.length > 0 ? members[0]! : null;
			}

			let body: unknown;
			try {
				body = JSON.parse(result.stdout);
			} catch (error) {
				logger.warn("glab.resolve-group.invalid-json", { handle, page, error });
				return members.length > 0 ? members[0]! : null;
			}
			if (!Array.isArray(body)) {
				logger.warn("glab.resolve-group.unexpected-response", {
					handle,
					page,
					responseType: typeof body,
				});
				return members.length > 0 ? members[0]! : null;
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

		return {
			id: members[0]!.id,
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

	async _exec(args: string[]): Promise<GlabExecResult> {
		return this.execFn(args);
	}
}
