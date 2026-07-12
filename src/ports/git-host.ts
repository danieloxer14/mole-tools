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

export interface GitHost {
	preflight(): Promise<void>;
	currentUser(): Promise<HostUser | null>;
	findOpenMr(sourceBranch: string): Promise<{ url: string } | null>;
	resolveHandle(handle: string): Promise<HostMember | null>;
	createMr(input: CreateMrInput): Promise<{ url: string }>;
}
