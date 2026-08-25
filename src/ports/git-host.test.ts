import { expect, test } from "bun:test";
import type { CreateMrInput, GitHost, HostMember, HostUser } from "./git-host";

test("GitHost exposes merge-request creation and discovery contract", async () => {
	const input: CreateMrInput = {
		sourceBranch: "feature",
		title: "Fix bug",
		description: "Body",
		draft: false,
		reviewers: ["alice"],
	};
	const calls: string[] = [];
	const host: GitHost = {
		preflight: async () => {
			calls.push("preflight");
		},
		currentUser: async (): Promise<HostUser | null> => ({
			id: "1",
			handle: "alice",
		}),
		findOpenMr: async () => ({ url: "https://example.test/mr/1" }),
		resolveHandle: async (): Promise<HostMember | null> => ({
			id: "2",
			handle: "bob",
			kind: "user",
		}),
		createMr: async (received) => {
			calls.push("createMr");
			expect(received).toEqual(input);
			return { url: "https://example.test/mr/1" };
		},
		fetchMr: async (ref) => ({
			iid: ref.iid,
			projectPath: ref.projectPath,
			title: "Fix bug",
			description: "Body",
			webUrl: "https://example.test/mr/1",
			author: "alice",
			sourceBranch: "feature",
			targetBranch: "main",
			headSha: "head",
			diffRefs: {
				baseSha: "base",
				startSha: "start",
				headSha: "head",
			},
			state: "opened",
		}),
		listDiscussions: async () => [],
		createDiscussion: async () => ({
			id: "discussion",
			resolved: false,
			notes: [],
			position: null,
		}),
		fetchApprovalState: async () => ({
			approved: true,
			currentUser: "alice",
			approvalsLeft: 0,
			approvedBy: ["alice"],
			rules: [],
		}),
		approveMr: async () => ({
			approved: true,
			currentUser: "alice",
			approvalsLeft: 0,
			approvedBy: ["alice"],
			rules: [],
		}),
		unapproveMr: async () => ({
			approved: false,
			currentUser: "alice",
			approvalsLeft: 1,
			approvedBy: [],
			rules: [],
		}),
	};

	await host.preflight();
	expect(await host.currentUser()).toEqual({ id: "1", handle: "alice" });
	expect(await host.findOpenMr("feature")).toEqual({
		url: "https://example.test/mr/1",
	});
	expect(await host.resolveHandle("bob")).toEqual({
		id: "2",
		handle: "bob",
		kind: "user",
	});
	expect(await host.createMr(input)).toEqual({
		url: "https://example.test/mr/1",
	});
	expect(calls).toEqual(["preflight", "createMr"]);
});
