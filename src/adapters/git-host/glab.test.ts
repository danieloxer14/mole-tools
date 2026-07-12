import { describe, expect, test } from "bun:test";
import { CostTracker } from "../../core/cost-tracker";
import type { PortError } from "../../core/errors";
import { GlabAdapter, type GlabExec, type GlabExecResult } from "./glab";

function ok(stdout: string): GlabExecResult {
	return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr: string, exitCode = 1): GlabExecResult {
	return { stdout: "", stderr, exitCode };
}

describe("GlabAdapter", () => {
	let calls: string[][];

	function makeGlab(script: Record<string, GlabExecResult>) {
		calls = [];
		const exec: GlabExec = async (args: string[]) => {
			calls.push(args);
			const key = args.join(" ");
			const result = script[key];
			if (!result) throw new Error(`unscripted glab call: ${key}`);
			return result;
		};
		return new GlabAdapter(exec, new CostTracker());
	}

	describe("preflight", () => {
		test("passes when glab is installed and authenticated", async () => {
			const glab = makeGlab({
				"--version": ok("glab 1.28.0\n"),
				"auth status": ok("Logged in to gitlab.com\n"),
			});
			await expect(glab.preflight()).resolves.toBeUndefined();
		});

		test("throws when glab version fails with stderr", async () => {
			const glab = makeGlab({
				"--version": fail("command not found: glab", 127),
			});
			await expect(glab.preflight()).rejects.toThrow("command not found: glab");
		});

		test("throws fallback when glab version fails with empty stderr", async () => {
			const glab = makeGlab({ "--version": fail("", 127) });
			await expect(glab.preflight()).rejects.toThrow("glab is not installed");
		});

		test("throws when glab is not authenticated", async () => {
			const glab = makeGlab({
				"--version": ok("glab 1.28.0\n"),
				"auth status": fail("not authenticated", 1),
			});
			await expect(glab.preflight()).rejects.toThrow("not authenticated");
		});

		test("preserves stderr on version failure", async () => {
			const glab = makeGlab({ "--version": fail("custom error", 1) });
			try {
				await glab.preflight();
			} catch (e) {
				expect((e as PortError).stderr).toBe("custom error");
			}
		});

		test("preserves stderr on auth failure", async () => {
			const glab = makeGlab({
				"--version": ok("glab 1.28.0\n"),
				"auth status": fail("auth failed detail", 1),
			});
			try {
				await glab.preflight();
			} catch (e) {
				expect((e as PortError).stderr).toBe("auth failed detail");
			}
		});
	});

	describe("currentUser", () => {
		test("returns user info from /user response", async () => {
			const glab = makeGlab({
				"api /user": ok(
					JSON.stringify({ id: 42, username: "alice", name: "Alice" }),
				),
			});
			const user = await glab.currentUser();
			expect(user).toEqual({ id: "42", handle: "alice", displayName: "Alice" });
		});

		test("returns null when /user request fails", async () => {
			const glab = makeGlab({ "api /user": fail("unauthorized", 401) });
			expect(await glab.currentUser()).toBeNull();
		});

		test("returns null when response is not valid JSON", async () => {
			const glab = makeGlab({ "api /user": ok("not json") });
			expect(await glab.currentUser()).toBeNull();
		});

		test("falls back to name field when username is missing", async () => {
			const glab = makeGlab({
				"api /user": ok(JSON.stringify({ id: 1, name: "bob" })),
			});
			expect(await glab.currentUser()).toEqual({ id: "1", handle: "bob", displayName: "bob" });
		});
	});

	describe("findOpenMr", () => {
		test("returns URL when open MR exists for source branch", async () => {
			const url = "https://gitlab.com/project/-/merge_requests/42";
			const glab = makeGlab({
				"mr list --source-branch feature": ok(`!42 Feature Branch - ${url}`),
			});
			expect(await glab.findOpenMr("feature")).toEqual({ url });
		});

		test("returns null when no open MR exists", async () => {
			const glab = makeGlab({ "mr list --source-branch feature": ok("") });
			expect(await glab.findOpenMr("feature")).toBeNull();
		});

		test("returns null on command failure", async () => {
			const glab = makeGlab({
				"mr list --source-branch feature": fail("not found", 1),
			});
			expect(await glab.findOpenMr("feature")).toBeNull();
		});

		test("extracts URL from first line of output", async () => {
			const url = "https://gitlab.com/project/-/merge_requests/7";
			const glab = makeGlab({
				"mr list --source-branch dev": ok(
					`!7 WIP - ${url}\n!8 Other - https://other`,
				),
			});
			expect(await glab.findOpenMr("dev")).toEqual({ url });
		});
	});

	describe("resolveHandle", () => {
		test("routes to resolveUser for non-slash handles", async () => {
			const glab = makeGlab({
				"api /users ?username=alice": ok(
					JSON.stringify([{ id: 5, username: "alice" }]),
				),
			});
			expect(await glab.resolveHandle("alice")).toEqual({
				id: "5",
				handle: "alice",
				displayName: "alice",
				kind: "user",
			});
		});

		test("routes to resolveGroup for slash-containing handles", async () => {
			const glab = makeGlab({
				"api /groups/front-end%2Fteam/members --per-page 100 --page 1": ok(
					JSON.stringify([
						{ id: 10, username: "member1" },
						{ id: 11, username: "member2" },
					]),
				),
			});
			const member = await glab.resolveHandle("front-end/team");
			expect(member).toEqual({
				id: "10",
				handle: "front-end/team",
				kind: "group",
			});
		});

		test("returns null for user not found", async () => {
			const glab = makeGlab({ "api /users ?username=nobody": fail("", 404) });
			expect(await glab.resolveHandle("nobody")).toBeNull();
		});

		test("returns null for user with empty response body", async () => {
			const glab = makeGlab({ "api /users ?username=ghost": ok("[]") });
			expect(await glab.resolveHandle("ghost")).toBeNull();
		});

		test("returns null for group handle with no members", async () => {
			const glab = makeGlab({
				"api /groups/empty%2Fteam/members --per-page 100 --page 1": ok("[]"),
			});
			expect(await glab.resolveHandle("empty/team")).toBeNull();
		});

		test("paginates group members when first page is full (100 results)", async () => {
			const page1Array = Array.from({ length: 100 }, (_, i) => ({
				id: i,
				username: `u${i}`,
			}));
			const glab = makeGlab({
				"api /groups/big%2Fteam/members --per-page 100 --page 1": ok(
					JSON.stringify(page1Array),
				),
				"api /groups/big%2Fteam/members --per-page 100 --page 2": ok(
					JSON.stringify([{ id: 100, username: "last" }]),
				),
			});
			const member = await glab.resolveHandle("big/team");
			expect(member).not.toBeNull();
			expect(member?.handle).toBe("big/team");
			const calledPage2 = calls.some(
				(c) => c.includes("--page") && c.includes("2"),
			);
			expect(calledPage2).toBe(true);
		});

		test("returns null when group API fails on first page", async () => {
			const glab = makeGlab({
				"api /groups/secret%2Forg/members --per-page 100 --page 1": fail(
					"forbidden",
					403,
				),
			});
			expect(await glab.resolveHandle("secret/org")).toBeNull();
		});

		test("returns first partial member when group has <100 results", async () => {
			const glab = makeGlab({
				"api /groups/partial%2Fgroup/members --per-page 100 --page 1": ok(
					JSON.stringify([{ id: 1, username: "m1" }]),
				),
			});
			expect(await glab.resolveHandle("partial/group")).toEqual({
				id: "1",
				handle: "partial/group",
				kind: "group",
			});
			expect(calls.length).toBe(1);
		});

		test("handles user handle with special chars", async () => {
			const glab = makeGlab({
				"api /users ?username=j.doe": ok(
					JSON.stringify([{ id: 9, username: "j.doe" }]),
				),
			});
			expect(await glab.resolveHandle("j.doe")).toEqual({
				id: "9",
				handle: "j.doe",
				displayName: "j.doe",
				kind: "user",
			});
		});

		test("handles group with encoded slashes properly", async () => {
			const glab = makeGlab({
				"api /groups/a%2Fb%2Fc/members --per-page 100 --page 1": ok(
					JSON.stringify([
						{ id: 7, username: "x" },
						{ id: 8, username: "y" },
					]),
				),
			});
			const member = await glab.resolveHandle("a/b/c");
			expect(member).toEqual({
				id: "7",
				handle: "a/b/c",
				kind: "group",
			});
			expect(calls.length).toBe(1);
		});
	});

	describe("createMr", () => {
		test("sends correct args including title, description, reviewers", async () => {
			const url = "https://gitlab.com/p/-/merge_requests/1";
			const glab = makeGlab({
				"mr create --source-branch feature --title Fix bug --description Body --reviewer alice --draft":
					ok(url),
			});
			const result = await glab.createMr({
				sourceBranch: "feature",
				title: "Fix bug",
				description: "Body",
				draft: true,
				reviewers: ["alice"],
			});
			expect(result).toEqual({ url });
		});

		test("includes assignee when provided", async () => {
			const glab = makeGlab({
				"mr create --source-branch feat --title T --description D --assignee self --reviewer b":
					ok("https://gitlab.com/p/-/merge_requests/2"),
			});
			await glab.createMr({
				sourceBranch: "feat",
				title: "T",
				description: "D",
				draft: false,
				assignee: "self",
				reviewers: ["b"],
			});
			expect(calls[0]).toContain("--assignee");
			expect(calls[0]).toContain("self");
		});

		test("omits --draft when draft is false", async () => {
			const glab = makeGlab({
				"mr create --source-branch b --title T --description D": ok(
					"https://gitlab.com/p/-/merge_requests/3",
				),
			});
			await glab.createMr({
				sourceBranch: "b",
				title: "T",
				description: "D",
				draft: false,
				reviewers: [],
			});
			expect(calls[0]).not.toContain("--draft");
		});

		test("throws PortError with stderr on create failure", async () => {
			const glab = makeGlab({
				"mr create --source-branch f --title T --description D": fail(
					"merge request already exists",
					1,
				),
			});
			try {
				await glab.createMr({
					sourceBranch: "f",
					title: "T",
					description: "D",
					draft: false,
					reviewers: [],
				});
			} catch (e) {
				expect((e as PortError).stderr).toBe("merge request already exists");
				expect((e as PortError).code).toBe(1);
			}
		});

		test("throws when no URL found in output", async () => {
			const glab = makeGlab({
				"mr create --source-branch x --title T --description D": ok(
					"MR created successfully",
				),
			});
			await expect(
				glab.createMr({
					sourceBranch: "x",
					title: "T",
					description: "D",
					draft: false,
					reviewers: [],
				}),
			).rejects.toThrow("MR created but no URL found in output");
		});

		test("passes multiple reviewers as separate --reviewer flags", async () => {
			const glab = makeGlab({
				"mr create --source-branch s --title T --description D --reviewer a --reviewer b":
					ok("https://gitlab.com/p/-/merge_requests/4"),
			});
			await glab.createMr({
				sourceBranch: "s",
				title: "T",
				description: "D",
				draft: false,
				reviewers: ["a", "b"],
			});
			const reviewerCount = calls[0].filter((c) => c === "--reviewer").length;
			expect(reviewerCount).toBe(2);
		});

		test("omits --assignee when not provided", async () => {
			const glab = makeGlab({
				"mr create --source-branch c --title T --description D": ok(
					"https://gitlab.com/p/-/merge_requests/5",
				),
			});
			await glab.createMr({
				sourceBranch: "c",
				title: "T",
				description: "D",
				draft: false,
				reviewers: [],
			});
			expect(calls[0]).not.toContain("--assignee");
		});

		test("does not pass --target-branch", async () => {
			const glab = makeGlab({
				"mr create --source-branch f --title T --description D": ok(
					"https://gitlab.com/p/-/merge_requests/6",
				),
			});
			await glab.createMr({
				sourceBranch: "f",
				title: "T",
				description: "D",
				draft: false,
				reviewers: [],
			});
			expect(calls[0]).not.toContain("--target-branch");
		});

		test("includes --source-branch in args", async () => {
			const glab = makeGlab({
				"mr create --source-branch dev --title T --description D": ok(
					"https://gitlab.com/p/-/merge_requests/7",
				),
			});
			await glab.createMr({
				sourceBranch: "dev",
				title: "T",
				description: "D",
				draft: false,
				reviewers: [],
			});
			expect(calls[0]).toContain("--source-branch");
			expect(calls[0]).toContain("dev");
		});
	});
});
