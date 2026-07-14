import type { CommitMeta, FileDiff, LogQuery, Vcs, WorktreeInfo } from "../../src/ports/vcs";

export interface FakeVcsOptions {
	branch?: string;
	defaultBranch?: string;
	staged?: boolean;
	diff?: FileDiff[];
	commitError?: Error;
	pushError?: Error;
	commitsAhead?: CommitMeta[];
	rangeDiff?: FileDiff[];
	log?: CommitMeta[];
	upstream?: boolean;
	ahead?: boolean;
	mergeBaseDiff?: FileDiff[];
	worktrees?: WorktreeInfo[];
	removeWorktreeError?: Error;
	forceRemoveWorktreeError?: Error;
	showWorktreeStatusOutput?: string;
}

export class FakeVcs implements Vcs {
	committedMessages: string[] = [];
	pushCalls: { setUpstream: boolean; branch: string }[] = [];
	worktreeCalls: { path: string; repoRoot: string }[] = [];
	forceWorktreeCalls: { path: string; repoRoot: string }[] = [];

	constructor(private readonly opts: FakeVcsOptions = {}) {}

	async currentBranch(): Promise<string> {
		return this.opts.branch ?? "feature/x";
	}

	async defaultBranch(): Promise<string> {
		return this.opts.defaultBranch ?? "main";
	}

	async hasStagedChanges(): Promise<boolean> {
		return this.opts.staged ?? true;
	}

	async stagedDiff(): Promise<FileDiff[]> {
		return this.opts.diff ?? [];
	}

	async commit(message: string): Promise<{ sha: string }> {
		if (this.opts.commitError) throw this.opts.commitError;
		this.committedMessages.push(message);
		return { sha: "fakesha" };
	}

	async push(opts: { setUpstream: boolean; branch: string }): Promise<void> {
		if (this.opts.pushError) throw this.opts.pushError;
		this.pushCalls.push(opts);
	}

	async commitsAhead(_base: string): Promise<CommitMeta[]> {
		return this.opts.commitsAhead ?? [];
	}

	async hasUnstagedChanges(): Promise<boolean> {
		return false;
	}

	async hasUpstream(_branch: string): Promise<boolean> {
		return this.opts.upstream ?? true;
	}

	async isAheadOfUpstream(_branch: string): Promise<boolean> {
		return this.opts.ahead ?? false;
	}

	async mergeBaseDiff(_base: string): Promise<FileDiff[]> {
		return this.opts.mergeBaseDiff ?? this.opts.rangeDiff ?? [];
	}

	async changedFiles(_base: string): Promise<string[]> {
		return [];
	}

	async touchAuthorsForFiles(_files: string[]): Promise<never[]> {
		return [];
	}

	async recentAuthors(_maxCount?: number): Promise<string[]> {
		return [];
	}

	async repoRoot(): Promise<string> {
		return "/tmp/fake-repo";
	}

	async rangeDiff(_base: string): Promise<FileDiff[]> {
		return this.opts.rangeDiff ?? [];
	}

	async log(_opts: LogQuery): Promise<CommitMeta[]> {
		return this.opts.log ?? [];
	}

	async worktrees(_repoRoot: string): Promise<WorktreeInfo[]> {
		return this.opts.worktrees ?? [];
	}

	async removeWorktree(path: string, repoRoot: string): Promise<void> {
		this.worktreeCalls.push({ path, repoRoot });
		if (this.opts.removeWorktreeError) throw this.opts.removeWorktreeError;
	}

	async forceRemoveWorktree(path: string, repoRoot: string): Promise<void> {
		this.forceWorktreeCalls.push({ path, repoRoot });
		if (this.opts.forceRemoveWorktreeError) throw this.opts.forceRemoveWorktreeError;
	}

	async showWorktreeStatus(_repoRoot: string, _worktreePath: string): Promise<string> {
		return this.opts.showWorktreeStatusOutput ?? "/fake/repo/wt: clean";
	}
}
