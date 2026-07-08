export interface HostUser {
	id: string;
	handle: string;
}

export interface HostMember {
	id: string;
	handle: string;
	kind: "user" | "group";
}

export interface CreateMrInput {
	sourceBranch: string;
	targetBranch: string;
	title: string;
	description: string;
	draft: boolean;
	reviewerIds: string[];
}

export interface GitHost {
	currentUser(): Promise<HostUser | null>;
	findOpenMr(sourceBranch: string): Promise<{ url: string } | null>;
	resolveHandle(handle: string): Promise<HostMember | null>;
	createMr(input: CreateMrInput): Promise<{ url: string }>;
}
