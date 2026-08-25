import { describe, expect, test } from "bun:test";
import { PortError } from "../../core/errors";
import type { CreateDiscussionInput } from "../../ports/git-host";
import { parseFileDiff } from "../../shared/diff-parse";
import { buildPosition } from "../../shared/gitlab-position";
import type { MrRef } from "../../shared/mr-url";
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
		return new GlabAdapter(exec);
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
			expect(await glab.currentUser()).toEqual({
				id: "1",
				handle: "bob",
				displayName: "bob",
			});
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
				"api /users?username=alice": ok(
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
			const glab = makeGlab({
				"api /users?username=nobody": fail("", 404),
				"api /users?search=nobody": fail("", 404),
			});
			expect(await glab.resolveHandle("nobody")).toBeNull();
		});

		test("resolves a git author name to its GitLab username", async () => {
			const glab = makeGlab({
				"api /users?username=Cara%20Fisher": ok("[]"),
				"api /users?search=Cara%20Fisher": ok(
					JSON.stringify([{ id: 8, username: "caraf", name: "Cara Fisher" }]),
				),
			});
			expect(await glab.resolveHandle("Cara Fisher")).toEqual({
				id: "8",
				handle: "caraf",
				displayName: "Cara Fisher",
				kind: "user",
			});
		});

		test("returns null for user with empty response body", async () => {
			const glab = makeGlab({
				"api /users?username=ghost": ok("[]"),
				"api /users?search=ghost": ok("[]"),
			});
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
				"api /users?username=j.doe": ok(
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
			const reviewerCount = calls[0]?.filter((c) => c === "--reviewer").length;
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

	describe("createDiscussion", () => {
		const ref: MrRef = {
			host: "gitlab.example.com",
			projectPath: "group/sub/project",
			iid: 42,
		};

		const parsedDiff = parseFileDiff({
			path: "src/app.ts",
			statOnly: false,
			patch: [
				"diff --git a/src/app.ts b/src/app.ts",
				"--- a/src/app.ts",
				"+++ b/src/app.ts",
				"@@ -1,1 +1,2 @@",
				"-old",
				"+new",
				"+added",
			].join("\n"),
			insertions: 2,
			deletions: 1,
		});
		const refs = {
			baseSha: "base-sha",
			startSha: "start-sha",
			headSha: "head-sha",
		};

		test("posts body and validated position as JSON stdin", async () => {
			const position = buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 1, endLine: 2 },
				parsedDiff,
				refs,
			);
			const calls: { args: string[]; input?: string }[] = [];
			const response = JSON.stringify({
				id: "discussion-1",
				resolved: false,
				notes: [
					{
						id: 1,
						author: { username: "alice" },
						body: "Review this",
						created_at: "2026-08-16T00:00:00Z",
						system: false,
						position,
					},
				],
			});
			const exec: GlabExec = async (args, input) => {
				calls.push({ args, input });
				return ok(response);
			};

			const discussion = await new GlabAdapter(exec).createDiscussion({
				ref,
				body: "Review this",
				position,
				parsedDiff,
				diffRefs: refs,
			});

			expect(discussion.id).toBe("discussion-1");
			expect(calls).toHaveLength(1);
			expect(calls[0]?.args).toEqual([
				"api",
				"--hostname",
				"gitlab.example.com",
				"--method",
				"POST",
				"--header",
				"Content-Type: application/json",
				"--input",
				"-",
				"projects/group%2Fsub%2Fproject/merge_requests/42/discussions",
			]);
			expect(JSON.parse(calls[0]?.input ?? "")).toEqual({
				body: "Review this",
				position,
			});
		});
		test("posts unpositioned discussion body as JSON stdin", async () => {
			const calls: { args: string[]; input?: string }[] = [];
			const exec: GlabExec = async (args, input) => {
				calls.push({ args, input });
				return ok(
					JSON.stringify({
						id: "discussion-2",
						resolved: false,
						notes: [],
					}),
				);
			};

			await new GlabAdapter(exec).createDiscussion({
				ref,
				body: "General review note",
			});

			expect(calls).toHaveLength(1);
			expect(JSON.parse(calls[0]?.input ?? "")).toEqual({
				body: "General review note",
			});
		});

		test("rejects stale line codes before host write", async () => {
			const position = buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 1, endLine: 2 },
				parsedDiff,
				refs,
			);
			const calls: { args: string[]; input?: string }[] = [];
			const exec: GlabExec = async (args, input) => {
				calls.push({ args, input });
				return ok("unreachable");
			};
			const stale = structuredClone(position);
			if (stale.line_range) {
				stale.line_range.start.line_code = "stale-line-code";
			}

			await expect(
				new GlabAdapter(exec).createDiscussion({
					ref,
					body: "Review this",
					position: stale,
					parsedDiff,
					diffRefs: refs,
				}),
			).rejects.toBeInstanceOf(PortError);
			expect(calls).toEqual([]);
		});

		test("rejects positions from a stale MR head before host write", async () => {
			const position = buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 1, endLine: 1 },
				parsedDiff,
				refs,
			);
			const calls: { args: string[]; input?: string }[] = [];
			const exec: GlabExec = async (args, input) => {
				calls.push({ args, input });
				return ok("unreachable");
			};

			await expect(
				new GlabAdapter(exec).createDiscussion({
					ref,
					body: "Review this",
					position,
					parsedDiff,
					diffRefs: { ...refs, headSha: "new-head-sha" },
				}),
			).rejects.toThrow("current diff refs");
			expect(calls).toEqual([]);
		});
		test("rejects positioned payload without parsed diff before host write", async () => {
			const position = buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 1, endLine: 1 },
				parsedDiff,
				refs,
			);
			const calls: { args: string[]; input?: string }[] = [];
			const exec: GlabExec = async (args, input) => {
				calls.push({ args, input });
				return ok("unreachable");
			};
			const invalid = {
				ref,
				body: "Review this",
				position,
				diffRefs: refs,
			} as unknown as CreateDiscussionInput;

			await expect(
				new GlabAdapter(exec).createDiscussion(invalid),
			).rejects.toThrow("require parsedDiff and diffRefs");
			expect(calls).toEqual([]);
		});
	});
	describe("approval", () => {
		const ref: MrRef = {
			host: "gitlab.example.com",
			projectPath: "group/sub/project",
			iid: 42,
		};
		const approvalPath =
			"projects/group%2Fsub%2Fproject/merge_requests/42/approvals";
		const approvalPayload = {
			user_has_approved: false,
			approvals_left: 1,
			approved_by: [{ user: { username: "alice", name: "Alice" } }],
			rules: [
				{
					name: "Maintainers",
					approvals_required: 2,
					approvals_left: 1,
					approved_by: [{ user: { name: "Alice" } }],
				},
			],
		};

		test("fetches and normalizes approval state", async () => {
			const glab = makeGlab({
				[`api --hostname ${ref.host} ${approvalPath}`]: ok(
					JSON.stringify(approvalPayload),
				),
				"api /user": ok(
					JSON.stringify({ id: 1, username: "alice", name: "Alice" }),
				),
			});

			await expect(glab.fetchApprovalState(ref)).resolves.toEqual({
				approved: true,
				currentUser: "alice",
				approvalsLeft: 1,
				approvedBy: ["alice"],
				rules: [
					{
						name: "Maintainers",
						approvalsRequired: 2,
						approvalsLeft: 1,
						approvedBy: ["Alice"],
					},
				],
			});
		});

		test("posts current MR head SHA before refetching after approve", async () => {
			const mrPath = "projects/group%2Fsub%2Fproject/merge_requests/42";
			const mrPayload = {
				iid: 42,
				title: "Review",
				description: null,
				web_url:
					"https://gitlab.example.com/group/sub/project/-/merge_requests/42",
				author: { username: "bob" },
				source_branch: "feature",
				target_branch: "main",
				sha: "head-sha",
				diff_refs: {
					base_sha: "base-sha",
					start_sha: "start-sha",
					head_sha: "head-sha",
				},
				state: "opened",
			};
			const glab = makeGlab({
				[`api --hostname ${ref.host} ${mrPath}`]: ok(JSON.stringify(mrPayload)),
				[`api --hostname ${ref.host} --method POST --field sha=head-sha projects/group%2Fsub%2Fproject/merge_requests/42/approve`]:
					ok("{}"),
				[`api --hostname ${ref.host} ${approvalPath}`]: ok(
					JSON.stringify({
						...approvalPayload,
						user_has_approved: true,
						approvals_left: 0,
					}),
				),
				"api /user": ok(
					JSON.stringify({ id: 1, username: "alice", name: "Alice" }),
				),
			});

			await expect(glab.approveMr(ref)).resolves.toMatchObject({
				approved: true,
				approvalsLeft: 0,
			});
			expect(calls).toEqual([
				["api", "--hostname", ref.host, mrPath],
				[
					"api",
					"--hostname",
					ref.host,
					"--method",
					"POST",
					"--field",
					"sha=head-sha",
					"projects/group%2Fsub%2Fproject/merge_requests/42/approve",
				],
				["api", "--hostname", ref.host, approvalPath],
				["api", "/user"],
			]);
		});

		test("posts unapprove then refetches approval state", async () => {
			const glab = makeGlab({
				[`api --hostname ${ref.host} --method POST projects/group%2Fsub%2Fproject/merge_requests/42/unapprove`]:
					ok("{}"),
				[`api --hostname ${ref.host} ${approvalPath}`]: ok(
					JSON.stringify({
						...approvalPayload,
						approved_by: [],
						approvals_left: 2,
					}),
				),
				"api /user": ok(
					JSON.stringify({ id: 1, username: "alice", name: "Alice" }),
				),
			});

			await expect(glab.unapproveMr(ref)).resolves.toMatchObject({
				approved: false,
				approvalsLeft: 2,
				approvedBy: [],
			});
		});

		test("rejects malformed approval payload", async () => {
			const glab = makeGlab({
				[`api --hostname ${ref.host} ${approvalPath}`]: ok("{}"),
			});
			await expect(glab.fetchApprovalState(ref)).rejects.toThrow(
				"Invalid GitLab approval response",
			);
		});
	});
});
