export interface WorktreeInfo {
	path: string;
	ref: string;
}

export interface FileDiff {
	path: string;
	statOnly: boolean;
	patch: string | null;
	insertions: number;
	deletions: number;
}

export interface CommitMeta {
	sha: string;
	subject: string;
	author: string;
	date: string;
}

export interface LogQuery {
	base?: string;
	/** Explicit revision to end the log range at. Defaults to HEAD. */
	head?: string;
	/** Directory whose checkout should provide the commit context. */
	cwd?: string;
	maxCount?: number;
}

export interface TouchAuthor {
	author: string;
	count: number;
}
export interface AddWorktreeInput {
	repoRoot: string;
	path: string;
	sha: string;
}

export interface Vcs {
	currentBranch(): Promise<string>;
	defaultBranch(): Promise<string>;
	hasStagedChanges(): Promise<boolean>;
	stagedDiff(): Promise<FileDiff[]>;
	commit(message: string): Promise<{ sha: string }>;
	push(opts: { setUpstream: boolean; branch: string }): Promise<void>;
	commitsAhead(base: string): Promise<CommitMeta[]>;
	rangeDiff(base: string): Promise<FileDiff[]>;
	mergeBaseDiff(base: string): Promise<FileDiff[]>;
	hasUpstream(branch: string): Promise<boolean>;
	isAheadOfUpstream(branch: string): Promise<boolean>;
	changedFiles(base: string): Promise<string[]>;
	touchAuthorsForFiles(
		files: string[],
		maxCount?: number,
	): Promise<TouchAuthor[]>;
	recentAuthors(maxCount?: number): Promise<string[]>;
	repoRoot(): Promise<string>;
	log(opts: LogQuery): Promise<CommitMeta[]>;
	cloneRepo(remoteUrl: string, destination: string): Promise<void>;
	fetchRef(repoRoot: string, remote: string, ref: string): Promise<void>;
	mergeBase(repoRoot: string, a: string, b: string): Promise<string>;
	addWorktree(input: AddWorktreeInput): Promise<void>;
	diffRange(repoRoot: string, from: string, to: string): Promise<FileDiff[]>;
	remoteUrl(repoRoot: string, remote: string): Promise<string | null>;
	/** Read a path from a git revision when its worktree-side copy is absent. */
	readFileAtRevision?(
		repoRoot: string,
		revision: string,
		path: string,
	): Promise<string | null>;
	worktrees(repoRoot: string): Promise<WorktreeInfo[]>;
	removeWorktree(path: string, repoRoot: string): Promise<void>;
	forceRemoveWorktree(path: string, repoRoot: string): Promise<void>;
	showWorktreeStatus(repoRoot: string, worktreePath: string): Promise<string>;
}
