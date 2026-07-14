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
	maxCount?: number;
}

export interface TouchAuthor {
	author: string;
	count: number;
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
	hasUnstagedChanges(): Promise<boolean>;
	hasUpstream(branch: string): Promise<boolean>;
	isAheadOfUpstream(branch: string): Promise<boolean>;
	changedFiles(base: string): Promise<string[]>;
	touchAuthorsForFiles(files: string[], maxCount?: number): Promise<TouchAuthor[]>;
	recentAuthors(maxCount?: number): Promise<string[]>;
	repoRoot(): Promise<string>;
	log(opts: LogQuery): Promise<CommitMeta[]>;
	worktrees(repoRoot: string): Promise<WorktreeInfo[]>;
	removeWorktree(path: string, repoRoot: string): Promise<void>;
	forceRemoveWorktree(path: string, repoRoot: string): Promise<void>;
	showWorktreeStatus(repoRoot: string, worktreePath: string): Promise<string>;
}
