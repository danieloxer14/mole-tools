import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FakeGitHost } from "../../test/fakes/FakeGitHost";
import {
	GlabAdapter,
	type GlabExec,
	type GlabExecResult,
} from "../adapters/git-host/glab";
import { PortError } from "../core/errors";
import type { CreateDiscussionInput } from "../ports/git-host";
import { parseFileDiff } from "../shared/diff-parse";
import { buildPosition } from "../shared/gitlab-position";
import type { MrRef } from "../shared/mr-url";

const ref: MrRef = {
	host: "gitlab.example.com",
	projectPath: "group/sub/project",
	iid: 42,
};

function ok(stdout: string): GlabExecResult {
	return { stdout, stderr: "", exitCode: 0 };
}

async function fixture(name: string): Promise<string> {
	return Bun.file(
		join(import.meta.dir, "../../test/fixtures/glab", name),
	).text();
}

describe("GitHost review contract", () => {
	test("fetchMr uses encoded project path and maps validated metadata", async () => {
		const calls: string[][] = [];
		const mr = await fixture("mr.json");
		const exec: GlabExec = async (args) => {
			calls.push(args);
			return ok(mr);
		};
		const glab = new GlabAdapter(exec);

		expect(await glab.fetchMr(ref)).toEqual({
			iid: 42,
			projectPath: "group/sub/project",
			title: "Improve parser",
			description: "Adds structured diff parsing.",
			webUrl:
				"https://gitlab.example.com/group/sub/project/-/merge_requests/42",
			author: "alice",
			sourceBranch: "feature/parser",
			targetBranch: "main",
			headSha: "head-sha",
			diffRefs: {
				baseSha: "base-sha",
				startSha: "start-sha",
				headSha: "head-sha",
			},
			state: "opened",
		});
		expect(calls).toEqual([
			[
				"api",
				"--hostname",
				"gitlab.example.com",
				"projects/group%2Fsub%2Fproject/merge_requests/42",
			],
		]);
	});

	test("listDiscussions maps every paginated page", async () => {
		const all = JSON.parse(await fixture("discussions.json")) as unknown[];
		const calls: string[][] = [];
		const exec: GlabExec = async (args) => {
			calls.push(args);
			return ok(`${JSON.stringify([all[0]])}\n${JSON.stringify([all[1]])}`);
		};
		const glab = new GlabAdapter(exec);

		expect(await glab.listDiscussions(ref)).toEqual([
			{
				id: "discussion-1",
				resolved: true,
				notes: [
					{
						id: "101",
						author: "reviewer",
						body: "Please keep this branch-free.",
						createdAt: "2026-08-15T10:00:00Z",
						system: false,
					},
				],
				position: {
					newPath: "src/new.ts",
					oldPath: "src/old.ts",
					newLine: 12,
					oldLine: null,
				},
			},
			{
				id: "discussion-2",
				resolved: false,
				notes: [
					{
						id: "note-102",
						author: "System User",
						body: "A system note.",
						createdAt: "2026-08-15T10:05:00Z",
						system: true,
					},
				],
				position: null,
			},
		]);
		expect(calls).toEqual([
			[
				"api",
				"--hostname",
				"gitlab.example.com",
				"--paginate",
				"projects/group%2Fsub%2Fproject/merge_requests/42/discussions",
			],
		]);
	});

	test("rejects malformed MR payloads before any write", async () => {
		const calls: { args: string[]; input?: string }[] = [];
		const exec: GlabExec = async (args, input) => {
			calls.push({ args, input });
			return ok(JSON.stringify({ iid: 42 }));
		};
		const glab = new GlabAdapter(exec);

		await expect(glab.fetchMr(ref)).rejects.toBeInstanceOf(PortError);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.input).toBeUndefined();
	});

	test("rejects invalid diff positions before comment writes", async () => {
		const calls: { args: string[]; input?: string }[] = [];
		const exec: GlabExec = async (args, input) => {
			calls.push({ args, input });
			return ok("never reached");
		};
		const glab = new GlabAdapter(exec);
		const parsedDiff = parseFileDiff({
			path: "src/app.ts",
			statOnly: false,
			patch: null,
			insertions: 0,
			deletions: 0,
		});
		const diffRefs = { baseSha: "base", startSha: "start", headSha: "head" };
		const invalid: CreateDiscussionInput = {
			ref,
			body: "Comment",
			position: {
				position_type: "text",
				base_sha: "base",
				start_sha: "start",
				head_sha: "head",
				old_path: "src/app.ts",
				new_path: "src/app.ts",
				old_line: null,
				new_line: null,
			},
			parsedDiff,
			diffRefs,
		};
		await expect(glab.createDiscussion(invalid)).rejects.toBeInstanceOf(
			PortError,
		);
		expect(calls).toEqual([]);
	});
	test("rejects stale line codes and refs before comment writes", async () => {
		const calls: { args: string[]; input?: string }[] = [];
		const exec: GlabExec = async (args, input) => {
			calls.push({ args, input });
			return ok("never reached");
		};
		const glab = new GlabAdapter(exec);
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
		const refs = { baseSha: "base", startSha: "start", headSha: "head" };
		const position = buildPosition(
			{ path: "src/app.ts", side: "new", startLine: 1, endLine: 2 },
			parsedDiff,
			refs,
		);
		const staleLineCode = structuredClone(position);
		if (staleLineCode.line_range) {
			staleLineCode.line_range.end.line_code = "stale-line-code";
		}

		await expect(
			glab.createDiscussion({
				ref,
				body: "Comment",
				position: staleLineCode,
				parsedDiff,
				diffRefs: refs,
			}),
		).rejects.toThrow("parsed diff lines");
		await expect(
			glab.createDiscussion({
				ref,
				body: "Comment",
				position,
				parsedDiff,
				diffRefs: { ...refs, headSha: "new-head" },
			}),
		).rejects.toThrow("current diff refs");
		expect(calls).toEqual([]);
	});

	test("validates parsed diff selections before building comment positions", () => {
		const parsed = parseFileDiff({
			path: "src/app.ts",
			statOnly: false,
			patch: [
				"diff --git a/src/app.ts b/src/app.ts",
				"--- a/src/app.ts",
				"+++ b/src/app.ts",
				"@@ -1,2 +1,3 @@",
				" context",
				"-old",
				"+new",
				"+added",
			].join("\n"),
			insertions: 2,
			deletions: 1,
		});
		const refs = { baseSha: "base", startSha: "start", headSha: "head" };

		expect(
			buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 2, endLine: 3 },
				parsed,
				refs,
			),
		).toMatchObject({
			old_path: "src/app.ts",
			new_path: "src/app.ts",
			old_line: null,
			new_line: 3,
			line_range: {
				start: { type: "new", old_line: null, new_line: 2 },
				end: { type: "new", old_line: null, new_line: 3 },
			},
		});
		expect(() =>
			buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 2, endLine: 4 },
				parsed,
				refs,
			),
		).toThrow(PortError);
		expect(() =>
			buildPosition(
				{ path: "src/app.ts", side: "new", startLine: 3, endLine: 2 },
				parsed,
				refs,
			),
		).toThrow(PortError);
	});

	test("rejects zero, reversed, and cross-side positions before comment writes", async () => {
		const calls: { args: string[]; input?: string }[] = [];
		const exec: GlabExec = async (args, input) => {
			calls.push({ args, input });
			return ok("never reached");
		};
		const glab = new GlabAdapter(exec);
		const validationDiff = parseFileDiff({
			path: "src/app.ts",
			statOnly: false,
			patch: null,
			insertions: 0,
			deletions: 0,
		});
		const diffRefs = { baseSha: "base", startSha: "start", headSha: "head" };
		const base = {
			position_type: "text" as const,
			base_sha: "base",
			start_sha: "start",
			head_sha: "head",
			old_path: "src/app.ts",
			new_path: "src/app.ts",
		};
		const invalidPositions: CreateDiscussionInput["position"][] = [
			{ ...base, old_line: null, new_line: 0 },
			{
				...base,
				old_line: null,
				new_line: 3,
				line_range: {
					start: {
						line_code: "start",
						type: "new",
						old_line: null,
						new_line: 3,
					},
					end: {
						line_code: "end",
						type: "new",
						old_line: null,
						new_line: 2,
					},
				},
			},
			{
				...base,
				old_line: null,
				new_line: 3,
				line_range: {
					start: {
						line_code: "start",
						type: "old",
						old_line: 2,
						new_line: null,
					},
					end: {
						line_code: "end",
						type: "old",
						old_line: 3,
						new_line: null,
					},
				},
			},
		];

		for (const position of invalidPositions) {
			await expect(
				glab.createDiscussion({
					ref,
					body: "Comment",
					position,
					parsedDiff: validationDiff,
					diffRefs,
				}),
			).rejects.toBeInstanceOf(PortError);
		}
		const parsedDiff = parseFileDiff({
			path: "src/app.ts",
			statOnly: false,
			patch: [
				"diff --git a/src/app.ts b/src/app.ts",
				"--- a/src/app.ts",
				"+++ b/src/app.ts",
				"@@ -1,1 +1,1 @@",
				"-old",
				"+new",
			].join("\n"),
			insertions: 1,
			deletions: 1,
		});
		await expect(
			glab.createDiscussion({
				ref,
				body: "Comment",
				position: { ...base, old_line: null, new_line: 2 },
				parsedDiff,
				diffRefs,
			}),
		).rejects.toBeInstanceOf(PortError);
		expect(calls).toEqual([]);
	});

	test("FakeGitHost exposes review methods", async () => {
		const fake = new FakeGitHost({
			fetchMr: async () => ({
				iid: 42,
				projectPath: ref.projectPath,
				title: "Title",
				description: "Description",
				webUrl: "https://gitlab.example.com/mr/42",
				author: "alice",
				sourceBranch: "feature",
				targetBranch: "main",
				headSha: "head",
				diffRefs: { baseSha: "base", startSha: "start", headSha: "head" },
				state: "opened",
			}),
			listDiscussions: async () => [],
		});
		expect((await fake.fetchMr(ref)).headSha).toBe("head");
		expect(await fake.listDiscussions(ref)).toEqual([]);
	});
	test("FakeGitHost forwards createDiscussion payloads", async () => {
		let received: CreateDiscussionInput | undefined;
		const discussion = {
			id: "fake-discussion",
			resolved: false,
			notes: [],
			position: null,
		};
		const fake = new FakeGitHost({
			createDiscussion: async (input) => {
				received = input;
				return discussion;
			},
		});
		const parsedDiff = parseFileDiff({
			path: "src/app.ts",
			statOnly: false,
			patch: [
				"diff --git a/src/app.ts b/src/app.ts",
				"--- a/src/app.ts",
				"+++ b/src/app.ts",
				"@@ -12,1 +12,1 @@",
				" context",
			].join("\n"),
			insertions: 0,
			deletions: 0,
		});
		const diffRefs = { baseSha: "base", startSha: "start", headSha: "head" };
		const position = buildPosition(
			{ path: "src/app.ts", side: "new", startLine: 12, endLine: 12 },
			parsedDiff,
			diffRefs,
		);
		const input: CreateDiscussionInput = {
			ref,
			body: "Review this line",
			position,
			parsedDiff,
			diffRefs,
		};

		await expect(fake.createDiscussion(input)).resolves.toEqual(discussion);
		expect(received).toEqual(input);
	});
});
