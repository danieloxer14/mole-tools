import type {
	CreateDiscussionInput,
	CreateMrInput,
	GitHost,
	HostDiscussion,
	HostMember,
	HostUser,
	MrApprovalState,
	MrDetail,
} from "../../src/ports/git-host";
import type { MrRef } from "../../src/shared/mr-url";

export interface FakeGitHostOptions {
	preflight?: () => Promise<void>;
	currentUser?: () => Promise<HostUser | null>;
	findOpenMr?: (sourceBranch: string) => Promise<{ url: string } | null>;
	resolveHandle?: (handle: string) => Promise<HostMember | null>;
	createMr?: (input: CreateMrInput) => Promise<{ url: string }>;
	listDiscussions?: (ref: MrRef) => Promise<HostDiscussion[]>;
	fetchMr?: (ref: MrRef) => Promise<MrDetail>;
	createDiscussion?: (input: CreateDiscussionInput) => Promise<HostDiscussion>;
	fetchApprovalState?: (ref: MrRef) => Promise<MrApprovalState>;
	approveMr?: (ref: MrRef) => Promise<MrApprovalState>;
	unapproveMr?: (ref: MrRef) => Promise<MrApprovalState>;
}

export class FakeGitHost implements GitHost {
	constructor(private readonly options: FakeGitHostOptions = {}) {}

	async preflight(): Promise<void> {
		await this.options.preflight?.();
	}

	async currentUser(): Promise<HostUser | null> {
		return (await this.options.currentUser?.()) ?? null;
	}

	async findOpenMr(sourceBranch: string): Promise<{ url: string } | null> {
		return (await this.options.findOpenMr?.(sourceBranch)) ?? null;
	}

	async resolveHandle(_handle: string): Promise<HostMember | null> {
		return (await this.options.resolveHandle?.(_handle)) ?? null;
	}

	async createMr(_input: CreateMrInput): Promise<{ url: string }> {
		return (
			(await this.options.createMr?.(_input)) ?? {
				url: "https://example.com/mr/1",
			}
		);
	}

	async fetchMr(ref: MrRef): Promise<MrDetail> {
		return (
			(await this.options.fetchMr?.(ref)) ?? {
				iid: ref.iid,
				projectPath: ref.projectPath,
				title: "",
				description: "",
				webUrl: `https://${ref.host}/${ref.projectPath}/-/merge_requests/${ref.iid}`,
				author: "",
				sourceBranch: "",
				targetBranch: "",
				headSha: "",
				diffRefs: { baseSha: "", startSha: "", headSha: "" },
				state: "opened",
			}
		);
	}

	async listDiscussions(ref: MrRef): Promise<HostDiscussion[]> {
		return (await this.options.listDiscussions?.(ref)) ?? [];
	}

	async createDiscussion(
		input: CreateDiscussionInput,
	): Promise<HostDiscussion> {
		return (
			(await this.options.createDiscussion?.(input)) ?? {
				id: "fake-discussion",
				resolved: false,
				notes: [],
				position: null,
			}
		);
	}

	async fetchApprovalState(ref: MrRef): Promise<MrApprovalState> {
		return (
			(await this.options.fetchApprovalState?.(ref)) ?? {
				approved: false,
				currentUser: null,
				approvalsLeft: null,
				approvedBy: [],
				rules: [],
			}
		);
	}

	async approveMr(ref: MrRef): Promise<MrApprovalState> {
		return this.options.approveMr
			? this.options.approveMr(ref)
			: this.fetchApprovalState(ref);
	}

	async unapproveMr(ref: MrRef): Promise<MrApprovalState> {
		return this.options.unapproveMr
			? this.options.unapproveMr(ref)
			: this.fetchApprovalState(ref);
	}
}
