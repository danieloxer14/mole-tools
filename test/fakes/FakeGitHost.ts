import type {
	CreateMrInput,
	GitHost,
	HostMember,
	HostUser,
} from "../../src/ports/git-host";

export interface FakeGitHostOptions {
	preflight?: () => Promise<void>;
	currentUser?: () => Promise<HostUser | null>;
	findOpenMr?: (sourceBranch: string) => Promise<{ url: string } | null>;
	resolveHandle?: (handle: string) => Promise<HostMember | null>;
	createMr?: (input: CreateMrInput) => Promise<{ url: string }>;
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
}
