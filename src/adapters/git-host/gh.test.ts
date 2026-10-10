import { describe, expect, test } from "bun:test";
import { PortError } from "../../core/errors";
import type { CreateMrInput } from "../../ports/git-host";
import type { ParsedFileDiff } from "../../shared/diff-parse";
import { parseFileDiff } from "../../shared/diff-parse";
import type { MrRef } from "../../shared/mr-url";
import { GhAdapter, type GhExec, type GhExecResult } from "./gh";

function ok(stdout: string): GhExecResult {
	return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr: string, exitCode = 1): GhExecResult {
	return { stdout: "", stderr, exitCode };
}

function makeGh(script: Record<string, GhExecResult | Error>) {
	const calls: { args: string[]; input?: string }[] = [];
	const exec: GhExec = async (args, input) => {
		const copiedArgs = [...args];
		calls.push({ args: copiedArgs, ...(input === undefined ? {} : { input }) });
		const key = args.join(" ");
		const result = script[key];
		if (!result) {
			throw new Error(`unscripted gh call: ${key}`);
		}

		if (result instanceof Error) {
			throw result;
		}

		return result;
	};
	return { adapter: new GhAdapter({ host: "github.com", exec }), calls };
}

async function rejectedBy(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}

	throw new Error("Expected promise to reject");
}

describe("GhAdapter", () => {
	describe("preflight", () => {
		test("checks gh version and host authentication in order", async () => {
			const { adapter, calls } = makeGh({
				"--version": ok("gh version 2.96.0\n"),
				"auth status --hostname github.com": ok("Logged in to github.com\n"),
			});

			await expect(adapter.preflight()).resolves.toBeUndefined();
			expect(calls).toEqual([
				{ args: ["--version"] },
				{ args: ["auth", "status", "--hostname", "github.com"] },
			]);
		});

		test("preserves trimmed version failure message, stderr, and exit code", async () => {
			const { adapter } = makeGh({
				"--version": fail("  gh missing from PATH  ", 127),
			});

			const error = await rejectedBy(adapter.preflight());
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "gh missing from PATH",
				stderr: "  gh missing from PATH  ",
				code: 127,
			});
		});

		test("uses not-installed fallback when version failure has empty stderr", async () => {
			const { adapter } = makeGh({ "--version": fail("", 127) });

			const error = await rejectedBy(adapter.preflight());
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "gh is not installed",
				stderr: "",
				code: 127,
			});
		});

		test("uses not-installed message when version execution rejects", async () => {
			const detail = "spawn gh ENOENT";
			const { adapter, calls } = makeGh({
				"--version": new Error(detail),
			});

			const error = await rejectedBy(adapter.preflight());
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "gh is not installed",
				stderr: detail,
				code: 1,
			});
			expect(calls).toEqual([{ args: ["--version"] }]);
		});

		test("uses host-specific authentication failure and preserves command details", async () => {
			const { adapter, calls } = makeGh({
				"--version": ok("gh version 2.96.0\n"),
				"auth status --hostname github.com": fail("  login required  ", 4),
			});

			const error = await rejectedBy(adapter.preflight());
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "login required",
				stderr: "  login required  ",
				code: 4,
			});
			expect(calls).toEqual([
				{ args: ["--version"] },
				{ args: ["auth", "status", "--hostname", "github.com"] },
			]);
		});

		test("uses host-specific authentication fallback when stderr is empty", async () => {
			const { adapter } = makeGh({
				"--version": ok("gh version 2.96.0\n"),
				"auth status --hostname github.com": fail("", 1),
			});

			const error = await rejectedBy(adapter.preflight());
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "gh is not authenticated for github.com",
				stderr: "",
				code: 1,
			});
		});

		test("preserves authentication execution rejection details", async () => {
			const detail = "  runner disconnected  ";
			const { adapter, calls } = makeGh({
				"--version": ok("gh version 2.96.0\n"),
				"auth status --hostname github.com": new Error(detail),
			});

			const error = await rejectedBy(adapter.preflight());
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "runner disconnected",
				stderr: detail,
				code: 1,
			});
			expect(calls).toEqual([
				{ args: ["--version"] },
				{ args: ["auth", "status", "--hostname", "github.com"] },
			]);
		});
	});

	describe("currentUser", () => {
		test("maps the authenticated GitHub user", async () => {
			const { adapter, calls } = makeGh({
				"api --hostname github.com user": ok(
					JSON.stringify({ id: 42, login: "octocat", name: "Octo Cat" }),
				),
			});

			await expect(adapter.currentUser()).resolves.toEqual({
				id: "42",
				handle: "octocat",
				displayName: "Octo Cat",
			});
			expect(calls).toEqual([
				{ args: ["api", "--hostname", "github.com", "user"] },
			]);
		});

		test("uses login as display name when name is null", async () => {
			const { adapter } = makeGh({
				"api --hostname github.com user": ok(
					JSON.stringify({ id: 42, login: "octocat", name: null }),
				),
			});

			await expect(adapter.currentUser()).resolves.toEqual({
				id: "42",
				handle: "octocat",
				displayName: "octocat",
			});
		});

		test.each([
			{ scenario: "failed", result: fail("unauthorized", 1) },
			{ scenario: "rejected", result: new Error("runner disconnected") },
			{ scenario: "blank", result: ok("  \n") },
			{ scenario: "invalid JSON", result: ok("not json") },
			{
				scenario: "invalid payload",
				result: ok(JSON.stringify({ id: "42", login: "octocat" })),
			},
		])("returns null for a $scenario response", async ({ result }) => {
			const { adapter, calls } = makeGh({
				"api --hostname github.com user": result,
			});

			await expect(adapter.currentUser()).resolves.toBeNull();
			expect(calls).toEqual([
				{ args: ["api", "--hostname", "github.com", "user"] },
			]);
		});
	});

	describe("findOpenMr", () => {
		test("requests one open PR for the branch and returns its URL", async () => {
			const url = "https://github.com/acme/api/pull/42";
			const { adapter, calls } = makeGh({
				"pr list --head feature/fix --state open --json url --limit 1": ok(
					JSON.stringify([{ url }]),
				),
			});

			await expect(adapter.findOpenMr("feature/fix")).resolves.toEqual({ url });
			expect(calls).toEqual([
				{
					args: [
						"pr",
						"list",
						"--head",
						"feature/fix",
						"--state",
						"open",
						"--json",
						"url",
						"--limit",
						"1",
					],
				},
			]);
		});

		test.each([
			{ scenario: "empty", result: ok("[]") },
			{ scenario: "failed", result: fail("gh API unavailable", 1) },
			{ scenario: "rejected", result: new Error("runner disconnected") },
			{ scenario: "invalid JSON", result: ok("not json") },
			{
				scenario: "invalid payload",
				result: ok(JSON.stringify([{ url: 42 }])),
			},
		])("returns null for an $scenario lookup result", async ({ result }) => {
			const { adapter, calls } = makeGh({
				"pr list --head main --state open --json url --limit 1": result,
			});

			await expect(adapter.findOpenMr("main")).resolves.toBeNull();
			expect(calls).toEqual([
				{
					args: [
						"pr",
						"list",
						"--head",
						"main",
						"--state",
						"open",
						"--json",
						"url",
						"--limit",
						"1",
					],
				},
			]);
		});
	});

	describe("resolveHandle", () => {
		test("resolves an organization team as a group", async () => {
			const { adapter, calls } = makeGh({
				"api --hostname github.com orgs/acme/teams/reviewers": ok(
					JSON.stringify({ id: 18, name: "Reviewers" }),
				),
			});

			await expect(adapter.resolveHandle("acme/reviewers")).resolves.toEqual({
				id: "18",
				handle: "acme/reviewers",
				displayName: "Reviewers",
				kind: "group",
			});
			expect(calls).toEqual([
				{
					args: [
						"api",
						"--hostname",
						"github.com",
						"orgs/acme/teams/reviewers",
					],
				},
			]);
		});

		test("encodes organization and team path segments separately", async () => {
			const { adapter, calls } = makeGh({
				"api --hostname github.com orgs/acme%20org/teams/review%26triage": ok(
					JSON.stringify({ id: 18, name: "Review and triage" }),
				),
			});

			await expect(
				adapter.resolveHandle("acme org/review&triage"),
			).resolves.toMatchObject({ kind: "group" });
			expect(calls[0]?.args).toEqual([
				"api",
				"--hostname",
				"github.com",
				"orgs/acme%20org/teams/review%26triage",
			]);
		});

		test("resolves an exact user login", async () => {
			const { adapter, calls } = makeGh({
				"api --hostname github.com users/octocat": ok(
					JSON.stringify({ id: 42, login: "octocat", name: "Octo Cat" }),
				),
			});

			await expect(adapter.resolveHandle("octocat")).resolves.toEqual({
				id: "42",
				handle: "octocat",
				displayName: "Octo Cat",
				kind: "user",
			});
			expect(calls).toEqual([
				{ args: ["api", "--hostname", "github.com", "users/octocat"] },
			]);
		});

		test("searches up to five users and matches a compact display name", async () => {
			const searchArgs =
				"api --hostname github.com search/users?q=Jane%20Example%20in%3Aname%20type%3Auser&per_page=5";
			const { adapter, calls } = makeGh({
				"api --hostname github.com users/Jane%20Example": fail("Not Found", 1),
				[searchArgs]: ok(
					JSON.stringify({
						items: [{ login: "unrelated" }, { login: "jane-ex" }],
					}),
				),
				"api --hostname github.com users/unrelated": ok(
					JSON.stringify({
						id: 1,
						login: "unrelated",
						name: "Different Person",
					}),
				),
				"api --hostname github.com users/jane-ex": ok(
					JSON.stringify({ id: 2, login: "jane-ex", name: "Jane Example" }),
				),
			});

			await expect(adapter.resolveHandle("Jane Example")).resolves.toEqual({
				id: "2",
				handle: "jane-ex",
				displayName: "Jane Example",
				kind: "user",
			});
			expect(calls.map(({ args }) => args.join(" "))).toEqual([
				"api --hostname github.com users/Jane%20Example",
				searchArgs,
				"api --hostname github.com users/unrelated",
				"api --hostname github.com users/jane-ex",
			]);
		});

		test("continues after a failed candidate lookup", async () => {
			const searchArgs =
				"api --hostname github.com search/users?q=Jane%20Example%20in%3Aname%20type%3Auser&per_page=5";
			const { adapter, calls } = makeGh({
				"api --hostname github.com users/Jane%20Example": fail("Not Found", 1),
				[searchArgs]: ok(
					JSON.stringify({
						items: [{ login: "unavailable" }, { login: "jane-ex" }],
					}),
				),
				"api --hostname github.com users/unavailable": new Error(
					"runner disconnected",
				),
				"api --hostname github.com users/jane-ex": ok(
					JSON.stringify({ id: 2, login: "jane-ex", name: "Jane Example" }),
				),
			});

			await expect(adapter.resolveHandle("Jane Example")).resolves.toEqual({
				id: "2",
				handle: "jane-ex",
				displayName: "Jane Example",
				kind: "user",
			});
			expect(calls.map(({ args }) => args.join(" "))).toEqual([
				"api --hostname github.com users/Jane%20Example",
				searchArgs,
				"api --hostname github.com users/unavailable",
				"api --hostname github.com users/jane-ex",
			]);
		});

		test("returns null when search finds no compact match", async () => {
			const searchArgs =
				"api --hostname github.com search/users?q=Nobody%20Here%20in%3Aname%20type%3Auser&per_page=5";
			const noMatch = makeGh({
				"api --hostname github.com users/Nobody%20Here": fail("Not Found", 1),
				[searchArgs]: ok(
					JSON.stringify({
						items: [
							{ login: "one" },
							{ login: "two" },
							{ login: "three" },
							{ login: "four" },
							{ login: "five" },
							{ login: "six" },
						],
					}),
				),
				"api --hostname github.com users/one": ok(
					JSON.stringify({ id: 1, login: "one", name: "First User" }),
				),
				"api --hostname github.com users/two": ok(
					JSON.stringify({ id: 2, login: "two", name: "Second User" }),
				),
				"api --hostname github.com users/three": ok(
					JSON.stringify({ id: 3, login: "three", name: "Third User" }),
				),
				"api --hostname github.com users/four": ok(
					JSON.stringify({ id: 4, login: "four", name: "Fourth User" }),
				),
				"api --hostname github.com users/five": ok(
					JSON.stringify({ id: 5, login: "five", name: "Fifth User" }),
				),
			});
			await expect(
				noMatch.adapter.resolveHandle("Nobody Here"),
			).resolves.toBeNull();
			expect(noMatch.calls.map(({ args }) => args.join(" "))).toEqual([
				"api --hostname github.com users/Nobody%20Here",
				searchArgs,
				"api --hostname github.com users/one",
				"api --hostname github.com users/two",
				"api --hostname github.com users/three",
				"api --hostname github.com users/four",
				"api --hostname github.com users/five",
			]);
		});

		test("returns null when a team lookup fails", async () => {
			const { adapter, calls } = makeGh({
				"api --hostname github.com orgs/acme/teams/reviewers": fail(
					"Forbidden",
					1,
				),
			});

			await expect(adapter.resolveHandle("acme/reviewers")).resolves.toBeNull();
			expect(calls).toEqual([
				{
					args: [
						"api",
						"--hostname",
						"github.com",
						"orgs/acme/teams/reviewers",
					],
				},
			]);
		});

		test("returns null when a user-search call rejects", async () => {
			const { adapter, calls } = makeGh({
				"api --hostname github.com users/octocat": fail("Not Found", 1),
				"api --hostname github.com search/users?q=octocat%20in%3Aname%20type%3Auser&per_page=5":
					new Error("runner disconnected"),
			});

			await expect(adapter.resolveHandle("octocat")).resolves.toBeNull();
			expect(calls.map(({ args }) => args.join(" "))).toEqual([
				"api --hostname github.com users/octocat",
				"api --hostname github.com search/users?q=octocat%20in%3Aname%20type%3Auser&per_page=5",
			]);
		});
	});

	describe("createMr", () => {
		const input: CreateMrInput = {
			sourceBranch: "feature/fix",
			title: "Fix the issue",
			description: "Details",
			assignee: "octocat",
			reviewers: ["reviewer-one", "reviewer-two"],
			draft: true,
		};

		test("creates a draft PR with assignee then reviewers in input order", async () => {
			const url = "https://github.com/acme/api/pull/42";
			const { adapter, calls } = makeGh({
				"pr create --head feature/fix --title Fix the issue --body Details --assignee octocat --reviewer reviewer-one --reviewer reviewer-two --draft":
					ok(`Creating pull request\n${url}\n`),
			});

			await expect(adapter.createMr(input)).resolves.toEqual({ url });
			expect(calls).toEqual([
				{
					args: [
						"pr",
						"create",
						"--head",
						"feature/fix",
						"--title",
						"Fix the issue",
						"--body",
						"Details",
						"--assignee",
						"octocat",
						"--reviewer",
						"reviewer-one",
						"--reviewer",
						"reviewer-two",
						"--draft",
					],
				},
			]);
		});

		test("creates a PR without optional flags when no options are set", async () => {
			const minimalInput: CreateMrInput = {
				sourceBranch: "main",
				title: "Title",
				description: "Body",
				draft: false,
				reviewers: [],
			};
			const { adapter, calls } = makeGh({
				"pr create --head main --title Title --body Body": ok(
					"https://github.com/acme/api/pull/43",
				),
			});

			await expect(adapter.createMr(minimalInput)).resolves.toEqual({
				url: "https://github.com/acme/api/pull/43",
			});
			expect(calls).toEqual([
				{
					args: [
						"pr",
						"create",
						"--head",
						"main",
						"--title",
						"Title",
						"--body",
						"Body",
					],
				},
			]);
		});

		test("returns PortError with trimmed stderr and exit code on failure", async () => {
			const { adapter } = makeGh({
				"pr create --head feature/fix --title Fix the issue --body Details --assignee octocat --reviewer reviewer-one --reviewer reviewer-two --draft":
					fail("  invalid title  ", 2),
			});

			const error = await rejectedBy(adapter.createMr(input));
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "invalid title",
				stderr: "  invalid title  ",
				code: 2,
			});
		});

		test("uses fallback message when create fails with empty stderr", async () => {
			const { adapter } = makeGh({
				"pr create --head feature/fix --title Fix the issue --body Details --assignee octocat --reviewer reviewer-one --reviewer reviewer-two --draft":
					fail("", 2),
			});

			const error = await rejectedBy(adapter.createMr(input));
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "gh pr create failed",
				stderr: "",
				code: 2,
			});
		});

		test("reports successful output without a URL and retains stdout", async () => {
			const stdout = "Pull request was created, but URL was omitted";
			const { adapter } = makeGh({
				"pr create --head feature/fix --title Fix the issue --body Details --assignee octocat --reviewer reviewer-one --reviewer reviewer-two --draft":
					ok(stdout),
			});

			const error = await rejectedBy(adapter.createMr(input));
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "Pull request created but no URL found in output",
				stderr: stdout,
			});
		});
	});
	describe("fetchMr", () => {
		const ref: MrRef = {
			host: "github.com",
			projectPath: "owner name/repo#name",
			iid: 42,
		};
		const pullArgs = [
			"api",
			"--hostname",
			"github.com",
			"repos/owner%20name/repo%23name/pulls/42",
		];
		const pull = {
			number: 42,
			title: "A pull request",
			body: null,
			html_url: "https://github.com/owner/repo/pull/42",
			state: "open",
			merged_at: null,
			user: { login: "octocat" },
			head: { ref: "feature", sha: "head-sha" },
			base: { ref: "main", sha: "base-sha" },
		};
		const compareArgs = [
			"api",
			"--hostname",
			"github.com",
			"repos/owner%20name/repo%23name/compare/base-sha...head-sha",
		];

		test("maps open pull request details and compare merge base", async () => {
			const { adapter, calls } = makeGh({
				[pullArgs.join(" ")]: ok(JSON.stringify(pull)),
				[compareArgs.join(" ")]: ok(
					JSON.stringify({ merge_base_commit: { sha: "merge-base-sha" } }),
				),
			});

			await expect(adapter.fetchMr(ref)).resolves.toEqual({
				provider: "github",
				iid: 42,
				projectPath: ref.projectPath,
				title: "A pull request",
				description: "",
				webUrl: "https://github.com/owner/repo/pull/42",
				author: "octocat",
				sourceBranch: "feature",
				targetBranch: "main",
				headSha: "head-sha",
				diffRefs: {
					baseSha: "merge-base-sha",
					startSha: "base-sha",
					headSha: "head-sha",
				},
				state: "opened",
			});
			expect(calls.map(({ args }) => args)).toEqual([pullArgs, compareArgs]);
		});

		test.each([
			[
				"merged",
				"merged",
				{ state: "closed", merged_at: "2025-01-01T00:00:00Z" },
			],
			["closed", "closed", { state: "closed", merged_at: null }],
		])("maps %s pull requests to %s", async (_name, expectedState, state) => {
			const { adapter } = makeGh({
				[pullArgs.join(" ")]: ok(JSON.stringify({ ...pull, ...state })),
				[compareArgs.join(" ")]: ok(
					JSON.stringify({ merge_base_commit: { sha: "merge-base-sha" } }),
				),
			});

			await expect(adapter.fetchMr(ref)).resolves.toMatchObject({
				state: expectedState,
			});
		});

		test("rejects mismatched number before requesting compare", async () => {
			const { adapter, calls } = makeGh({
				[pullArgs.join(" ")]: ok(JSON.stringify({ ...pull, number: 43 })),
			});

			const error = await rejectedBy(adapter.fetchMr(ref));
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message:
					"GitHub pull request number mismatch: requested 42, received 43",
			});
			expect(calls.map(({ args }) => args)).toEqual([pullArgs]);
		});

		test("rejects API failures with trimmed stderr", async () => {
			const { adapter } = makeGh({
				[pullArgs.join(" ")]: fail("  request denied\n", 2),
			});

			const error = await rejectedBy(adapter.fetchMr(ref));
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "request denied",
				stderr: "  request denied\n",
				code: 2,
			});
		});

		test("reports invalid pull request JSON", async () => {
			const { adapter } = makeGh({
				[pullArgs.join(" ")]: ok("{"),
			});

			const error = await rejectedBy(adapter.fetchMr(ref));
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "Invalid GitHub pull request response: invalid JSON",
			});
		});
	});

	describe("approval", () => {
		const ref: MrRef = {
			host: "github.com",
			projectPath: "owner/repo",
			iid: 42,
		};
		const reviewsArgs = [
			"api",
			"--hostname",
			"github.com",
			"--paginate",
			"--slurp",
			"repos/owner/repo/pulls/42/reviews?per_page=100",
		];
		const userArgs = ["api", "--hostname", "github.com", "user"];
		const makeReview = (id: number, login: string | null, state: string) => ({
			id,
			user: login === null ? null : { login },
			state,
			body: "",
			submitted_at: "2026-10-09T00:00:00Z",
		});
		const userResponse = (login: string) =>
			ok(JSON.stringify({ id: 7, login, name: null }));

		const pullArgs = [
			"api",
			"--hostname",
			"github.com",
			"repos/owner/repo/pulls/42",
		];
		const compareArgs = [
			"api",
			"--hostname",
			"github.com",
			"repos/owner/repo/compare/base-sha...head-sha",
		];
		const approveArgs = [
			"api",
			"--hostname",
			"github.com",
			"--method",
			"POST",
			"repos/owner/repo/pulls/42/reviews",
			"-f",
			"event=APPROVE",
			"-f",
			"commit_id=head-sha",
		];
		const pull = {
			number: 42,
			title: "A pull request",
			body: null,
			html_url: "https://github.com/owner/repo/pull/42",
			state: "open",
			merged_at: null,
			user: { login: "octocat" },
			head: { ref: "feature", sha: "head-sha" },
			base: { ref: "main", sha: "base-sha" },
		};

		test("uses latest decisive review per user and ignores COMMENTED", async () => {
			const { adapter, calls } = makeGh({
				[reviewsArgs.join(" ")]: ok(
					JSON.stringify([
						[
							makeReview(1, "OctoCat", "APPROVED"),
							makeReview(2, "oCToCat", "CHANGES_REQUESTED"),
							makeReview(3, "reviewer", "APPROVED"),
						],
						[
							makeReview(4, "reviewer", "COMMENTED"),
							makeReview(5, "withdrawn", "APPROVED"),
							makeReview(6, "withdrawn", "DISMISSED"),
							makeReview(7, null, "APPROVED"),
						],
					]),
				),
				[userArgs.join(" ")]: userResponse("OCTOCAT"),
			});

			await expect(adapter.fetchApprovalState(ref)).resolves.toEqual({
				approved: false,
				currentUser: "OCTOCAT",
				approvalsLeft: null,
				approvedBy: ["reviewer"],
				rules: [],
			});
			expect(calls.map(({ args }) => args)).toEqual([reviewsArgs, userArgs]);
		});

		test("ignores pending reviews when submitted_at is omitted", async () => {
			const { adapter, calls } = makeGh({
				[reviewsArgs.join(" ")]: ok(
					JSON.stringify([
						[
							{
								id: 8,
								user: { login: "octocat" },
								state: "PENDING",
								body: "pending review",
							},
						],
					]),
				),
				[userArgs.join(" ")]: userResponse("octocat"),
			});

			await expect(adapter.fetchApprovalState(ref)).resolves.toEqual({
				approved: false,
				currentUser: "octocat",
				approvalsLeft: null,
				approvedBy: [],
				rules: [],
			});
			expect(calls.map(({ args }) => args)).toEqual([reviewsArgs, userArgs]);
		});

		test("matches the current user case-insensitively", async () => {
			const { adapter } = makeGh({
				[reviewsArgs.join(" ")]: ok(
					JSON.stringify([[makeReview(1, "OctoCat", "APPROVED")]]),
				),
				[userArgs.join(" ")]: userResponse("octocat"),
			});

			await expect(adapter.fetchApprovalState(ref)).resolves.toEqual({
				approved: true,
				currentUser: "octocat",
				approvalsLeft: null,
				approvedBy: ["OctoCat"],
				rules: [],
			});
		});

		test("keeps approvals but sets currentUser null when user lookup fails", async () => {
			const { adapter, calls } = makeGh({
				[reviewsArgs.join(" ")]: ok(
					JSON.stringify([[makeReview(1, "OctoCat", "APPROVED")]]),
				),
				[userArgs.join(" ")]: fail("not authenticated"),
			});

			await expect(adapter.fetchApprovalState(ref)).resolves.toEqual({
				approved: false,
				currentUser: null,
				approvalsLeft: null,
				approvedBy: ["OctoCat"],
				rules: [],
			});
			expect(calls.map(({ args }) => args)).toEqual([reviewsArgs, userArgs]);
		});

		test("returns approval state after submission when current user lookup fails", async () => {
			const { adapter, calls } = makeGh({
				[pullArgs.join(" ")]: ok(JSON.stringify(pull)),
				[compareArgs.join(" ")]: ok(
					JSON.stringify({
						merge_base_commit: { sha: "merge-base-sha" },
					}),
				),
				[approveArgs.join(" ")]: ok("{}"),
				[reviewsArgs.join(" ")]: ok(
					JSON.stringify([[makeReview(73, "octocat", "APPROVED")]]),
				),
				[userArgs.join(" ")]: fail("not authenticated"),
			});

			await expect(adapter.approveMr(ref)).resolves.toEqual({
				approved: false,
				currentUser: null,
				approvalsLeft: null,
				approvedBy: ["octocat"],
				rules: [],
			});
			expect(calls.map(({ args }) => args)).toEqual([
				pullArgs,
				compareArgs,
				approveArgs,
				reviewsArgs,
				userArgs,
			]);
		});

		test("fetches the PR head before posting an approval", async () => {
			const { adapter, calls } = makeGh({
				[pullArgs.join(" ")]: ok(JSON.stringify(pull)),
				[compareArgs.join(" ")]: ok(
					JSON.stringify({
						merge_base_commit: { sha: "merge-base-sha" },
					}),
				),
				[approveArgs.join(" ")]: ok("{}"),
				[reviewsArgs.join(" ")]: ok(
					JSON.stringify([[makeReview(72, "octocat", "APPROVED")]]),
				),
				[userArgs.join(" ")]: userResponse("octocat"),
			});

			await expect(adapter.approveMr(ref)).resolves.toEqual({
				approved: true,
				currentUser: "octocat",
				approvalsLeft: null,
				approvedBy: ["octocat"],
				rules: [],
			});
			expect(calls.map(({ args }) => args)).toEqual([
				pullArgs,
				compareArgs,
				approveArgs,
				reviewsArgs,
				userArgs,
			]);
		});

		test("dismisses the current user's latest approval then reloads state", async () => {
			const dismissArgs = [
				"api",
				"--hostname",
				"github.com",
				"--method",
				"PUT",
				"repos/owner/repo/pulls/42/reviews/71/dismissals",
				"-f",
				"message=Approval withdrawn via mole-tools review",
				"-f",
				"event=DISMISS",
			];
			const calls: { args: string[]; input?: string }[] = [];
			let reviewRequests = 0;
			const exec: GhExec = async (args, input) => {
				calls.push({ args, input });
				if (args.join(" ") === reviewsArgs.join(" ")) {
					reviewRequests += 1;
					const state = reviewRequests === 1 ? "APPROVED" : "DISMISSED";
					return ok(JSON.stringify([[makeReview(71, "OctoCat", state)]]));
				}
				if (args.join(" ") === userArgs.join(" ")) {
					return userResponse("octocat");
				}
				if (args.join(" ") === dismissArgs.join(" ")) {
					return ok("{}");
				}
				throw new Error(`Unexpected gh call: ${args.join(" ")}`);
			};
			const adapter = new GhAdapter({ host: "github.com", exec });

			await expect(adapter.unapproveMr(ref)).resolves.toEqual({
				approved: false,
				currentUser: "octocat",
				approvalsLeft: null,
				approvedBy: [],
				rules: [],
			});
			expect(calls.map(({ args }) => args)).toEqual([
				reviewsArgs,
				userArgs,
				dismissArgs,
				reviewsArgs,
				userArgs,
			]);
		});

		test("does not dismiss when the current user's latest review is not approved", async () => {
			const { adapter, calls } = makeGh({
				[reviewsArgs.join(" ")]: ok(
					JSON.stringify([[makeReview(71, "octocat", "CHANGES_REQUESTED")]]),
				),
				[userArgs.join(" ")]: userResponse("octocat"),
			});

			await expect(adapter.unapproveMr(ref)).resolves.toMatchObject({
				approved: false,
				currentUser: "octocat",
			});
			expect(calls.map(({ args }) => args)).toEqual([
				reviewsArgs,
				userArgs,
				reviewsArgs,
				userArgs,
			]);
			expect(
				calls.some(
					({ args }) => args.includes("--method") && args.includes("PUT"),
				),
			).toBe(false);
		});

		test("does not withdraw when the current user lookup fails", async () => {
			const { adapter, calls } = makeGh({
				[reviewsArgs.join(" ")]: ok(
					JSON.stringify([[makeReview(71, "octocat", "APPROVED")]]),
				),
				[userArgs.join(" ")]: fail("not authenticated"),
			});

			await expect(adapter.unapproveMr(ref)).resolves.toEqual({
				approved: false,
				currentUser: null,
				approvalsLeft: null,
				approvedBy: ["octocat"],
				rules: [],
			});
			expect(calls.map(({ args }) => args)).toEqual([
				reviewsArgs,
				userArgs,
				reviewsArgs,
				userArgs,
			]);
			expect(
				calls.some(
					({ args }) => args.includes("--method") && args.includes("PUT"),
				),
			).toBe(false);
		});

		test("surfaces dismissal failures as PortError with trimmed stderr", async () => {
			const dismissArgs = [
				"api",
				"--hostname",
				"github.com",
				"--method",
				"PUT",
				"repos/owner/repo/pulls/42/reviews/71/dismissals",
				"-f",
				"message=Approval withdrawn via mole-tools review",
				"-f",
				"event=DISMISS",
			];
			const { adapter, calls } = makeGh({
				[reviewsArgs.join(" ")]: ok(
					JSON.stringify([[makeReview(71, "octocat", "APPROVED")]]),
				),
				[userArgs.join(" ")]: userResponse("octocat"),
				[dismissArgs.join(" ")]: fail(
					"  HTTP 403: Must have admin rights \n",
					1,
				),
			});

			const error = await rejectedBy(adapter.unapproveMr(ref));
			expect(error).toBeInstanceOf(PortError);
			expect(error).toMatchObject({
				message: "HTTP 403: Must have admin rights",
				stderr: "  HTTP 403: Must have admin rights \n",
				code: 1,
			});
			expect(calls.map(({ args }) => args)).toEqual([
				reviewsArgs,
				userArgs,
				dismissArgs,
			]);
		});
	});
});
describe("GhAdapter listDiscussions", () => {
	const ref: MrRef = {
		host: "github.com",
		projectPath: "owner/repo",
		iid: 42,
	};
	const graphqlArgs = [
		"api",
		"graphql",
		"--hostname",
		"github.com",
		"--paginate",
		"--slurp",
		"-f",
		"query=query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {\n  repository(owner: $owner, name: $name) {\n    pullRequest(number: $number) {\n      reviewThreads(first: 100, after: $endCursor) {\n        pageInfo { hasNextPage endCursor }\n        nodes {\n          isResolved path line originalLine diffSide\n          comments(first: 100) { nodes { databaseId author { login } body createdAt } }\n        }\n      }\n    }\n  }\n}",
		"-f",
		"owner=owner",
		"-f",
		"name=repo",
		"-F",
		"number=42",
	];
	const commentsArgs = [
		"api",
		"--hostname",
		"github.com",
		"--paginate",
		"--slurp",
		"repos/owner/repo/issues/42/comments?per_page=100",
	];
	const reviewsArgs = [
		"api",
		"--hostname",
		"github.com",
		"--paginate",
		"--slurp",
		"repos/owner/repo/pulls/42/reviews?per_page=100",
	];

	test("flattens slurp pages, maps positions, skips empty entries, and sorts sources", async () => {
		const thread = (
			databaseId: number,
			date: string,
			diffSide: "LEFT" | "RIGHT",
			line: number | null,
			originalLine: number,
			login: string | null,
		) => ({
			isResolved: databaseId === 1,
			path: `src/${databaseId}.ts`,
			line,
			originalLine,
			diffSide,
			comments: {
				nodes: [
					{
						databaseId,
						author: login === null ? null : { login },
						body: `thread ${databaseId}`,
						createdAt: date,
					},
				],
			},
		});
		const graphql = (nodes: unknown[]) =>
			JSON.stringify([
				{
					data: {
						repository: {
							pullRequest: { reviewThreads: { nodes: nodes.slice(0, 1) } },
						},
					},
				},
				{
					data: {
						repository: {
							pullRequest: { reviewThreads: { nodes: nodes.slice(1) } },
						},
					},
				},
			]);
		const { adapter, calls } = makeGh({
			[graphqlArgs.join(" ")]: ok(
				graphql([
					thread(1, "2024-01-02T00:00:00Z", "LEFT", null, 7, null),
					thread(2, "2024-01-04T00:00:00Z", "RIGHT", 9, 8, "octo"),
					{
						isResolved: false,
						path: "empty.ts",
						line: 1,
						originalLine: 1,
						diffSide: "RIGHT",
						comments: { nodes: [] },
					},
					{
						isResolved: false,
						path: "unpositioned.ts",
						line: null,
						originalLine: null,
						diffSide: "RIGHT",
						comments: {
							nodes: [
								{
									databaseId: 3,
									author: { login: "octo" },
									body: "unpositioned thread",
									createdAt: "2024-01-05T00:00:00Z",
								},
							],
						},
					},
				]),
			),
			[commentsArgs.join(" ")]: ok(
				JSON.stringify([
					[
						{
							id: 20,
							user: null,
							body: "issue comment",
							created_at: "2024-01-01T00:00:00Z",
						},
					],
					[
						{
							id: 21,
							user: { login: "octo" },
							body: "second page issue comment",
							created_at: "2024-01-01T12:00:00Z",
						},
					],
				]),
			),
			[reviewsArgs.join(" ")]: ok(
				JSON.stringify([
					[
						{
							id: 30,
							user: { login: "reviewer" },
							body: " submitted ",
							state: "COMMENTED",
							submitted_at: "2024-01-03T00:00:00Z",
						},
						{
							id: 31,
							user: null,
							body: "   ",
							state: "COMMENTED",
							submitted_at: "2024-01-05T00:00:00Z",
						},
						{
							id: 32,
							user: null,
							body: "pending review",
							state: "PENDING",
						},
					],
					[
						{
							id: 33,
							user: { login: "reviewer" },
							body: "second page review",
							state: "COMMENTED",
							submitted_at: "2024-01-06T00:00:00Z",
						},
					],
				]),
			),
		});

		const discussions = await adapter.listDiscussions(ref);
		expect(calls.map(({ args }) => args)).toEqual([
			graphqlArgs,
			commentsArgs,
			reviewsArgs,
		]);
		expect(discussions).toEqual([
			{
				id: "issue-comment-20",
				resolved: false,
				individualNote: true,
				notes: [
					{
						id: "20",
						author: "ghost",
						body: "issue comment",
						createdAt: "2024-01-01T00:00:00Z",
						system: false,
					},
				],
				position: null,
			},
			{
				id: "issue-comment-21",
				resolved: false,
				individualNote: true,
				notes: [
					{
						id: "21",
						author: "octo",
						body: "second page issue comment",
						createdAt: "2024-01-01T12:00:00Z",
						system: false,
					},
				],
				position: null,
			},
			{
				id: "review-thread-1",
				resolved: true,
				individualNote: false,
				notes: [
					{
						id: "1",
						author: "ghost",
						body: "thread 1",
						createdAt: "2024-01-02T00:00:00Z",
						system: false,
					},
				],
				position: {
					newPath: "src/1.ts",
					oldPath: "src/1.ts",
					newLine: null,
					oldLine: 7,
				},
			},
			{
				id: "review-30",
				resolved: false,
				individualNote: true,
				notes: [
					{
						id: "30",
						author: "reviewer",
						body: " submitted ",
						createdAt: "2024-01-03T00:00:00Z",
						system: false,
					},
				],
				position: null,
			},
			{
				id: "review-thread-2",
				resolved: false,
				individualNote: false,
				notes: [
					{
						id: "2",
						author: "octo",
						body: "thread 2",
						createdAt: "2024-01-04T00:00:00Z",
						system: false,
					},
				],
				position: {
					newPath: "src/2.ts",
					oldPath: "src/2.ts",
					newLine: 9,
					oldLine: null,
				},
			},
			{
				id: "review-thread-3",
				resolved: false,
				individualNote: false,
				notes: [
					{
						id: "3",
						author: "octo",
						body: "unpositioned thread",
						createdAt: "2024-01-05T00:00:00Z",
						system: false,
					},
				],
				position: null,
			},
			{
				id: "review-33",
				resolved: false,
				individualNote: true,
				notes: [
					{
						id: "33",
						author: "reviewer",
						body: "second page review",
						createdAt: "2024-01-06T00:00:00Z",
						system: false,
					},
				],
				position: null,
			},
		]);
	});

	test.each([
		["GraphQL review threads", graphqlArgs],
		["issue comments", commentsArgs],
		["reviews", reviewsArgs],
	])("rejects when %s API call fails", async (_operation, failedArgs) => {
		const successes: Record<string, GhExecResult> = {
			[graphqlArgs.join(" ")]: ok(
				JSON.stringify([
					{
						data: {
							repository: {
								pullRequest: { reviewThreads: { nodes: [] } },
							},
						},
					},
				]),
			),
			[commentsArgs.join(" ")]: ok("[[]]"),
			[reviewsArgs.join(" ")]: ok("[[]]"),
		};
		const { adapter } = makeGh({
			...successes,
			[failedArgs.join(" ")]: fail("  denied  ", 7),
		});

		const error = await rejectedBy(adapter.listDiscussions(ref));
		expect(error).toBeInstanceOf(PortError);
		expect(error).toMatchObject({
			message: "denied",
			stderr: "  denied  ",
			code: 7,
		});
	});
});
describe("GhAdapter createDiscussion", () => {
	const ref: MrRef = { host: "github.com", projectPath: "owner/repo", iid: 42 };
	const issueArgs = [
		"api",
		"--hostname",
		"github.com",
		"--method",
		"POST",
		"--input",
		"-",
		"repos/owner/repo/issues/42/comments",
	];
	const reviewArgs = [
		"api",
		"--hostname",
		"github.com",
		"--method",
		"POST",
		"--input",
		"-",
		"repos/owner/repo/pulls/42/comments",
	];
	const parsedDiff = (): ParsedFileDiff =>
		parseFileDiff({
			path: "src/app.ts",
			statOnly: false,
			patch: [
				"diff --git a/src/app.ts b/src/app.ts",
				"--- a/src/app.ts",
				"+++ b/src/app.ts",
				"@@ -1,2 +1,2 @@",
				" old",
				"-before",
				"+after",
			].join("\n"),
			insertions: 1,
			deletions: 1,
		});
	const diffRefs = { baseSha: "base", startSha: "start", headSha: "head" };

	test("posts unpositioned issue comment", async () => {
		const { adapter, calls } = makeGh({
			[issueArgs.join(" ")]: ok(
				JSON.stringify({
					id: 81,
					user: { login: "reviewer" },
					body: "General",
					created_at: "2024-01-01",
				}),
			),
		});
		const discussion = await adapter.createDiscussion({ ref, body: "General" });
		expect(calls).toEqual([{ args: issueArgs, input: '{"body":"General"}' }]);
		expect(discussion).toEqual({
			id: "issue-comment-81",
			resolved: false,
			individualNote: true,
			notes: [
				{
					id: "81",
					author: "reviewer",
					body: "General",
					createdAt: "2024-01-01",
					system: false,
				},
			],
			position: null,
		});
	});

	test("posts a single-line RIGHT comment with ordered payload", async () => {
		const { adapter, calls } = makeGh({
			[reviewArgs.join(" ")]: ok(
				JSON.stringify({
					id: 82,
					user: { login: "reviewer" },
					body: "Line",
					created_at: "2024-01-01",
					path: "src/app.ts",
					side: "RIGHT",
					line: 2,
					original_line: 2,
				}),
			),
		});
		const discussion = await adapter.createDiscussion({
			ref,
			body: "Line",
			selection: { path: "src/app.ts", side: "new", startLine: 2, endLine: 2 },
			parsedDiff: parsedDiff(),
			diffRefs,
		});
		expect(calls).toEqual([
			{
				args: reviewArgs,
				input:
					'{"body":"Line","commit_id":"head","path":"src/app.ts","side":"RIGHT","line":2}',
			},
		]);
		expect(discussion).toMatchObject({
			id: "review-thread-82",
			individualNote: false,
			position: {
				newPath: "src/app.ts",
				oldPath: "src/app.ts",
				newLine: 2,
				oldLine: null,
			},
		});
	});

	test("posts range LEFT comment with start position", async () => {
		const { adapter, calls } = makeGh({
			[reviewArgs.join(" ")]: ok(
				JSON.stringify({
					id: 83,
					user: null,
					body: "Range",
					created_at: "2024-01-01",
					path: "src/app.ts",
					side: "LEFT",
					line: 2,
					original_line: 2,
				}),
			),
		});
		const discussion = await adapter.createDiscussion({
			ref,
			body: "Range",
			selection: { path: "src/app.ts", side: "old", startLine: 1, endLine: 2 },
			parsedDiff: parsedDiff(),
			diffRefs,
		});
		expect(calls[0]?.input).toBe(
			'{"body":"Range","commit_id":"head","path":"src/app.ts","side":"LEFT","line":2,"start_line":1,"start_side":"LEFT"}',
		);
		expect(discussion).toEqual({
			id: "review-thread-83",
			resolved: false,
			individualNote: false,
			notes: [
				{
					id: "83",
					author: "ghost",
					body: "Range",
					createdAt: "2024-01-01",
					system: false,
				},
			],
			position: {
				newPath: "src/app.ts",
				oldPath: "src/app.ts",
				newLine: null,
				oldLine: 2,
			},
		});
	});
	test("rejects invalid input before executing gh", async () => {
		const { adapter, calls } = makeGh({});
		const blank = await rejectedBy(
			adapter.createDiscussion({ ref, body: "  " }),
		);
		expect(blank).toBeInstanceOf(PortError);
		const unpositioned = await rejectedBy(
			adapter.createDiscussion({
				ref,
				body: "x",
				parsedDiff: parsedDiff(),
				diffRefs,
			} as never),
		);
		expect(unpositioned).toBeInstanceOf(PortError);
		const invalid = await rejectedBy(
			adapter.createDiscussion({
				ref,
				body: "x",
				selection: { path: "missing", side: "new", startLine: 1, endLine: 1 },
				parsedDiff: parsedDiff(),
				diffRefs,
			}),
		);
		expect(invalid).toBeInstanceOf(PortError);
		expect((invalid as Error).message).toStartWith(
			"Invalid diff line selection:",
		);
		expect(calls).toEqual([]);
	});

	test("rejects diff without path before executing gh", async () => {
		const { adapter, calls } = makeGh({});
		const noPath = { ...parsedDiff(), oldPath: null, newPath: null };
		const error = await rejectedBy(
			adapter.createDiscussion({
				ref,
				body: "x",
				selection: { path: "x", side: "new", startLine: 1, endLine: 1 },
				parsedDiff: noPath,
				diffRefs,
			}),
		);
		expect(error).toBeInstanceOf(PortError);
		expect((error as Error).message).toStartWith(
			"Invalid diff line selection:",
		);
		expect(calls).toEqual([]);
	});

	test("surfaces trimmed stderr from a positioned POST", async () => {
		const { adapter } = makeGh({
			[reviewArgs.join(" ")]: fail(
				" HTTP 422: pull_request_review_thread.path is invalid \n",
			),
		});
		const error = await rejectedBy(
			adapter.createDiscussion({
				ref,
				body: "x",
				selection: {
					path: "src/app.ts",
					side: "new",
					startLine: 2,
					endLine: 2,
				},
				parsedDiff: parsedDiff(),
				diffRefs,
			}),
		);
		expect(error).toBeInstanceOf(PortError);
		expect(error).toMatchObject({
			message: "HTTP 422: pull_request_review_thread.path is invalid",
		});
	});
});
