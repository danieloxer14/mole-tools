import { CostTracker } from "../../core/cost-tracker";
import { PortError } from "../../core/errors";
import type {
	CommitMeta,
	FileDiff,
	LogQuery,
	TouchAuthor,
	Vcs,
	WorktreeInfo,
} from "../../ports/vcs";
import { estimateTokens } from "../../shared/text";

export interface GitExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export type GitExec = (
	args: string[],
	input?: string,
	cwd?: string,
) => Promise<GitExecResult>;

async function defaultExec(
	args: string[],
	input?: string,
	cwd?: string,
): Promise<GitExecResult> {
	const proc = Bun.spawn(["git", ...args], {
		stdin: input !== undefined ? "pipe" : undefined,
		stdout: "pipe",
		stderr: "pipe",
		cwd,
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

function parseWorktreePorcelain(text: string, repoRoot: string): WorktreeInfo[] {
	interface RawWt { path: string; ref: string; isMain: boolean; }
	const raw: RawWt[] = [];
	let current: RawWt | null = null;

	for (const line of text.split("\n")) {
		if (!line.trim()) {
			if (current) raw.push(current);
			current = null;
			continue;
				}

		if (line.startsWith("worktree ")) {
			if (current) raw.push(current);
			const path = line.slice("worktree ".length).trim();
			current = { path, ref: "", isMain: false };
			// Path-based heuristic: the main worktree lives at the repo root,
			// linked worktrees live under .git/worktrees/<name>/
			if (path === repoRoot) current.isMain = true;
			} else if (line === "bare" || line.startsWith("HEAD ") || line.startsWith("head ")) {
			continue;
			// Modern git uses "branch refs/heads/name"; older may use "symbolic ..."
			} else if ((line.startsWith("symbolic ") || line.startsWith("branch ")) && current) {
			const refPath = line.slice(line.indexOf(" ") + 1).trim();
			current.ref = refPath.replace(/^refs\/heads\//, "");
			} else if (line.startsWith("joint ") && current) {
			current.isMain = true;
			}
		}

	if (current) raw.push(current);

	return raw.filter((w) => !w.isMain).map((w) => ({ path: w.path, ref: w.ref }));
}

export class GitAdapter implements Vcs {
	private readonly _gitExec = this.execFn;
	constructor(
		private readonly execFn: GitExec = defaultExec,
		private readonly costTracker: CostTracker = new CostTracker(),
	) {}

	private async exec(args: string[], input?: string): Promise<GitExecResult> {
		const result = await this.execFn(args, input);
		this.costTracker.record({
			type: "git",
			task: args[0] ?? "git",
			inputTokens: estimateTokens(args.join(" ")),
			outputTokens: estimateTokens(result.stdout),
				});
		return result;
	}

	private async execIn(
		args: string[],
		cwd: string,
		input?: string,
	): Promise<GitExecResult> {
		const result = await this.execFn(args, input, cwd);
		this.costTracker.record({
			type: "git",
			task: args[0] ?? "git",
			inputTokens: estimateTokens(args.join(" ")),
			outputTokens: estimateTokens(result.stdout),
				});
		return result;
	}

	private async run(args: string[], input?: string): Promise<string> {
		const result = await this.exec(args, input);
		if (result.exitCode !== 0) {
			throw new PortError(
				result.stderr.trim() || `git ${args.join(" ")} failed`,
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
			return;
				}
		const result = await this.exec(["push"]);
		if (result.exitCode === 0) return;
		if (/has no upstream branch/i.test(result.stderr)) {
			await this.run(["push", "-u", "origin", opts.branch]);
			return;
				}
		throw new PortError(
			result.stderr.trim() || "git push failed",
			result.stderr,
			result.exitCode,
				);
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

	async worktrees(repoRoot: string): Promise<WorktreeInfo[]> {
		const result = await this.execIn(["worktree", "list", "--porcelain"], repoRoot);
		if (result.exitCode !== 0) return [];
		return parseWorktreePorcelain(result.stdout, repoRoot);
	}

	async removeWorktree(path: string, repoRoot: string): Promise<void> {
		const result = await this.execIn(["worktree", "remove", path], repoRoot);
		if (result.exitCode !== 0) {
			throw new PortError(
				result.stderr.trim() || `git worktree remove ${path} failed`,
				result.stderr,
				result.exitCode,
					);
				}
	}

	async forceRemoveWorktree(path: string, repoRoot: string): Promise<void> {
		const result = await this.execIn(["worktree", "remove", "--force", path], repoRoot);
		if (result.exitCode !== 0) {
			throw new PortError(
				result.stderr.trim() || `git worktree remove --force ${path} failed`,
				result.stderr,
				result.exitCode,
					);
				}
	}

	async showWorktreeStatus(repoRoot: string, worktreePath: string): Promise<string> {
		const [statusResult, diffStatResult] = await Promise.all([
			this.execIn(["status", "--short"], worktreePath),
			this.execIn(["diff", "--stat"], worktreePath),
				]);

		let output = `Worktree status for ${worktreePath}:\n\nStatus (short):\n`;
		if (statusResult.stdout.trim()) {
			output += statusResult.stdout;
				} else {
			output += "(clean working tree)\n";
				}

		output += "\nDiff stat:\n";
		if (diffStatResult.stdout.trim()) {
			output += diffStatResult.stdout;
				} else {
			output += "(no differences)\n";
				}

		return output;
	}

	async mergeBaseDiff(base: string): Promise<FileDiff[]> {
		return this.diffBetween([`origin/${base}...HEAD`]);
	}

	async hasUnstagedChanges(): Promise<boolean> {
		const result = await this.exec(["diff", "--quiet"]);
		return result.exitCode === 1;
	}

	async hasUpstream(branch: string): Promise<boolean> {
		const result = await this.exec([
			"rev-parse",
			"--abbrev-ref",
			`${branch}@{upstream}`,
		]);
		return result.exitCode === 0;
	}

	async isAheadOfUpstream(branch: string): Promise<boolean> {
		if (!(await this.hasUpstream(branch))) return false;
		const count = (await this.run(["rev-list", "--count", "@{upstream}..HEAD"])).trim();
		return parseInt(count, 10) > 0;
	}

	async changedFiles(base: string): Promise<string[]> {
		const result = await this.exec([
			"diff",
			`origin/${base}...HEAD`,
			"--diff-filter=M",
			"--name-only",
		]);
		if (result.exitCode !== 0) return [];
		return result.stdout
			.split("\n")
			.map((f) => f.trim())
			.filter((f) => f.length > 0);
	}

	async touchAuthorsForFiles(
		files: string[],
		maxCount = 200,
	): Promise<TouchAuthor[]> {
		if (files.length === 0) return [];
		const result = await this.exec([
			"log",
			`-n${maxCount}`,
			"--name-only",
			`--pretty=format:%an${SEP}%H`,
			"--",
			...files,
		]);
		const fileSet = new Set(files);
		const authorCounts = new Map<string, number>();

		if (result.exitCode !== 0) return [];

		const blocks = result.stdout.split(/\n\n+/).filter(Boolean);
		for (const block of blocks) {
			const lines = block.split("\n");
			if (lines.length < 1) continue;
			const headerLine = lines[0];
			const parts = headerLine.split(SEP);
			if (parts.length < 2 && !fileSet.has(headerLine)) {
				continue;
			}
			// If no SEP, the whole line is a file name — not a commit header
			const [author] = parts;
			if (parts.length < 2 || !author) continue; // pure file line, skip
			const commitFiles = new Set(
				lines.slice(1).map((f) => f.trim()).filter((f) => fileSet.has(f)),
			);
			if (commitFiles.size > 0) {
				const existing = authorCounts.get(author) || 0;
				authorCounts.set(author, existing + commitFiles.size);
			}
		}

		return [...authorCounts.entries()]
			.map(([author, count]) => ({ author, count }))
			.sort((a, b) => b.count - a.count);
	}

	async recentAuthors(maxCount = 100): Promise<string[]> {
		const out = await this.run([
			"log",
			`-n${maxCount}`,
			"--format=%an",
		]);
		const seen = new Set<string>();
		const result: string[] = [];
		for (const line of out.split("\n")) {
			const author = line.trim();
			if (!author) continue;
			if (!seen.has(author)) {
				seen.add(author);
				result.push(author);
			}
		}
		return result;
	}

	async repoRoot(): Promise<string> {
		return (await this.run(["rev-parse", "--show-toplevel"])).trim();
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