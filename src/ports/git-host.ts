import type { ParsedFileDiff } from "../shared/diff-parse";
import type { DiffLineSelection } from "../shared/diff-selection";
import type { MrRef } from "../shared/mr-url";

export type GitHostProvider = "gitlab" | "github";
export type GitHostTarget =
	| { provider: "gitlab" }
	| { provider: "github"; host: string };

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
	provider: GitHostProvider;
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

export interface WatchedMrRef {
	ref: MrRef;
	assignees: string[];
}

export interface MrAutoApprovalState {
	mr: MrDetail;
	draft: boolean;
	labels: string[];
	detailedMergeStatus: string | null;
	hasConflicts: boolean;
	headPipelineStatus: string | null;
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
	/** Standalone conversation note (GitLab individual_note, GitHub issue comment or review summary); not a resolvable thread and must not block approval. */
	individualNote?: boolean;
	notes: HostNote[];
	position: DiscussionPosition | null;
}

export interface UnpositionedCreateDiscussionInput {
	ref: MrRef;
	body: string;
	selection?: never;
	parsedDiff?: never;
	diffRefs?: never;
}

export interface PositionedCreateDiscussionInput {
	ref: MrRef;
	body: string;
	selection: DiffLineSelection;
	parsedDiff: ParsedFileDiff;
	diffRefs: DiffRefs;
}

export type CreateDiscussionInput =
	| UnpositionedCreateDiscussionInput
	| PositionedCreateDiscussionInput;

export interface GitHost {
	preflight(): Promise<void>;
	/** GitLab-only: token for authenticated GitLab description-media fetches. */
	getGitLabAuthToken?(hostname: string): Promise<string | null>;
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

/** GitLab-only operations used by review-babysitter. */
export interface GitLabAutomationHost extends GitHost {
	listOpenedMrsForAssignees(
		assignees: readonly string[],
	): Promise<WatchedMrRef[]>;
	fetchAutoApprovalState(ref: MrRef): Promise<MrAutoApprovalState>;
	addMrLabel(ref: MrRef, label: string): Promise<void>;
}
