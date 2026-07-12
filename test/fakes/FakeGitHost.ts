import type {
	CreateMrInput,
	GitHost,
	HostMember,
	HostUser,
} from "../../src/ports/git-host";

export class FakeGitHost implements GitHost {
	async preflight(): Promise<void> {}

	async currentUser(): Promise<HostUser | null> {
		return null;
	}

	async findOpenMr(_sourceBranch: string): Promise<{ url: string } | null> {
		return null;
	}

	async resolveHandle(_handle: string): Promise<HostMember | null> {
		return null;
	}

	async createMr(_input: CreateMrInput): Promise<{ url: string }> {
		return { url: "https://example.com/mr/1" };
	}
}
