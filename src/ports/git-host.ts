import type { ParsedFileDiff } from "../shared/diff-parse";
import type { GitLabPositionPayload } from "../shared/gitlab-position";
import type { MrRef } from "../shared/mr-url";

export type {
	GitLabLineRangeEntry,
	GitLabPositionPayload,
} from "../shared/gitlab-position";
export interface HostUser {
	id: string;
	handle: string;
	displayName?: string;
}

export interface HostMember {
	id: string;
	handle: string;
	displayName?: string;
	kind: "user" | "group";
}

export interface CreateMrInput {
	sourceBranch: string;
	title: string;
	description: string;
	draft: boolean;
	assignee?: string;
	reviewers: string[];
}

export interface DiffRefs {
	baseSha: string;
	startSha: string;
	headSha: string;
}

export interface MrDetail {
	iid: number;
	projectPath: string;
	title: string;
	description: string;
	webUrl: string;
	author: string;
	sourceBranch: string;
	targetBranch: string;
	headSha: string;
	diffRefs: DiffRefs;
	state: string;
}

export interface HostApprovalRule {
	name: string;
	approvalsRequired: number;
	approvalsLeft: number;
	approvedBy: string[];
}

export interface MrApprovalState {
	approved: boolean;
	currentUser: string | null;
	approvalsLeft: number | null;
	approvedBy: string[];
	rules: HostApprovalRule[];
}

export interface HostNote {
	id: string;
	author: string;
	body: string;
	createdAt: string;
	system: boolean;
}

export interface DiscussionPosition {
	newPath: string | null;
	oldPath: string | null;
	newLine: number | null;
	oldLine: number | null;
}

export interface HostDiscussion {
	id: string;
	resolved: boolean;
	notes: HostNote[];
	position: DiscussionPosition | null;
}

export interface UnpositionedCreateDiscussionInput {
	ref: MrRef;
	body: string;
	position?: never;
	parsedDiff?: never;
	diffRefs?: never;
}

export interface PositionedCreateDiscussionInput {
	ref: MrRef;
	body: string;
	position: GitLabPositionPayload;
	parsedDiff: ParsedFileDiff;
	diffRefs: DiffRefs;
}

export type CreateDiscussionInput =
	| UnpositionedCreateDiscussionInput
	| PositionedCreateDiscussionInput;

export interface GitHost {
	preflight(): Promise<void>;
	currentUser(): Promise<HostUser | null>;
	findOpenMr(sourceBranch: string): Promise<{ url: string } | null>;
	resolveHandle(handle: string): Promise<HostMember | null>;
	createMr(input: CreateMrInput): Promise<{ url: string }>;
	fetchMr(ref: MrRef): Promise<MrDetail>;
	listDiscussions(ref: MrRef): Promise<HostDiscussion[]>;
	createDiscussion(input: CreateDiscussionInput): Promise<HostDiscussion>;
	fetchApprovalState(ref: MrRef): Promise<MrApprovalState>;
	approveMr(ref: MrRef): Promise<MrApprovalState>;
	unapproveMr(ref: MrRef): Promise<MrApprovalState>;
}
