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

export interface Vcs {
	currentBranch(): Promise<string>;
	defaultBranch(): Promise<string>;
	hasStagedChanges(): Promise<boolean>;
	stagedDiff(): Promise<FileDiff[]>;
	commit(message: string): Promise<{ sha: string }>;
	push(opts: { setUpstream: boolean; branch: string }): Promise<void>;
	commitsAhead(base: string): Promise<CommitMeta[]>;
	rangeDiff(base: string): Promise<FileDiff[]>;
	log(opts: LogQuery): Promise<CommitMeta[]>;
}
