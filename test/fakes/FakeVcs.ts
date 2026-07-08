import type { CommitMeta, FileDiff, LogQuery, Vcs } from "../../src/ports/vcs";

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
}

export class FakeVcs implements Vcs {
	committedMessages: string[] = [];
	pushCalls: { setUpstream: boolean; branch: string }[] = [];

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

	async rangeDiff(_base: string): Promise<FileDiff[]> {
		return this.opts.rangeDiff ?? [];
	}

	async log(_opts: LogQuery): Promise<CommitMeta[]> {
		return this.opts.log ?? [];
	}
}
