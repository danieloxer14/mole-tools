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
