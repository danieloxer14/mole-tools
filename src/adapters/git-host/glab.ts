import { CostTracker } from "../../core/cost-tracker";
import { PortError } from "../../core/errors";
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
	private readonly execFn: GlabExec;
	private readonly _costTracker: CostTracker;

	/** Accept a tracker for production use, or an executor plus tracker for tests. */
	constructor(costTracker?: CostTracker);
	constructor(execFn: GlabExec, costTracker?: CostTracker);
	constructor(
		execOrTracker: GlabExec | CostTracker = defaultGlabExec,
		costTracker = new CostTracker(),
	) {
		if (typeof execOrTracker === "function") {
			this.execFn = execOrTracker;
			this._costTracker = costTracker;
		} else {
			this.execFn = defaultGlabExec;
			this._costTracker = execOrTracker;
		}
	}

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
				return { url: urlMatch[1] };
			}
		}

		return null;
	}

	async resolveHandle(handle: string): Promise<HostMember | null> {
		if (handle.includes("/")) {
			return this.resolveGroup(handle);
		}
		return this.resolveUser(handle);
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

		return { url: urlMatch[1] };
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
				return members.length > 0 ? members[0] : null;
			}

			let body: unknown;
			try {
				body = JSON.parse(result.stdout);
			} catch {
				return members.length > 0 ? members[0] : null;
			}
			if (!Array.isArray(body)) {
				return members.length > 0 ? members[0] : null;
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

		if (members.length === 0) return null;

		return {
			id: members[0].id,
			handle: handle,
			kind: "group",
		};
	}

	async resolveUser(handle: string): Promise<HostMember | null> {
		const result = await this._exec([
			"api",
			"/users",
			`?username=${encodeURIComponent(handle)}`,
		]);
		if (result.exitCode !== 0 || !result.stdout.trim()) {
			return null;
		}

		let body: unknown;
		try {
			body = JSON.parse(result.stdout);
		} catch {
			return null;
		}
		if (!Array.isArray(body) || body.length === 0) {
			return null;
		}

		const user = body[0] as Record<string, unknown>;
		return {
			id: String(user.id ?? ""),
			handle: String(user.username ?? handle),
			displayName: String(user.name ?? user.username ?? handle),
			kind: "user",
		};
	}

	async _exec(args: string[]): Promise<GlabExecResult> {
		const result = await this.execFn(args);
		this._costTracker.record({
			type: "git-host",
			task: args[0] ?? "glab",
			inputTokens: 0,
			outputTokens: 0,
		});
		return result;
	}
}
