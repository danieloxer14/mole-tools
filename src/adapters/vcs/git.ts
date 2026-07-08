import { PortError } from "../../core/errors";
import type { CommitMeta, FileDiff, LogQuery, Vcs } from "../../ports/vcs";

export interface GitExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export type GitExec = (
	args: string[],
	input?: string,
) => Promise<GitExecResult>;

async function defaultExec(
	args: string[],
	input?: string,
): Promise<GitExecResult> {
	const proc = Bun.spawn(["git", ...args], {
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

const SEP = "\x1f";

function parseNumstat(
	text: string,
): Map<string, { insertions: number; deletions: number }> {
	const map = new Map<string, { insertions: number; deletions: number }>();
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		const [insertions, deletions, path] = line.split("\t");
		if (!path) continue;
		map.set(path, {
			insertions: Number(insertions) || 0,
			deletions: Number(deletions) || 0,
		});
	}
	return map;
}

function parseUnifiedDiff(text: string): Map<string, string> {
	const map = new Map<string, string>();
	const parts = text.split(/^diff --git a\/(.+?) b\/.+$/m);
	for (let i = 1; i < parts.length; i += 2) {
		const path = parts[i];
		const body = parts[i + 1];
		if (path && body !== undefined)
			map.set(path, `diff --git a/${path} b/${path}${body}`.trimEnd());
	}
	return map;
}

export class GitAdapter implements Vcs {
	constructor(private readonly exec: GitExec = defaultExec) {}

	private async run(args: string[], input?: string): Promise<string> {
		const result = await this.exec(args, input);
		if (result.exitCode !== 0) {
			throw new PortError(
				`git ${args.join(" ")} failed`,
				result.stderr,
				result.exitCode,
			);
		}
		return result.stdout;
	}

	async currentBranch(): Promise<string> {
		return (await this.run(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
	}

	async defaultBranch(): Promise<string> {
		const result = await this.exec([
			"symbolic-ref",
			"refs/remotes/origin/HEAD",
		]);
		if (result.exitCode !== 0) return "main";
		return result.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
	}

	async hasStagedChanges(): Promise<boolean> {
		const result = await this.exec(["diff", "--staged", "--quiet"]);
		return result.exitCode === 1;
	}

	async stagedDiff(): Promise<FileDiff[]> {
		return this.diffBetween(["--staged"]);
	}

	async rangeDiff(base: string): Promise<FileDiff[]> {
		return this.diffBetween([`${base}..HEAD`]);
	}

	private async diffBetween(range: string[]): Promise<FileDiff[]> {
		const [numstat, patch] = await Promise.all([
			this.run(["diff", ...range, "--numstat"]),
			this.run(["diff", ...range]),
		]);
		const stats = parseNumstat(numstat);
		const patches = parseUnifiedDiff(patch);
		return [...stats.entries()].map(([path, stat]) => ({
			path,
			statOnly: false,
			patch: patches.get(path) ?? null,
			insertions: stat.insertions,
			deletions: stat.deletions,
		}));
	}

	async commit(message: string): Promise<{ sha: string }> {
		await this.run(["commit", "--file", "-"], message);
		const sha = (await this.run(["rev-parse", "HEAD"])).trim();
		return { sha };
	}

	async push(opts: { setUpstream: boolean; branch: string }): Promise<void> {
		if (opts.setUpstream) {
			await this.run(["push", "-u", "origin", opts.branch]);
		} else {
			await this.run(["push"]);
		}
	}

	async commitsAhead(base: string): Promise<CommitMeta[]> {
		const out = await this.run([
			"log",
			`${base}..HEAD`,
			`--pretty=format:%H${SEP}%s${SEP}%an${SEP}%aI`,
		]);
		return parseCommitLog(out);
	}

	async log(opts: LogQuery): Promise<CommitMeta[]> {
		const args = ["log", `--pretty=format:%H${SEP}%s${SEP}%an${SEP}%aI`];
		if (opts.maxCount) args.push(`-n${opts.maxCount}`);
		if (opts.base) args.push(`${opts.base}..HEAD`);
		return parseCommitLog(await this.run(args));
	}
}

function parseCommitLog(text: string): CommitMeta[] {
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => {
			const [sha, subject, author, date] = line.split(SEP);
			return {
				sha: sha ?? "",
				subject: subject ?? "",
				author: author ?? "",
				date: date ?? "",
			};
		});
}
