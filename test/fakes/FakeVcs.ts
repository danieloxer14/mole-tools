import type {
	AddWorktreeInput,
	CommitMeta,
	FileDiff,
	LogQuery,
	TouchAuthor,
	Vcs,
	WorktreeInfo,
} from "../../src/ports/vcs";
export interface FakeVcsOptions {
	branch?: string;
	defaultBranch?: string;
	repoRoot?: string;
	remoteUrl?: string | null;
	staged?: boolean;
	diff?: FileDiff[];
	commitError?: Error;
	pushError?: Error;
	cloneError?: Error;
	fetchError?: Error;
	mergeBaseError?: Error;
	addWorktreeError?: Error;
	diffRangeError?: Error;
	commitsAhead?: CommitMeta[];
	rangeDiff?: FileDiff[];
	diffRange?: FileDiff[];
	log?: CommitMeta[];
	touchAuthors?: TouchAuthor[];
	recentAuthors?: string[];
	upstream?: boolean;
	ahead?: boolean;
	mergeBaseDiff?: FileDiff[];
	mergeBase?: string;
	worktrees?: WorktreeInfo[];
	removeWorktreeError?: Error;
	showWorktreeStatusOutput?: string;
}

export class FakeVcs implements Vcs {
	committedMessages: string[] = [];
	pushCalls: { setUpstream: boolean; branch: string }[] = [];
	worktreeCalls: { path: string; repoRoot: string }[] = [];
	forceWorktreeCalls: { path: string; repoRoot: string }[] = [];
	removeWorktreeCalls: { path: string; repoRoot: string }[] = [];
	cloneCalls: { remoteUrl: string; destination: string }[] = [];
	fetchRefCalls: { repoRoot: string; remote: string; ref: string }[] = [];
	mergeBaseCalls: { repoRoot: string; a: string; b: string }[] = [];
	addWorktreeCalls: AddWorktreeInput[] = [];
	diffRangeCalls: { repoRoot: string; from: string; to: string }[] = [];
	remoteUrlCalls: { repoRoot: string; remote: string }[] = [];
	repoRootCalls: string[] = [];
	logCalls: LogQuery[] = [];
	touchAuthorCalls: { files: string[]; maxCount?: number }[] = [];
	recentAuthorCalls: (number | undefined)[] = [];

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

	async touchAuthorsForFiles(
		files: string[],
		maxCount?: number,
	): Promise<TouchAuthor[]> {
		this.touchAuthorCalls.push({ files, maxCount });
		return this.opts.touchAuthors ?? [];
	}

	async recentAuthors(maxCount?: number): Promise<string[]> {
		this.recentAuthorCalls.push(maxCount);
		return this.opts.recentAuthors ?? [];
	}

	async repoRoot(): Promise<string> {
		const root = this.opts.repoRoot ?? "/tmp/fake-repo";
		this.repoRootCalls.push(root);
		return root;
	}

	async cloneRepo(remoteUrl: string, destination: string): Promise<void> {
		this.cloneCalls.push({ remoteUrl, destination });
		if (this.opts.cloneError) throw this.opts.cloneError;
	}

	async fetchRef(repoRoot: string, remote: string, ref: string): Promise<void> {
		this.fetchRefCalls.push({ repoRoot, remote, ref });
		if (this.opts.fetchError) throw this.opts.fetchError;
	}

	async mergeBase(repoRoot: string, a: string, b: string): Promise<string> {
		this.mergeBaseCalls.push({ repoRoot, a, b });
		if (this.opts.mergeBaseError) throw this.opts.mergeBaseError;
		return this.opts.mergeBase ?? "fake-merge-base";
	}

	async addWorktree(input: AddWorktreeInput): Promise<void> {
		this.addWorktreeCalls.push(input);
		if (this.opts.addWorktreeError) throw this.opts.addWorktreeError;
	}

	async diffRange(
		repoRoot: string,
		from: string,
		to: string,
	): Promise<FileDiff[]> {
		this.diffRangeCalls.push({ repoRoot, from, to });
		if (this.opts.diffRangeError) throw this.opts.diffRangeError;
		return this.opts.diffRange ?? this.opts.rangeDiff ?? [];
	}

	async remoteUrl(repoRoot: string, remote: string): Promise<string | null> {
		this.remoteUrlCalls.push({ repoRoot, remote });
		return this.opts.remoteUrl ?? null;
	}

	async rangeDiff(_base: string): Promise<FileDiff[]> {
		return this.opts.rangeDiff ?? [];
	}

	async log(opts: LogQuery): Promise<CommitMeta[]> {
		this.logCalls.push(opts);
		return this.opts.log ?? [];
	}

	async worktrees(_repoRoot: string): Promise<WorktreeInfo[]> {
		return this.opts.worktrees ?? [];
	}

	async removeWorktree(path: string, repoRoot: string): Promise<void> {
		this.removeWorktreeCalls.push({ path, repoRoot });
		this.worktreeCalls.push({ path, repoRoot });
		if (this.opts.removeWorktreeError) throw this.opts.removeWorktreeError;
	}

	async forceRemoveWorktree(path: string, repoRoot: string): Promise<void> {
		this.forceWorktreeCalls.push({ path, repoRoot });
	}

	async showWorktreeStatus(
		_repoRoot: string,
		_worktreePath: string,
	): Promise<string> {
		return this.opts.showWorktreeStatusOutput ?? "/fake/repo/wt: clean";
	}
}
